import fs from 'node:fs';
import path from 'node:path';
import {chromium, webkit, devices} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {isAllowedUrl, isExcludedPath, cleanText, safeFilename, DENIED_LABEL} from './security.mjs';
import {loadConfig, forDevice, deviceShare, DEVICE_PROFILES} from './config.mjs';
import {loadMemory, nextPriority, saveMemory} from './memory.mjs';
import {inventoryPage, runAction, settle} from './browser.mjs';
import {collectSignals, analyzeSignals, analyzeSticky, measureSticky, scrollThrough, templateOf} from './checks.mjs';
import {measurePage, analyzePerformance} from './perf.mjs';
import {upsertFinding, sortFindings, saveReport} from './report.mjs';
import {planExploration, evaluateEvidence} from './claude.mjs';
import {nextScreeningPlausibility} from './showtimes.mjs';

const argv = process.argv.slice(2);
function flag(name, fallback) { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] || fallback; }

const mode = flag('--mode', 'smoke');
if (!['smoke', 'intelligent'].includes(mode)) throw new Error('Mode must be smoke or intelligent');
const config = loadConfig(flag('--config', 'sites/ov-berlin.json'));
if (!isAllowedUrl(config.url, config)) throw new Error('Invalid target website URL/allowlist');
const out = flag('--out', 'out');
const memoryFile = flag('--memory', 'memory/state.json');
fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});

const memory = loadMemory(memoryFile);
const report = {
  config: {name: config.name, url: config.url, timezone: config.timezone, devices: config.devices},
  mode, startedAt: new Date().toISOString(), finishedAt: null, status: 'RUNNING', blockers: 0,
  actions: [], findings: [], screenshots: [], visitedPaths: [], performance: [], suggestions: [], errors: [],
  coverage: {missingControls: {}, linksChecked: 0}, networkSignals: [], sourceAccuracy: 'NOT_VERIFIED',
};

const browsers = {};
const engines = {chromium, webkit};
const highlighted = new Set();
let actionId = 0;
let shotCounter = 0;
let aborted = false;

const deadline = setTimeout(() => {
  aborted = true;
  report.errors.push('Audit exceeded maximum runtime and stopped early');
  process.exitCode = 2;
  for (const b of Object.values(browsers)) b.close().catch(() => {});
  // If a browser call never returns, still leave a report behind and exit.
  setTimeout(() => {
    report.status = 'TIMED_OUT';
    report.finishedAt = new Date().toISOString();
    saveReport(report, out);
    process.exit(2);
  }, 30000).unref();
}, config.maxRunMinutes * 60000);

async function getBrowser(engine) {
  browsers[engine] ||= await engines[engine].launch({headless: true, args: engine === 'chromium' ? ['--no-sandbox'] : []});
  return browsers[engine];
}

function contextOptions(profile) {
  const base = profile.descriptor ? {...devices[profile.descriptor]} : {viewport: profile.viewport, deviceScaleFactor: 1};
  delete base.defaultBrowserType;
  return {...base, locale: config.locale || 'en-GB', timezoneId: config.timezone, acceptDownloads: false, permissions: []};
}

function pathOf(url) { try { return new URL(url).pathname; } catch { return String(url).slice(0, 80); } }

function record(ctx, type, target, result) {
  const id = `A${String(++actionId).padStart(3, '0')}`;
  const outcome = result.ok ? 'PASS' : `SKIPPED/ERROR: ${cleanText(result.reason, 110)}`;
  report.actions.push({id, device: ctx.name, type, target, outcome, via: result.via || undefined, changed: result.changed ?? undefined, after: result.after || null});
  if (result.after?.url) {
    const p = pathOf(result.after.url);
    if (!report.visitedPaths.includes(p)) report.visitedPaths.push(p);
  }
  ctx.step = id;
  return id;
}

function addFinding(ctx, args) {
  upsertFinding(report.findings, {device: ctx.name, page: templateOf(pathOf(ctx.page.url())), stepId: ctx.step, ...args});
}

/** One failing stage must not cost the rest of the audit. */
async function stage(ctx, name, fn) {
  if (aborted) return undefined;
  console.log(`[${Math.round(process.uptime())}s] ${ctx.name}: ${name}`);
  try { return await fn(); } catch (e) {
    if (!aborted) report.errors.push(`${ctx.name} / ${name}: ${cleanText(e.message, 300)}`);
    return undefined;
  }
}

async function drawHighlights(page, rects) {
  await page.evaluate(list => {
    for (const r of list) {
      const box = document.createElement('div');
      box.dataset.guardianHighlight = '';
      Object.assign(box.style, {position: 'absolute', left: `${r.x - 2}px`, top: `${r.y - 2}px`, width: `${r.w + 4}px`, height: `${r.h + 4}px`, outline: '3px solid #ff2d2d', zIndex: 2147483647, pointerEvents: 'none'});
      document.body.appendChild(box);
    }
    window.scrollTo(0, Math.max(0, list[0].y - window.innerHeight / 3));
  }, rects);
}

async function shot(ctx, name, {highlight} = {}) {
  if (ctx.shots <= 0 || shotCounter >= config.screenshotLimit) return null;
  const file = `screenshots/${String(shotCounter + 1).padStart(2, '0')}-${safeFilename(ctx.name)}-${safeFilename(name)}.png`;
  try {
    if (highlight?.length) await drawHighlights(ctx.page, highlight);
    await ctx.page.screenshot({path: path.join(out, file), fullPage: false, animations: 'disabled', timeout: 10000});
    shotCounter++;
    ctx.shots--;
    report.screenshots.push(file);
    return file;
  } catch (e) {
    report.errors.push(`Screenshot failed: ${cleanText(e.message)}`);
    return null;
  } finally {
    if (highlight?.length) await ctx.page.evaluate(() => { document.querySelectorAll('[data-guardian-highlight]').forEach(n => n.remove()); window.scrollTo(0, 0); }).catch(() => {});
  }
}

async function applyFindings(ctx, findings) {
  for (const {highlight, ...f} of findings) {
    const key = `${f.kind}:${ctx.name}`;
    let screenshot = null;
    if (highlight?.length && !highlighted.has(key)) {
      highlighted.add(key);
      screenshot = await shot(ctx, f.kind, {highlight});
    }
    addFinding(ctx, {...f, evidence: screenshot ? {...f.evidence, screenshot} : f.evidence});
  }
}

async function inspectPage(ctx, {isLanding = false} = {}) {
  const raw = await collectSignals(ctx.page, {primaryPattern: ctx.cfg.primaryActionPattern});
  await applyFindings(ctx, analyzeSignals(raw, {family: ctx.profile.family, isLanding}));
  report.bookingLinksObserved = (report.bookingLinksObserved || 0) + raw.bookingLinkCount;
  const pagePath = pathOf(ctx.page.url());
  if (ctx.cfg.checks.nextScreening && ctx.cfg.detailPathPrefixes.some(p => pagePath.startsWith(p))) {
    const shown = await ctx.page.locator('body').innerText({timeout: 4000});
    const plausibility = nextScreeningPlausibility(shown, new Date(), config.timezone);
    if (plausibility.status === 'PAST_NEXT_SHOWTIME') {
      addFinding(ctx, {kind: 'past-next-screening', title: 'Movie page labels a past screening as next', severity: 'P1', evidence: {url: ctx.page.url(), ...plausibility, note: 'UI clock plausibility; NOT independent cinema-source verification'}});
    }
  }
}

async function scanAccessibility(ctx) {
  const result = await new AxeBuilder({page: ctx.page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const severity = {critical: 'P1', serious: 'P2'};
  for (const v of result.violations) {
    addFinding(ctx, {
      kind: `accessibility-${v.id}`,
      title: `Accessibility: ${v.help}`,
      severity: severity[v.impact] || 'P3',
      evidence: {impact: v.impact, rule: v.id, help: v.helpUrl, affected: v.nodes.length, selectors: v.nodes.slice(0, 5).map(x => x.target)},
    });
  }
}

async function gotoSettled(ctx, url) {
  const response = await ctx.page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
  await settle(ctx.page);
  return response;
}

async function dismissConsent(ctx) {
  for (const label of ctx.cfg.consentButtons) {
    if (DENIED_LABEL.test(label)) continue;
    const button = ctx.page.getByRole('button', {name: label, exact: true}).filter({visible: true}).first();
    if (await button.count()) {
      await button.click({timeout: 5000});
      await ctx.page.waitForTimeout(300);
      return label;
    }
  }
  return null;
}

/** Sites often remember filters and views, so each journey must start as a new visitor. */
async function freshStart(ctx) {
  await ctx.page.context().clearCookies();
  await ctx.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
  await gotoSettled(ctx, config.url);
  await dismissConsent(ctx).catch(() => {});
}

function attachListeners(ctx) {
  const {page, name} = ctx;
  const seenConsole = new Set();
  page.on('pageerror', e => {
    if (/^(Load failed|Failed to fetch|NetworkError)/i.test(e.message)) return; // a fetch cut off by navigation; real failures appear as failed requests
    addFinding(ctx, {kind: 'javascript-error', title: `Uncaught JavaScript error: ${cleanText(e.message, 90)}`, severity: 'P1', evidence: {message: cleanText(e.message, 300)}});
  });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = cleanText(msg.text(), 200);
    if (/Content Security Policy|Failed to load resource/i.test(text) || seenConsole.has(text) || seenConsole.size >= 5) return;
    seenConsole.add(text);
    addFinding(ctx, {kind: 'console-error', title: `Console error: ${cleanText(text, 90)}`, severity: 'P3', evidence: {message: text}});
  });
  page.on('response', res => {
    if (res.status() < 400 || !isAllowedUrl(res.url(), config)) return;
    const isDocument = res.request().resourceType() === 'document';
    const route = templateOf(pathOf(res.url()));
    addFinding(ctx, {
      kind: isDocument ? 'page-http-error' : 'resource-http-error',
      title: `${isDocument ? 'Page' : 'Request'} ${route} returned HTTP ${res.status()}`,
      severity: isDocument ? 'P1' : 'P2',
      evidence: {url: res.url().slice(0, 180), status: res.status(), type: res.request().resourceType()},
    });
  });
  page.on('requestfailed', req => {
    const reason = req.failure()?.errorText || 'unknown';
    if (/ERR_ABORTED|cancelled/i.test(reason)) return; // normal when navigating away mid-request
    let host = 'unknown';
    try { host = new URL(req.url()).hostname; } catch {}
    if (/csp/i.test(reason) || /BLOCKED_BY_CSP/.test(reason)) {
      addFinding(ctx, {kind: 'csp-blocked', title: `Content-Security-Policy blocks requests to ${host}`, severity: 'P3', evidence: {url: req.url().slice(0, 180), reason}});
    } else if (isAllowedUrl(req.url(), config)) {
      addFinding(ctx, {kind: 'request-failed', title: `Requests to ${templateOf(pathOf(req.url()))} failed`, severity: 'P2', evidence: {url: req.url().slice(0, 180), reason}});
    } else {
      report.networkSignals.push({device: name, host, reason});
    }
  });
}

function noteMissing(ctx, target) {
  (report.coverage.missingControls[ctx.name] ||= []);
  if (!report.coverage.missingControls[ctx.name].includes(target)) report.coverage.missingControls[ctx.name].push(target);
}

async function runNamed(ctx, action) {
  if (ctx.budget <= 0 || aborted) return undefined;
  const inventory = await inventoryPage(ctx.page, ctx.cfg);
  const result = await runAction(ctx.page, action, inventory, ctx.cfg);
  const id = record(ctx, action.type, action.target, result);
  ctx.budget--;
  if (result.code === 'missing' && (action.type === 'click' || action.type === 'view')) noteMissing(ctx, action.target);
  if (result.code === 'obscured') {
    addFinding(ctx, {kind: 'control-obscured', title: `Something covers the "${cleanText(action.target, 40)}" control, so it cannot be tapped`, severity: 'P1', evidence: {reason: result.reason}});
  }
  if (!result.ok) return result;
  if (result.changed === false) {
    addFinding(ctx, {kind: 'control-no-effect', title: `"${cleanText(action.target, 40)}" changed nothing on the page`, severity: 'P2', status: 'LIKELY', evidence: {action: action.type, via: result.via, waitedMs: 3000}});
  }
  if (action.type === 'search' && result.emptyResults) {
    addFinding(ctx, {kind: 'search-no-results', title: `Search for "${cleanText(action.target, 40)}" returned no results`, severity: 'P2', status: 'LIKELY', evidence: {query: action.target}});
  }
  await inspectPage(ctx);
  return {...result, id};
}

async function runJourneys(ctx) {
  const {cfg, name, isPrimary} = ctx;
  const keys = nextPriority(memory, [...cfg.filters.map(t => `${name}:click:${t}`), ...cfg.views.map(t => `${name}:view:${t}`)]);
  const reservedForLater = cfg.searchQueries.length + 1 + (mode === 'intelligent' && isPrimary ? 8 : 0);
  for (const key of keys.slice(0, Math.max(1, ctx.budget - reservedForLater))) {
    if (aborted) return;
    const [, type, ...rest] = key.split(':');
    const target = rest.join(':');
    await freshStart(ctx);
    const result = await runNamed(ctx, {type, target});
    if (result?.ok && (type === 'view' || result.via)) await shot(ctx, `${type}-${target}`);
  }
  for (const query of cfg.searchQueries.slice(0, 2)) {
    await freshStart(ctx);
    const result = await runNamed(ctx, {type: 'search', target: query});
    if (result?.ok) await shot(ctx, `search-${query}`);
  }
  await freshStart(ctx);
  const inventory = await inventoryPage(ctx.page, cfg);
  const detail = inventory.internalLinks.find(x => cfg.detailPathPrefixes.some(p => pathOf(x.href).startsWith(p)) && !isExcludedPath(pathOf(x.href), cfg));
  if (detail) {
    const result = await runNamed(ctx, {type: 'open_detail', target: detail.text});
    if (result?.ok) await shot(ctx, 'detail-opened');
  }
}

/** All same-site links on the current page, including those inside closed menus. */
async function allInternalPaths(ctx) {
  const hrefs = await ctx.page.$$eval('a[href]', anchors => anchors.map(a => a.href));
  const urls = new Map();
  for (const href of hrefs) {
    if (!isAllowedUrl(href, ctx.cfg)) continue;
    const u = new URL(href);
    if (u.pathname !== '/' && !isExcludedPath(u.pathname, ctx.cfg)) urls.set(u.pathname, u.origin + u.pathname);
  }
  return urls;
}

/** One URL per page type, preferring detail pages and the ones visited least so far. */
export function choosePages(urls, cfg, visited, limit) {
  const byTemplate = new Map();
  for (const [p, url] of urls) {
    const t = templateOf(p);
    const current = byTemplate.get(t);
    if (!current || (visited[p] || 0) < (visited[current.path] || 0)) byTemplate.set(t, {path: p, url, template: t});
  }
  const isDetail = x => cfg.detailPathPrefixes.some(p => x.path.startsWith(p));
  return [...byTemplate.values()]
    .sort((a, b) => Number(isDetail(b)) - Number(isDetail(a)) || (visited[a.path] || 0) - (visited[b.path] || 0))
    .slice(0, limit);
}

async function samplePages(ctx, urls) {
  const limit = ctx.isPrimary ? config.maxPages : Math.min(3, config.maxPages);
  const picks = choosePages(urls, ctx.cfg, memory.visitedPaths, limit);
  for (const pick of picks) {
    if (aborted) return picks;
    await stage(ctx, `page ${pick.path}`, async () => {
      const response = await gotoSettled(ctx, pick.url);
      record(ctx, 'visit', pick.path, {ok: !!response?.ok(), reason: `HTTP ${response?.status()}`, after: {url: ctx.page.url(), title: await ctx.page.title()}});
      if (!response?.ok()) return;
      await scrollThrough(ctx.page);
      await inspectPage(ctx);
      await stage(ctx, `accessibility ${pick.path}`, () => scanAccessibility(ctx));
      await shot(ctx, `page-${pick.template}`);
      await ctx.page.waitForTimeout(config.rateLimitMs);
    });
  }
  return picks;
}

async function checkPhoneLayout(ctx) {
  const sticky = await measureSticky(ctx.page);
  await applyFindings(ctx, analyzeSticky(sticky));
  const {width, height} = ctx.page.viewportSize();
  await ctx.page.setViewportSize({width: height, height: width});
  try {
    await ctx.page.waitForTimeout(400);
    const raw = await collectSignals(ctx.page, {primaryPattern: ctx.cfg.primaryActionPattern});
    if (raw.docWidth > raw.viewportWidth + 2) {
      addFinding(ctx, {kind: 'layout-overflow', title: 'Content is wider than the screen, causing sideways scrolling', severity: 'P1', evidence: {orientation: 'landscape', viewportWidth: raw.viewportWidth, documentWidth: raw.docWidth}});
    }
    await applyFindings(ctx, analyzeSticky(await measureSticky(ctx.page), {landscape: true}));
    await shot(ctx, 'landscape');
  } finally {
    await ctx.page.setViewportSize({width, height});
  }
}

async function checkLinks(ctx, urls) {
  const perTemplate = {};
  const toCheck = [...urls.entries()].filter(([p]) => {
    const t = templateOf(p);
    perTemplate[t] = (perTemplate[t] || 0) + 1;
    return perTemplate[t] <= 5;
  }).slice(0, config.linkCheckLimit);
  for (const [p, url] of toCheck) {
    if (aborted) return;
    const res = await ctx.page.context().request.get(url, {timeout: 12000, failOnStatusCode: false}).catch(() => null);
    report.coverage.linksChecked++;
    if (res?.status() === 429) { report.errors.push('Link check stopped early: site is rate limiting (HTTP 429)'); return; }
    if (res && res.status() >= 400) {
      addFinding(ctx, {kind: 'broken-internal-link', title: `Internal link ${p} returns HTTP ${res.status()}`, severity: 'P1', evidence: {url, status: res.status(), linkedFrom: ctx.page.url()}});
    }
    await ctx.page.waitForTimeout(Math.round(config.rateLimitMs / 2));
  }
}

async function exploreWithAi(ctx) {
  await freshStart(ctx);
  for (let round = 0; round < Math.min(2, config.maxAiRounds) && ctx.budget > 0 && !aborted; round++) {
    const inventory = await inventoryPage(ctx.page, ctx.cfg);
    const allowed = {
      buttons: [...new Set([...ctx.cfg.filters, ...ctx.cfg.safeButtons, ...ctx.cfg.views])],
      detailLinks: inventory.internalLinks.filter(x => ctx.cfg.detailPathPrefixes.some(p => pathOf(x.href).startsWith(p))).map(x => x.text).slice(0, 30),
      other: ['search', 'back'],
    };
    let plan;
    try {
      plan = await planExploration({config, deviceName: ctx.name, memory, inventory, allowed, pastActions: report.actions, remaining: ctx.budget});
    } catch (e) {
      report.errors.push(`Claude exploration unavailable: ${cleanText(e.message, 250)}`);
      return;
    }
    let executed = 0;
    for (const action of (plan.actions || []).slice(0, Math.min(6, ctx.budget))) {
      // The plan was made from the landing page, so an earlier step that navigated away must not strand the rest.
      if (action.type !== 'back' && pathOf(ctx.page.url()) !== pathOf(config.url)) await gotoSettled(ctx, config.url);
      const result = await runNamed(ctx, action);
      if (result?.ok) executed++;
    }
    if (!executed) { report.errors.push(`AI round ${round + 1}: no executable safe actions; stopped`); return; }
    await shot(ctx, `ai-round-${round + 1}`);
  }
}

async function auditDevice(name, isPrimary) {
  const profile = DEVICE_PROFILES[name];
  const count = config.devices.length;
  const browser = await getBrowser(profile.engine).catch(e => { report.errors.push(`${name}: ${profile.engine} could not start: ${cleanText(e.message, 200)}`); return null; });
  if (!browser) return null;
  const context = await browser.newContext(contextOptions(profile));
  const page = await context.newPage();
  context.on('page', extra => { if (extra !== page) extra.close().catch(() => {}); }); // links that open new tabs stay unvisited
  const ctx = {name, profile, cfg: forDevice(config, name), page, isPrimary, step: 'landing', budget: deviceShare(config.maxActions, count, isPrimary), shots: deviceShare(config.screenshotLimit, count, isPrimary)};
  attachListeners(ctx);
  await context.tracing.start({screenshots: true, snapshots: true, sources: false});
  let picks = [];
  try {
    let response;
    try {
      response = await gotoSettled(ctx, config.url).catch(() => gotoSettled(ctx, config.url));
    } catch (e) {
      upsertFinding(report.findings, {kind: 'site-unreachable', title: 'Landing page could not be loaded', severity: 'P0', device: name, evidence: {reason: cleanText(e.message, 250)}});
      record(ctx, 'navigate', config.url, {ok: false, reason: e.message});
      return null;
    }
    record(ctx, 'navigate', config.url, {ok: !!response?.ok(), reason: `HTTP ${response?.status()}`, after: {url: page.url(), title: await page.title()}});
    if (!response?.ok()) {
      addFinding(ctx, {kind: 'page-http', title: `Landing page returned HTTP ${response?.status() || 'unknown'}`, severity: 'P0', evidence: {url: config.url, status: response?.status()}});
      return null;
    }
    await shot(ctx, 'first-visit');
    await stage(ctx, 'consent', () => dismissConsent(ctx));
    await stage(ctx, 'landing checks', async () => { await scrollThrough(page); await inspectPage(ctx, {isLanding: true}); });
    await stage(ctx, 'accessibility', () => scanAccessibility(ctx));
    if (profile.family === 'mobile') await stage(ctx, 'phone layout', () => checkPhoneLayout(ctx));
    const urls = await stage(ctx, 'link discovery', () => allInternalPaths(ctx)) || new Map();
    if (isPrimary) await stage(ctx, 'link check', () => checkLinks(ctx, urls));
    await stage(ctx, 'journeys', () => runJourneys(ctx));
    picks = await stage(ctx, 'page sampling', () => samplePages(ctx, urls)) || [];
    if (mode === 'intelligent' && isPrimary) await stage(ctx, 'AI exploration', () => exploreWithAi(ctx));
    return {context: contextOptions(profile), detailUrl: picks.find(p => ctx.cfg.detailPathPrefixes.some(x => p.path.startsWith(x)))?.url};
  } finally {
    await context.tracing.stop({path: path.join(out, `trace-${name}.zip`)}).catch(() => {});
    await context.close().catch(() => {});
  }
}

async function measurePerformance(deviceName, target) {
  const ctx = {name: deviceName};
  const profile = DEVICE_PROFILES[deviceName];
  if (profile.engine !== 'chromium' || aborted) return;
  const browser = await getBrowser('chromium');
  for (const url of [config.url, target.detailUrl].filter(Boolean)) {
    await stage(ctx, `performance ${pathOf(url)}`, async () => {
      const metrics = await measurePage(browser, url, target.context);
      const p = pathOf(url);
      report.performance.push({device: deviceName, path: p, metrics});
      for (const {highlight, ...f} of analyzePerformance(metrics, p)) upsertFinding(report.findings, {...f, device: deviceName, page: templateOf(p)});
    });
  }
}

function finalizeFindings() {
  const previous = new Set((memory.lastFindings || []).map(x => x.fingerprint));
  for (const f of report.findings) {
    f.trend = previous.has(f.fingerprint) ? 'REPEATED' : 'NEW';
    f.occurrences = (memory.observations[f.fingerprint]?.occurrences || 0) + 1;
  }
  report.findings = sortFindings(report.findings, config.devices[0]);
  report.blockers = report.findings.filter(f => f.severity === 'P0').length;
}

try {
  console.log(`Starting ${mode} audit of ${config.url} (${config.devices.join(', ')})`);
  let primaryResult = null;
  for (const [index, device] of config.devices.entries()) {
    if (aborted) break;
    const result = await auditDevice(device, index === 0);
    if (index === 0) primaryResult = result;
  }
  if (primaryResult) await measurePerformance(config.devices[0], primaryResult);
  finalizeFindings();
  if (mode === 'intelligent' && report.actions.length && !aborted) {
    try {
      const evaluation = await evaluateEvidence({config, results: report, outDir: out});
      report.aiSummary = cleanText(evaluation.summary, 600);
      const validEvidence = new Set([...report.actions.map(x => x.id), ...report.screenshots]);
      report.suggestions = (evaluation.suggestions || []).filter(x => validEvidence.has(x.evidenceStep)).slice(0, 8);
    } catch (e) { report.errors.push(`Claude UX evaluation unavailable: ${cleanText(e.message, 250)}`); }
  }
  // "Not seen this time" only means something if the run actually looked everywhere.
  if (!aborted) report.priorIssuesNotObserved = (memory.lastFindings || []).filter(x => !report.findings.some(y => y.fingerprint === x.fingerprint)).map(x => x.title).slice(0, 20);
  for (const [device, list] of Object.entries(report.coverage.missingControls)) report.errors.push(`${device}: configured controls not found, so not tested: ${list.join(', ')}`);
  report.status = aborted ? 'TIMED_OUT' : !report.actions.length ? 'NO_ACTIONS' : report.errors.length ? 'COMPLETED_WITH_LIMITATIONS' : 'COMPLETED';
} catch (e) {
  report.status = 'FAILED';
  report.errors.push(cleanText(e.message, 400));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  saveReport(report, out);
  saveMemory(memory, report, memoryFile);
  console.log(`Audit finished: ${report.actions.length} actions, ${report.findings.length} findings (${report.blockers} blockers), ${report.errors.length} limitations. Report: ${out}/site/index.html`);
}
