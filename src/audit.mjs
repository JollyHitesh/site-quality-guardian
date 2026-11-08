// Runs one complete audit of one site. Everything site-specific comes from the config.
import fs from 'node:fs';
import path from 'node:path';
import {chromium, webkit, devices} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {isAllowedUrl, isExcludedPath, cleanText, safeFilename, safeSearchQuery, findInjectionText} from './security.mjs';
import {forDevice, deviceShare, DEVICE_PROFILES} from './config.mjs';
import {loadMemory, saveMemoryFile, annotateFindings, learnFromRun, recordIncompleteRun, hotTemplates} from './memory.mjs';
import {observe, act, settle, locateControl, SERVER_ERROR_PAGE} from './browser.mjs';
import {collectSignals, analyzeSignals, analyzeSticky, measureSticky, scrollThrough, templateOf} from './checks.mjs';
import {measurePage, analyzePerformance} from './perf.mjs';
import {upsertFinding, sortFindings, saveReport} from './report.mjs';
import {createAi, AiStopped, proposeGoals, planNextStep, reviewEvidence, controlsForPrompt, cleanAiText, cleanLessons} from './claude.mjs';
import {nextScreeningPlausibility, extractScreenings, readJsonLd, readPageText, compareWithRendered, validateBooking, chooseSample, matchOnSourcePage, summarizeVerification, sha256} from './showtimes.mjs';
import {evaluateCheck, isUsableCheck, visibleBookingLinks, quoteIsOnPage, progressOf, initialTurns, extendTurns, classifyGoal, summarizeGoals} from './goals.mjs';
import {redactText} from './redact.mjs';
import {createPolicy, createSafetyLog, installGuard, fetchRobots, robotsAllows} from './guard.mjs';
import {controlKey, stateKeyOf, createGraph, addState, nextCandidate, markTried, graphSummary} from './explorer.mjs';
import {UxAuditor} from './ux-audit.mjs';
import {learnUx} from './ux-memory.mjs';
import {listingFingerprint, checkCommutative, checkEmptyResult, checkFilterSemantics, detectAnomalies, updateBaseline, sameListing} from './invariants.mjs';

const ENGINES = {chromium, webkit};
const REVERIFY_LIMIT = 10;
// When a site's protection refuses the audit, these say nothing about the site itself.
const ACCESS_SHADOWED = new Set(['page-http-error', 'page-http', 'broken-internal-link', 'resource-http-error', 'request-failed', 'javascript-error', 'console-error', 'soft-error-page', 'blank-page', 'site-unreachable', 'control-no-effect', 'control-obscured', 'filter-empty-unexplained', 'filter-order-dependent', 'filter-semantics', 'state-lost-on-reload', 'search-no-results', 'goal-failed']);
const ACCESS_BLOCK_RATIO = 0.2;
const ACCESS_BLOCK_MIN_ATTEMPTS = 5;
const REVERIFIABLE = new Set(['showtime-data-mismatch', 'control-obscured', 'page-http-error', 'resource-http-error', 'broken-internal-link', 'control-no-effect', 'javascript-error', 'request-failed', 'site-unreachable', 'page-http', 'broken-image']);
const pathOf = url => { try { return new URL(url).pathname; } catch { return String(url).slice(0, 80); } };

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

export class Audit {
  constructor({config: siteConfig, mode, out, memoryFile, trace = false, now = () => new Date()}) {
    // A UX audit has its own devices and budgets. Every other mode keeps the site's settings.
    const config = mode === 'ux' ? {...siteConfig, devices: siteConfig.ux.devices, screenshotLimit: siteConfig.ux.screenshotLimit, maxRunMinutes: Math.max(siteConfig.maxRunMinutes, siteConfig.ux.maxRunMinutes), ai: {...siteConfig.ai, maxCalls: siteConfig.ux.maxCalls}} : siteConfig;
    Object.assign(this, {config, mode, out, memoryFile, trace, now});
    this.aiReserveCalls = mode === 'ux' ? config.ux.reviewCalls + 1 : 1;
    this.browsers = {};
    this.safety = createSafetyLog();
    this.graph = createGraph();
    this.highlighted = new Set();
    this.actionId = 0;
    this.shotCounter = 0;
    this.aborted = false;
    this.screenings = [];
    this.stateMetrics = {};
    this.templates = new Set();
    this.inspectedTemplates = new Set();
    this.a11yTemplates = new Set();
    this.checksRun = new Set();
    this.access = {attempted: 0, denied: 0, challenged: 0, landingDenied: false, samples: []};
    this.lessons = [];
    this.ai = createAi(config);
    this.robots = {rules: [], found: false};
    this.report = {
      schemaVersion: 2,
      config: {name: config.name, slug: config.slug, url: config.url, timezone: config.timezone, devices: config.devices},
      mode, startedAt: now().toISOString(), finishedAt: null, status: 'RUNNING', blockers: 0,
      actions: [], findings: [], screenshots: [], visitedPaths: [], performance: [], suggestions: [], goals: [], errors: [], networkSignals: [],
      coverage: {missingHints: {}, linksChecked: 0, a11yPagesScanned: 0, templates: [], states: [], stateCount: 0},
      showtimes: {extracted: 0, renderIssues: 0, results: [], summary: summarizeVerification([])},
      booking: {status: 'NOT_VERIFIED', linksObserved: 0, invalid: 0, note: 'Sponsored redirects are never requested. Destinations come from data the site publishes.'},
      safety: {}, ai: {}, model: {},
    };
  }

  log(message) { console.log(`[${Math.round(process.uptime())}s] ${this.config.slug}: ${message}`); }
  /** Records a refusal from the site's own protection, and stops once continuing is pointless. */
  noteDenied(url, status, headers = {}) {
    const {access} = this;
    access.denied++;
    if (headers['cf-mitigated']) access.challenged++;
    if (access.samples.length < 6) access.samples.push({path: pathOf(url), status, server: cleanText(headers.server, 30), mitigated: cleanText(headers['cf-mitigated'], 30)});
    if (this.isAccessBlocked() && access.attempted >= ACCESS_BLOCK_MIN_ATTEMPTS && access.denied / access.attempted >= 0.5 && !this.aborted) {
      this.blockedEarly = true;
      this.aborted = true; // no further requests: more would only annoy the site's protection
    }
  }

  isAccessBlocked() {
    const {attempted, denied, landingDenied} = this.access;
    return landingDenied || (attempted >= ACCESS_BLOCK_MIN_ATTEMPTS && denied / attempted >= ACCESS_BLOCK_RATIO);
  }

  limitation(message) { this.report.errors.push(cleanText(redactText(message), 400)); }

  addFinding(ctx, args) {
    return upsertFinding(this.report.findings, {device: ctx.name, page: ctx.page ? templateOf(pathOf(ctx.page.url())) : undefined, stepId: ctx.step, ...args});
  }

  /** One failing stage must not cost the rest of the audit. */
  async stage(ctx, name, fn) {
    if (this.aborted) return undefined;
    this.log(`${ctx.name}: ${name}`);
    try { return await fn(); } catch (e) {
      if (!this.aborted) this.limitation(`${ctx.name} / ${name}: ${e.message}`);
      return undefined;
    }
  }

  async getBrowser(engine) {
    this.browsers[engine] ||= await ENGINES[engine].launch({headless: true, env: {PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', DISPLAY: process.env.DISPLAY || ''}});
    return this.browsers[engine];
  }

  contextOptions(profile) {
    const base = profile.descriptor ? {...devices[profile.descriptor]} : {viewport: profile.viewport, deviceScaleFactor: 1};
    delete base.defaultBrowserType;
    const options = {...base, locale: this.config.locale || 'en-GB', timezoneId: this.config.timezone, acceptDownloads: false, permissions: [], serviceWorkers: 'block'};
    if (this.config.userAgentSuffix) {
      options.userAgent = `${base.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'} ${this.config.userAgentSuffix}`;
    }
    return options;
  }

  /** Every context goes through the guard. Audit pages may not reach booking or external sites. */
  async newGuardedContext(profile, policy = this.policy) {
    const browser = await this.getBrowser(profile.engine);
    const context = await browser.newContext(this.contextOptions(profile));
    await installGuard(context, policy, this.safety);
    return context;
  }

  record(ctx, type, target, result, extra = {}) {
    const id = `A${String(++this.actionId).padStart(3, '0')}`;
    const outcome = result.ok ? 'PASS' : `SKIPPED/ERROR: ${cleanText(result.reason, 110)}`;
    this.report.actions.push({id, at: this.now().toISOString(), device: ctx.name, type, target: cleanText(target, 120), outcome, changed: result.changed ?? undefined, navigated: result.navigated ?? undefined, ms: result.ms, after: result.after || null, ...extra});
    if (result.after?.url) {
      const p = pathOf(result.after.url);
      if (!this.report.visitedPaths.includes(p)) this.report.visitedPaths.push(p);
      this.templates.add(templateOf(p));
    }
    ctx.step = id;
    return id;
  }

  async drawHighlights(page, rects) {
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

  /** Saves the evidence image, plus a smaller copy that fits Claude's image limits. */
  async shot(ctx, name, {highlight} = {}) {
    if (ctx.shots <= 0 || this.shotCounter >= this.config.screenshotLimit) return null;
    if (!isAllowedUrl(ctx.page.url(), this.config) || !(await pageIsSafeToCapture(ctx.page))) return null;
    const base = `${String(this.shotCounter + 1).padStart(2, '0')}-${safeFilename(ctx.name)}-${safeFilename(name)}`;
    const file = `screenshots/${base}.png`;
    try {
      if (highlight?.length) await this.drawHighlights(ctx.page, highlight);
      await ctx.page.screenshot({path: path.join(this.out, file), fullPage: false, animations: 'disabled', timeout: 10000});
      if (this.mode !== 'smoke') await ctx.page.screenshot({path: path.join(this.out, 'ai', `${base}.jpg`), type: 'jpeg', quality: 60, scale: 'css', animations: 'disabled', timeout: 10000}).catch(() => {});
      this.shotCounter++;
      ctx.shots--;
      this.report.screenshots.push(file);
      return file;
    } catch (e) {
      this.limitation(`Screenshot failed: ${e.message}`);
      return null;
    } finally {
      if (highlight?.length) await ctx.page.evaluate(() => { document.querySelectorAll('[data-guardian-highlight]').forEach(n => n.remove()); window.scrollTo(0, 0); }).catch(() => {});
    }
  }

  async applyFindings(ctx, findings) {
    for (const {highlight, ...f} of findings) {
      const key = `${f.kind}:${ctx.name}`;
      let screenshot = null;
      if (highlight?.length && !this.highlighted.has(key)) {
        this.highlighted.add(key);
        screenshot = await this.shot(ctx, f.kind, {highlight});
      }
      this.addFinding(ctx, {...f, evidence: screenshot ? {...f.evidence, screenshot} : f.evidence});
    }
  }

  async inspectPage(ctx, {isLanding = false} = {}) {
    if (ctx.documentStatus >= 400) return; // already reported as an HTTP error; its error page is not a page to judge
    const raw = await collectSignals(ctx.page, {primaryPattern: ctx.cfg.primaryActionPattern});
    this.inspectedTemplates.add(templateOf(pathOf(ctx.page.url())));
    await this.applyFindings(ctx, analyzeSignals(raw, {family: ctx.profile.family, isLanding}));
    this.report.booking.linksObserved = (this.report.booking.linksObserved || 0) + raw.bookingLinkCount;
    this.report.booking.invalid += raw.invalidBookingLinks.length;
    const injected = findInjectionText(await readPageText(ctx.page));
    if (injected) this.addFinding(ctx, {kind: 'ai-directed-text', title: 'Page contains text that appears aimed at AI agents', severity: 'P2', status: 'LIKELY', evidence: {excerpt: cleanText(injected, 200)}});
    await this.checkShowtimes(ctx);
  }

  /** Compares published event data against the page, and against the clock. */
  async checkShowtimes(ctx) {
    if (!this.config.showtimes.enabled || this.mode === 'ux') return;
    const blocks = await readJsonLd(ctx.page);
    const found = extractScreenings(blocks, this.config.timezone);
    const known = new Set(this.screenings.map(s => `${s.title}|${s.startDate}|${s.venue}`));
    for (const s of found) if (!known.has(`${s.title}|${s.startDate}|${s.venue}`)) this.screenings.push(s);
    this.report.showtimes.extracted = this.screenings.length;

    const pagePath = pathOf(ctx.page.url());
    if (!ctx.cfg.detailPathPrefixes.some(p => pagePath.startsWith(p))) return;
    if (this.report.showtimes.renderChecks >= this.config.showtimes.maxRenderChecks) return;
    this.report.showtimes.renderChecks = (this.report.showtimes.renderChecks || 0) + 1;

    await this.checkBooking(ctx, found.filter(s => pathOf(s.pageUrl || '') === pagePath));
    const expandedAll = await this.expandShowtimes(ctx);
    const text = await readPageText(ctx.page);
    const now = this.now();
    if (!expandedAll) return; // some showtimes stayed collapsed, so absence proves nothing
    for (const issue of compareWithRendered(found.filter(s => pathOf(s.pageUrl || '') === pagePath), text, now)) {
      const s = issue.screening;
      this.report.showtimes.renderIssues++;
      if (issue.type === 'past') {
        this.addFinding(ctx, {kind: 'past-screening-published', title: 'Page publishes a screening that has already started', severity: 'P2', status: 'LIKELY', evidence: {url: ctx.page.url(), film: s.title, venue: s.venue, start: `${s.date} ${s.time}`, minutesAgo: issue.minutesAgo}});
      } else {
        this.addFinding(ctx, {kind: 'showtime-data-mismatch', title: 'Published screening data does not match the page', severity: 'P1', status: 'LIKELY', evidence: {url: ctx.page.url(), film: s.title, venue: s.venue, structuredStart: `${s.date} ${s.time}`, timeOnPage: issue.timeShown, dateOnPage: issue.dateShown}});
      }
    }
    if (ctx.cfg.checks.nextScreening) {
      const plausibility = nextScreeningPlausibility(text, now, this.config.timezone);
      if (plausibility.status === 'PAST_NEXT_SHOWTIME') {
        this.addFinding(ctx, {kind: 'past-next-screening', title: 'Movie page labels a past screening as next', severity: 'P1', evidence: {url: ctx.page.url(), ...plausibility}});
      }
    }
  }

  /** Pages often collapse long showtime lists, and a collapsed time would look missing. */
  async expandShowtimes(ctx) {
    const pattern = new RegExp(this.config.showtimes.expandPattern, 'i');
    for (let i = 0; i < 12; i++) {
      const button = ctx.page.getByRole('button', {name: pattern}).filter({visible: true}).first();
      if (await button.count() === 0) {
        await ctx.page.waitForTimeout(800); // let the last expansion render before reading
        return true;
      }
      const clicked = await button.click({timeout: 3000}).then(() => true, () => false);
      if (!clicked) return false;
      await ctx.page.waitForTimeout(250);
    }
    return false;
  }

  /** Checks a sample against the cinemas' own sites: the one independent source of truth. */
  async verifyShowtimes(deviceName) {
    if (!this.config.showtimes.enabled || this.aborted) return;
    const sample = chooseSample(this.screenings, this.config.showtimes.sampleSize, this.now(), this.memory.sources);
    if (!sample.length) {
      this.limitation('Showtimes: no upcoming screenings with a cinema URL were found, so nothing could be checked against a source.');
      return;
    }
    const profile = DEVICE_PROFILES[deviceName];
    for (const screening of sample) {
      if (this.aborted) return;
      const result = await this.verifyOne(screening, profile);
      this.report.showtimes.results.push(result);
      this.log(`showtime source ${result.status}: ${screening.venue}`);
      if ([404, 410].includes(result.httpStatus)) {
        upsertFinding(this.report.findings, {kind: 'source-link-broken', title: `Cinema website link is dead: ${cleanText(screening.venue, 40)}`, severity: 'P2', status: 'LIKELY', device: deviceName, mergeKey: screening.venueUrl, scope: screening.venueUrl, evidence: {venue: screening.venue, url: screening.venueUrl, status: result.httpStatus}});
      }
      if (result.status === 'MISMATCH') {
        upsertFinding(this.report.findings, {kind: 'showtime-source-mismatch', title: `Showtime differs from the cinema's site: ${cleanText(screening.venue, 40)}`, severity: 'P1', status: 'LIKELY', device: deviceName, mergeKey: `${screening.title}|${screening.date}`, scope: screening.venueUrl, evidence: result});
      }
    }
    this.report.showtimes.summary = summarizeVerification(this.report.showtimes.results);
  }

  async verifyOne(screening, profile) {
    const base = {film: screening.title, venue: screening.venue, listed: `${screening.date} ${screening.time}`, source: screening.venueUrl, checkedAt: this.now().toISOString()};
    let host;
    try { host = new URL(screening.venueUrl); } catch { return {...base, status: 'UNAVAILABLE', detail: 'invalid source URL'}; }
    if (host.protocol !== 'https:' && host.protocol !== 'http:') return {...base, status: 'UNAVAILABLE', detail: 'unsupported source URL'};
    const robots = await fetchRobots(host.origin, this.config.userAgentSuffix || 'Mozilla/5.0');
    if (!robotsAllows(robots.rules, host.pathname)) return {...base, status: 'UNAVAILABLE', detail: 'source robots.txt disallows this page'};
    const policy = createPolicy({...this.config, allowedHosts: [host.hostname], excludePaths: []}, {mode: 'source'});
    const context = await this.newGuardedContext(profile, policy);
    try {
      const page = await context.newPage();
      const response = await page.goto(screening.venueUrl, {waitUntil: 'domcontentloaded', timeout: 25000});
      if (!response || response.status() >= 400) return {...base, status: 'UNAVAILABLE', httpStatus: response?.status() ?? null, detail: `source returned HTTP ${response?.status() ?? 'nothing'}`};
      await settle(page, 5000);
      const text = await readPageText(page);
      await page.waitForTimeout(Math.max(1000, this.config.rateLimitMs));
      const verdict = matchOnSourcePage(screening, text, this.now());
      return {...base, ...verdict, sourceSha256: sha256(text), sourceChars: text.length};
    } catch (e) {
      return {...base, status: 'UNAVAILABLE', detail: cleanText(e.message, 140)};
    } finally {
      await context.close().catch(() => {});
    }
  }

  async scanAccessibility(ctx) {
    const result = await new AxeBuilder({page: ctx.page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    this.report.coverage.a11yPagesScanned++;
    this.a11yTemplates.add(templateOf(pathOf(ctx.page.url())));
    const severity = {critical: 'P1', serious: 'P2'};
    for (const v of result.violations) {
      this.addFinding(ctx, {kind: `accessibility-${v.id}`, title: `Accessibility: ${v.help}`, severity: severity[v.impact] || 'P3', evidence: {impact: v.impact, rule: v.id, help: v.helpUrl, affected: v.nodes.length, selectors: v.nodes.slice(0, 5).map(x => x.target)}});
    }
  }

  async gotoSettled(ctx, url) {
    const response = await ctx.page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
    await settle(ctx.page);
    return response;
  }

  async dismissConsent(ctx) {
    for (const label of ctx.cfg.consentButtons) {
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
  async freshStart(ctx) {
    await ctx.page.context().clearCookies();
    await ctx.page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage may be unavailable */ } }).catch(() => {});
    await this.gotoSettled(ctx, this.config.url);
    await this.dismissConsent(ctx).catch(() => {});
  }

  attachListeners(ctx) {
    const {page, name} = ctx;
    const seenConsole = new Set();
    page.on('popup', popup => { ctx.popups = (ctx.popups || 0) + 1; popup.close().catch(() => {}); }); // only this page's popups: tools like axe open their own
    page.on('pageerror', e => {
      if (/^(TypeError: )?(Load failed|Failed to fetch|NetworkError)/i.test(e.message)) return; // a fetch cut off by navigation; real failures appear as failed requests
      this.addFinding(ctx, {kind: 'javascript-error', title: `Uncaught JavaScript error: ${cleanText(e.message, 90)}`, severity: 'P1', evidence: {message: cleanText(e.message, 300), pageUrl: page.url()}});
    });
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = cleanText(msg.text(), 200);
      if (/Content Security Policy|Failed to load resource|ERR_BLOCKED_BY_CLIENT/i.test(text) || seenConsole.has(text) || seenConsole.size >= 5) return;
      seenConsole.add(text);
      this.addFinding(ctx, {kind: 'console-error', title: `Console error: ${cleanText(text, 90)}`, severity: 'P3', evidence: {message: text}});
    });
    page.on('response', res => {
      const isDocument = res.request().resourceType() === 'document';
      const isPage = isDocument && res.frame() === page.mainFrame();
      if (isPage) ctx.documentStatus = res.status();
      if (!isAllowedUrl(res.url(), this.config)) return;
      if (isPage) this.access.attempted++;
      if ([403, 429].includes(res.status())) {
        const headers = res.headers();
        this.noteDenied(res.url(), res.status(), headers);
        if (headers['cf-mitigated']) return; // a bot challenge is not a defect in the site
      }
      if (res.status() < 400) return;
      this.addFinding(ctx, {kind: isDocument ? 'page-http-error' : 'resource-http-error', title: `${isDocument ? 'Page' : 'Request'} ${templateOf(pathOf(res.url()))} returned HTTP ${res.status()}`, severity: isDocument ? 'P1' : 'P2', evidence: {url: res.url().slice(0, 180), status: res.status(), type: res.request().resourceType()}});
    });
    page.on('requestfailed', req => {
      if (this.safety.blockedRequests.has(req)) return; // our own guard, not a site problem
      const reason = req.failure()?.errorText || 'unknown';
      if (/ERR_ABORTED|cancelled/i.test(reason)) return; // normal when navigating away mid-request
      let host = 'unknown';
      try { host = new URL(req.url()).hostname; } catch { /* keep the placeholder */ }
      if (/csp/i.test(reason)) {
        this.addFinding(ctx, {kind: 'csp-blocked', title: `Content-Security-Policy blocks requests to ${host}`, severity: 'P3', evidence: {url: req.url().slice(0, 180), reason}});
      } else if (isAllowedUrl(req.url(), this.config)) {
        this.addFinding(ctx, {kind: 'request-failed', title: `Requests to ${templateOf(pathOf(req.url()))} failed`, severity: 'P2', evidence: {url: req.url().slice(0, 180), reason}});
      } else {
        this.report.networkSignals.push({device: name, host, reason});
      }
    });
  }

  /** Same-site links on the current page, including those inside closed menus. */
  async allInternalPaths(ctx) {
    const hrefs = await ctx.page.$$eval('a[href]', anchors => anchors.map(a => a.href));
    const urls = new Map();
    for (const href of hrefs) {
      if (!isAllowedUrl(href, ctx.cfg)) continue;
      const u = new URL(href);
      if (u.pathname !== '/' && !isExcludedPath(u.pathname, ctx.cfg) && robotsAllows(this.robots.rules, u.pathname)) urls.set(u.pathname, u.origin + u.pathname);
    }
    return urls;
  }

  async samplePages(ctx, urls) {
    const limit = ctx.isPrimary ? this.config.maxPages : Math.min(3, this.config.maxPages);
    const picks = choosePages(urls, ctx.cfg, this.memory.coverage.paths, limit);
    for (const pick of picks) {
      if (this.aborted) return picks;
      await this.stage(ctx, `page ${pick.path}`, async () => {
        const response = await this.gotoSettled(ctx, pick.url);
        this.record(ctx, 'visit', pick.path, {ok: !!response?.ok(), reason: `HTTP ${response?.status()}`, after: {url: ctx.page.url(), title: await ctx.page.title()}});
        if (!response?.ok()) return;
        await scrollThrough(ctx.page);
        await this.inspectPage(ctx);
        await this.stage(ctx, `accessibility ${pick.path}`, () => this.scanAccessibility(ctx));
        await this.shot(ctx, `page-${pick.template}`);
        await ctx.page.waitForTimeout(this.config.rateLimitMs);
      });
    }
    return picks;
  }

  async checkPhoneLayout(ctx) {
    const sticky = await measureSticky(ctx.page);
    await this.applyFindings(ctx, analyzeSticky(sticky));
    const {width, height} = ctx.page.viewportSize();
    await ctx.page.setViewportSize({width: height, height: width});
    try {
      await ctx.page.waitForTimeout(400);
      const raw = await collectSignals(ctx.page, {primaryPattern: ctx.cfg.primaryActionPattern});
      if (raw.docWidth > raw.viewportWidth + 2) {
        this.addFinding(ctx, {kind: 'layout-overflow', title: 'Content is wider than the screen, causing sideways scrolling', severity: 'P1', evidence: {orientation: 'landscape', viewportWidth: raw.viewportWidth, documentWidth: raw.docWidth}});
      }
      await this.applyFindings(ctx, analyzeSticky(await measureSticky(ctx.page), {landscape: true}));
      await this.shot(ctx, 'landscape');
    } finally {
      await ctx.page.setViewportSize({width, height});
    }
  }

  async checkLinks(ctx, urls) {
    const perTemplate = {};
    const toCheck = [...urls.entries()].filter(([p]) => {
      const t = templateOf(p);
      perTemplate[t] = (perTemplate[t] || 0) + 1;
      return perTemplate[t] <= 5;
    }).slice(0, this.config.linkCheckLimit);
    for (const [p, url] of toCheck) {
      if (this.aborted) return;
      const res = await ctx.page.context().request.get(url, {timeout: 12000, failOnStatusCode: false}).catch(() => null);
      this.report.coverage.linksChecked++;
      if (res) this.access.attempted++;
      if (res && [403, 429].includes(res.status())) {
        const headers = res.headers();
        this.noteDenied(url, res.status(), headers);
        if (headers['cf-mitigated']) continue;
      }
      if (res?.status() === 429) { this.limitation('Link check stopped early: site is rate limiting (HTTP 429)'); return; }
      if (res && res.status() >= 400) {
        this.addFinding(ctx, {kind: 'broken-internal-link', title: `Internal link ${p} returns HTTP ${res.status()}`, severity: 'P1', evidence: {url, status: res.status(), linkedFrom: ctx.page.url()}});
      }
      await ctx.page.waitForTimeout(Math.round(this.config.rateLimitMs / 2));
    }
  }

  recordStateMetrics(key, observation, ctx) {
    const metricKey = `${ctx.name}|${key}`;
    const current = {itemCount: observation.listing.count, textLength: observation.textLength, controlCount: observation.controls.length, headings: observation.headings};
    const baseline = this.memory.baselines[metricKey];
    for (const finding of detectAnomalies(current, baseline, stateLabel(observation))) this.addFinding(ctx, finding);
    this.stateMetrics[metricKey] = updateBaseline(baseline, current);
  }

  /** Runs one step and records the result, the outcome and any defect it exposed. */
  async runStep(ctx, control, {value, source = 'explore', state, changeTimeout} = {}) {
    if (ctx.budget <= 0 || this.aborted) return null;
    const before = await observe(ctx.page, ctx.cfg);
    const key = controlKey(control);
    const writesBefore = this.safety.firstPartyWritesBlocked;
    const popupsBefore = ctx.popups || 0;
    if (ctx.uxTrace) await ctx.uxTrace.beforeAction(control);
    const result = await act(ctx.page, control, ctx.cfg, {value, changeTimeout});
    ctx.budget--;
    result.guardBlockedWrite = this.safety.firstPartyWritesBlocked > writesBefore;
    let after = null;
    if (result.ok) {
      after = await observe(ctx.page, ctx.cfg).catch(() => null);
      if (after) result.after = {url: after.url, title: after.title, headings: after.headings.slice(0, 4), itemCount: after.listing.count, stateKey: stateKeyOf(after)};
    }
    const target = control.name || control.placeholder || key;
    const sameTemplate = after ? templateOf(pathOf(before.url)) === templateOf(pathOf(after.url)) : false;
    const listingChanged = after ? !sameListing(listingFingerprint(before.listing), listingFingerprint(after.listing)) : false;
    const paramsChanged = after ? changedParams(before.url, after.url) : [];
    const id = this.record(ctx, control.classification.kind, target, result, {controlKey: key, source, listingChanged, sameTemplate, paramsChanged, fromState: state?.key || stateKeyOf(before), value: value ? cleanText(value, 70) : undefined});
    if (ctx.uxTrace) await ctx.uxTrace.afterAction({id, control, key, result, before, after});
    // With a drawer that we opened still showing, being covered is expected and says nothing.
    if (result.code === 'obscured' && !state?.path?.length) this.addFinding(ctx, {kind: 'control-obscured', title: `Something covers the "${cleanText(target, 40)}" control, so it cannot be tapped`, severity: 'P1', status: 'LIKELY', scope: key, evidence: {reason: result.reason, reproduce: {controlKey: key, path: state?.path || []}}});
    if (!result.ok || !after) return {...result, id, before, after, key};
    if (result.changed) (ctx.workedBefore ||= new Set()).add(key);
    if (result.guardBlockedWrite) {
      // The page is now broken by our own guard, so nothing it shows is evidence about the site.
      this.limitation(`"${cleanText(target, 40)}" sends a write request that was blocked, so its result could not be judged. If it only reads data, declare it in readOnly.allowPostBodies.`);
      return {...result, id, before, after, key, unjudged: true};
    }
    const reproduce = {controlKey: key, css: control.css, path: state?.path || []};
    const openedPopup = (ctx.popups || 0) > popupsBefore;
    if (result.changed === false && !result.navigated && !openedPopup && !ctx.workedBefore?.has(key)) {
      this.addFinding(ctx, {kind: 'control-no-effect', title: `"${cleanText(target, 40)}" changed nothing on the page`, severity: 'P2', status: 'LIKELY', scope: key, evidence: {action: control.classification.kind, waitedMs: 3000, reproduce}});
    }
    if (control.classification.kind === 'search' && after.emptyMessage) {
      this.addFinding(ctx, {kind: 'search-no-results', title: `Search for "${cleanText(value, 40)}" returned no results`, severity: 'P2', status: 'LIKELY', evidence: {query: cleanText(value, 70)}});
    }
    // A crashed page has no list. That is reported from the HTTP failure, not as an empty filter.
    if (sameTemplate && !SERVER_ERROR_PAGE.test(after.text)) {
      for (const finding of checkEmptyResult(target, before.listing, after.listing, after.emptyMessage)) this.addFinding(ctx, finding);
    }
    for (const rule of ctx.cfg.filterSemantics) {
      if (!new RegExp(rule.control, 'i').test(target)) continue;
      this.checksRun.add('filter-semantics');
      for (const finding of checkFilterSemantics(rule, target, after.listing)) this.addFinding(ctx, finding);
    }
    return {...result, id, before, after, key};
  }

  /** Returns to a previously discovered state by repeating the steps that reached it. */
  async goToState(ctx, state) {
    if (ctx.currentKey === state.key) return true;
    await this.freshStart(ctx);
    for (const step of state.path) {
      const observation = await observe(ctx.page, ctx.cfg);
      const control = locateControl(observation, step, controlKey);
      if (!control) return false;
      if (!(await act(ctx.page, control, ctx.cfg)).ok) return false;
    }
    ctx.currentKey = state.key;
    return true;
  }

  searchValue(ctx) {
    const queries = ctx.cfg.searchQueries;
    if (!queries.length) return safeSearchQuery((this.config.name || '').split(/\s+/)[0]) || 'a';
    ctx.searchIndex = (ctx.searchIndex || 0) + 1;
    return queries[ctx.searchIndex % queries.length];
  }

  async recordObservedState(ctx, observation, path) {
    const key = stateKeyOf(observation);
    const isNew = !this.graph.states[key];
    const state = addState(this.graph, key, observation, path, this.config.explore);
    ctx.currentKey = key;
    if (state && isNew) {
      this.recordStateMetrics(key, observation, ctx);
      this.report.coverage.states.push(key);
      this.templates.add(state.template);
    }
    return {state, isNew};
  }

  /** The discovery loop: try whatever is least known, and let each new state add more to try. */
  async explore(ctx) {
    await this.freshStart(ctx);
    const root = await observe(ctx.page, ctx.cfg);
    await this.recordObservedState(ctx, root, []);
    const hints = [...ctx.cfg.filters, ...ctx.cfg.views, ...ctx.cfg.safeButtons];
    const scoring = {counts: this.memory.coverage.controls, hints, hotTemplates: hotTemplates(this.memory), device: ctx.name};
    const limit = ctx.isPrimary ? Math.max(5, ctx.budget - this.reservedBudget(ctx)) : ctx.budget;
    let used = 0;
    while (ctx.budget > 0 && used < limit && !this.aborted) {
      const candidate = nextCandidate(this.graph, scoring, {...this.config.explore, device: ctx.name});
      if (!candidate) break;
      const {state, control, key} = candidate;
      markTried(this.graph, state, key);
      used++;
      if (!(await this.goToState(ctx, state).catch(() => false))) continue;
      const live = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
      if (!live) { ctx.currentKey = null; continue; }
      const value = live.classification.kind === 'search' ? this.searchValue(ctx) : undefined;
      const result = await this.runStep(ctx, live, {value, state});
      ctx.currentKey = null;
      if (!result?.after || result.unjudged) continue;
      const {state: reached, isNew} = await this.recordObservedState(ctx, result.after, [...state.path, key]);
      this.graph.edges.push({from: state.key, control: live.name || key, to: stateKeyOf(result.after), changed: result.changed ?? null, step: result.id});
      if (isNew && reached) {
        await this.inspectPage(ctx);
        await this.shot(ctx, `state-${reached.template.replace(/\W+/g, '-')}`);
      }
    }
    this.report.coverage.missingHints[ctx.name] = hints.filter(h => !Object.values(this.graph.states).some(s => s.controls.some(c => c.name === h)));
  }

  aiReserve() { return this.config.ai.maxGoals * this.config.ai.maxStepsPerGoal * 2; }

  /** Static check of ticket destinations: reads published data and sends no request to a redirect. */
  async checkBooking(ctx, screenings) {
    const prefix = this.config.booking.redirectPrefix;
    const links = prefix ? await ctx.page.$$eval(`a[href^="${prefix}"]`, anchors => anchors.map(a => ({rel: a.rel}))) : [];
    const result = validateBooking(screenings, links, this.config, this.now());
    const booking = this.report.booking;
    booking.status = 'STATIC_ONLY';
    booking.eventsChecked = (booking.eventsChecked || 0) + result.eventsChecked;
    booking.withDestination = (booking.withDestination || 0) + result.withDestination;
    booking.redirectLinks = (booking.redirectLinks || 0) + result.redirectLinks;
    booking.destinationHosts = booking.destinationHosts || {};
    for (const [host, n] of Object.entries(result.destinationHosts)) booking.destinationHosts[host] = (booking.destinationHosts[host] || 0) + n;
    if (result.missing.length) this.addFinding(ctx, {kind: 'booking-destination-missing', title: 'Upcoming screening publishes no ticket destination', severity: 'P2', status: 'LIKELY', evidence: {url: ctx.page.url(), screenings: result.missing.slice(0, 5)}});
    if (result.invalid.length) this.addFinding(ctx, {kind: 'booking-destination-invalid', title: 'Screening publishes an invalid ticket destination', severity: 'P2', status: 'LIKELY', evidence: {url: ctx.page.url(), screenings: result.invalid.slice(0, 5)}});
    if (result.redirectLinksMissingRel) this.addFinding(ctx, {kind: 'sponsored-link-rel-missing', title: 'Sponsored booking link is not marked as sponsored', severity: 'P3', evidence: {url: ctx.page.url(), count: result.redirectLinksMissingRel}});
  }

  reservedBudget(ctx) {
    const combos = ctx.isPrimary ? this.config.explore.maxCombos * 4 : 0;
    return combos + (this.mode === 'intelligent' && ctx.isPrimary ? this.aiReserve() : 0);
  }

  togglePairs() {
    const root = Object.values(this.graph.states).find(s => s.depth === 0);
    if (!root) return [];
    // Controls that changed the results without leaving the page behave like filters.
    const views = new Set([...this.config.views, ...Object.values(this.config.deviceOverrides).flatMap(o => o.views || [])].map(v => v.toLowerCase()));
    const worked = this.report.actions.filter(a => a.source === 'explore' && a.type !== 'search' && a.listingChanged && a.sameTemplate && a.controlKey && !views.has(a.target.toLowerCase()));
    const params = new Map(worked.map(a => [a.controlKey, a.paramsChanged || []]));
    const keys = [...params.keys()];
    const pairs = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        // Two values of one URL parameter replace each other, so order is meant to matter.
        if (!params.get(keys[i]).some(p => params.get(keys[j]).includes(p))) pairs.push([keys[i], keys[j]]);
      }
    }
    return {pairs: pairs.slice(0, this.config.explore.maxCombos), params, urlFilter: worked.find(a => a.paramsChanged?.length)?.controlKey};
  }

  /** Applies a list of controls in order, reopening drawers as needed. */
  async applySequence(ctx, keys) {
    await this.freshStart(ctx);
    for (const key of keys) {
      if (ctx.budget <= 0) return null;
      let control = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
      if (!control) {
        const opener = Object.values(this.graph.states).find(s => s.controls.some(c => controlKey(c) === key));
        for (const step of opener?.path || []) {
          const stepControl = locateControl(await observe(ctx.page, ctx.cfg), step, controlKey);
          if (stepControl) await act(ctx.page, stepControl, ctx.cfg);
        }
        control = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
      }
      if (!control) return null;
      const result = await this.runStep(ctx, control, {source: 'combo'});
      if (!result?.ok || result.unjudged) return null;
    }
    return observe(ctx.page, ctx.cfg);
  }

  /** Checks that need no expected values: order, reload and back must not lose results. */
  async runCombos(ctx) {
    const toggles = this.togglePairs();
    if (!toggles.pairs) return;
    const floor = 4 + (this.mode === 'intelligent' ? this.aiReserve() : 0);
    const {pairs, params, urlFilter} = toggles;
    if (urlFilter && ctx.budget >= 1) {
      const filtered = await this.applySequence(ctx, [urlFilter]);
      if (filtered) await this.checkReload(ctx, filtered);
    }
    const applied = (observation, key) => (params.get(key).length
      ? params.get(key).every(p => new URL(observation.url).searchParams.has(p))
      : observation.active.some(n => n.toLowerCase() === key.split('|').pop()));
    for (const [a, b] of pairs) {
      if (this.aborted || ctx.budget < floor) return;
      const ab = await this.applySequence(ctx, [a, b]);
      if (!ab || !applied(ab, a) || !applied(ab, b)) continue; // one choice replaced the other
      const ba = await this.applySequence(ctx, [b, a]);
      if (!ba || !applied(ba, a) || !applied(ba, b)) continue;
      const names = [a, b].map(k => k.split('|').pop());
      this.checksRun.add('filter-order-dependent');
      for (const finding of checkCommutative(names, listingFingerprint(ab.listing), listingFingerprint(ba.listing))) this.addFinding(ctx, finding);
    }
  }

  async checkReload(ctx, before) {
    await ctx.page.reload({waitUntil: 'domcontentloaded', timeout: 20000});
    await settle(ctx.page);
    await ctx.page.waitForTimeout(1500);
    const after = await observe(ctx.page, ctx.cfg);
    this.checksRun.add('state-lost-on-reload');
    const urlKept = new URL(after.url).search === new URL(before.url).search;
    if (!urlKept || !sameListing(listingFingerprint(before.listing), listingFingerprint(after.listing), 1)) {
      this.addFinding(ctx, {kind: 'state-lost-on-reload', title: 'Reloading a filtered page loses the filter', severity: 'P2', status: 'LIKELY', evidence: {urlBefore: before.url, urlAfter: after.url, itemsBefore: before.listing.count, itemsAfter: after.listing.count, sampleBefore: before.listing.items.slice(0, 2), sampleAfter: after.listing.items.slice(0, 2)}});
    }
  }

  memoryNotes() {
    const findings = Object.values(this.memory.findings).filter(f => f.state === 'open').slice(-20).map(f => ({title: f.title, severity: f.severity}));
    return {runs: this.memory.runs, openFindings: findings, lessons: this.memory.lessons.slice(-12).map(l => l.text)};
  }

  /** Reaches a control hidden behind a drawer by replaying what revealed it. */
  async revealControl(ctx, key) {
    let control = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
    if (control) return control;
    const opener = Object.values(this.graph.states).find(s => s.controls.some(c => controlKey(c) === key));
    for (const step of opener?.path || []) {
      const stepControl = locateControl(await observe(ctx.page, ctx.cfg), step, controlKey);
      if (stepControl) await act(ctx.page, stepControl, ctx.cfg);
    }
    control = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
    return control;
  }

  /** Controls Claude cannot see right now but the explorer already found. */
  controlCatalog(observation) {
    const here = new Set(observation.controls.map(controlKey));
    const seen = new Map();
    for (const state of Object.values(this.graph.states)) {
      for (const c of state.controls) {
        const key = controlKey(c);
        if (c.tag !== 'a' && c.classification.kind === 'activate' && !here.has(key) && !seen.has(key)) seen.set(key, c);
      }
    }
    return [...seen.entries()].slice(0, 30).map(([key, c], i) => ({ref: `k${i}`, key, name: cleanText(c.name, 60)}));
  }

  /** Claude proposes journeys and steers them. The software decides how each one ended. */
  async pursueGoals(ctx) {
    await this.freshStart(ctx);
    const landing = await observe(ctx.page, ctx.cfg);
    const landingSummary = {url: landing.url, text: landing.text.slice(0, 1500), listing: landing.listing.count, bookingLinksVisible: visibleBookingLinks(landing, ctx.cfg).length, filtersKnown: this.controlCatalog(landing).map(c => c.name).slice(0, 25)};
    const count = this.config.ai.maxGoals + 1; // one spare, in case a condition turns out to be unusable
    const proposals = await proposeGoals(this.ai, {config: this.config, siteModel: graphSummary(this.graph), memoryNotes: this.memoryNotes(), landing: landingSummary, count});
    const goals = proposals.filter(g => isUsableCheck(g.successCheck)).slice(0, this.config.ai.maxGoals);
    if (proposals.length && !goals.length) this.limitation('Claude proposed no journey with a usable success condition.');
    for (const goal of goals) {
      if (this.aborted || ctx.budget <= 0) return;
      await this.runJourney(ctx, goal);
    }
  }

  async runJourney(ctx, goal) {
    const cap = this.config.ai.maxStepsPerGoal;
    const record = {...goal, device: ctx.name, outcome: 'INCOMPLETE', reason: null, problem: null, turns: 0, steps: []};
    this.report.goals.push(record);
    await this.freshStart(ctx);
    const start = await observe(ctx.page, ctx.cfg);
    const verdict = {vacuous: evaluateCheck(goal.successCheck, start, ctx.cfg, {startCount: start.listing.count}), stepsExecuted: 0, checkMet: false, claimed: null, quoteFound: false, stopReason: null};
    if (ctx.uxTrace) await ctx.uxTrace.onStart(start);
    if (!verdict.vacuous) {
      const replayed = goal.replayPath ? await this.replayJourney(ctx, goal, record, verdict, start) : false;
      if (!replayed) await this.journeyTurns(ctx, goal, record, verdict, await observe(ctx.page, ctx.cfg), cap);
    }
    Object.assign(record, classifyGoal(verdict));
    delete record.replayPath;
    record.screenshot = ctx.uxTrace?.lastFile || await this.shot(ctx, `goal-${this.report.goals.length}-${record.outcome.toLowerCase()}`);
    if (record.outcome === 'FAILURE') {
      this.addFinding(ctx, {kind: 'goal-failed', title: `A visitor journey failed: ${cleanText(goal.title, 70)}`, severity: 'P2', status: 'LIKELY', mergeKey: goal.title, evidence: {goal: goal.title, problem: record.problem, steps: record.steps, screenshot: record.screenshot}});
    }
  }

  /** Repeats a route that worked before, so it costs no Claude calls and stays comparable. */
  async replayJourney(ctx, goal, record, verdict, start) {
    for (const key of goal.replayPath) {
      if (this.aborted || ctx.budget <= 0) break;
      const control = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
      const result = control ? await this.runStep(ctx, control, {value: control.classification.kind === 'search' ? this.searchValue(ctx) : undefined, source: 'ux-replay'}) : null;
      if (!result?.ok || result.unjudged) break;
      verdict.stepsExecuted++;
      record.steps.push({step: result.id, name: cleanText(control.name, 60), kind: control.classification.kind, why: 'Repeated a route that worked in an earlier run', outcome: 'executed'});
    }
    await settle(ctx.page, 2500);
    if (verdict.stepsExecuted > 0 && evaluateCheck(goal.successCheck, await observe(ctx.page, ctx.cfg), ctx.cfg, checkContext(record, start))) {
      verdict.checkMet = true;
      record.planner = 'replayed';
      return true;
    }
    // The route no longer works, which is itself worth knowing. Start again as a new visitor.
    record.replayFailed = true;
    record.replayRestarted = ctx.uxTrace ? ctx.uxTrace.steps.length : 0;
    record.steps = [];
    verdict.stepsExecuted = 0;
    await this.freshStart(ctx);
    return false;
  }

  async journeyTurns(ctx, goal, record, verdict, start, cap) {
    let allowed = initialTurns(goal.estimatedTurns, cap);
    let stalls = 0;
    let lastProgress = progressOf(start);
    for (let turn = 0; turn < allowed; turn++) {
      if (this.aborted) return;
      if (ctx.budget <= 0) { verdict.stopReason = 'action-budget'; return; }
      if (this.ai.state.calls >= this.ai.state.max - this.aiReserveCalls) { verdict.stopReason = 'ai-call-budget'; return; } // keeps calls for the review
      const observation = await observe(ctx.page, ctx.cfg);
      // A UX journey may use only what a visitor can see, so hidden controls cost real steps.
      const catalog = ctx.uxTrace ? [] : this.controlCatalog(observation);
      const booking = visibleBookingLinks(observation, ctx.cfg);
      const plan = await planNextStep(this.ai, {
        goal: {title: goal.title, successCheck: goal.successCheck}, device: ctx.name, observation, controls: controlsForPrompt(observation.controls),
        catalog: catalog.map(({ref, name}) => ({ref, name})), history: record.steps.slice(-8), turnsLeft: allowed - turn, stalled: stalls,
        bookingLinks: booking.slice(0, 5).map(c => cleanText(c.name, 50)),
      });
      record.turns = turn + 1;
      if (plan.status !== 'continue') {
        verdict.claimed = plan.status;
        verdict.quoteFound = quoteIsOnPage(plan.evidenceQuote, observation);
        verdict.checkMet = evaluateCheck(goal.successCheck, observation, ctx.cfg, checkContext(record, start));
        record.problem = plan.problem ? cleanAiText(plan.problem, 240) : null;
        return;
      }
      if (!plan.actions?.length) { verdict.stopReason = 'stalled'; return; }
      await this.runPlannedActions(ctx, plan, observation, catalog, record, verdict);
      await settle(ctx.page, 2500);
      const after = await observe(ctx.page, ctx.cfg);
      if (evaluateCheck(goal.successCheck, after, ctx.cfg, checkContext(record, start)) && verdict.stepsExecuted > 0) { verdict.checkMet = true; return; }
      const current = progressOf(after);
      const progressed = current !== lastProgress;
      lastProgress = current;
      stalls = progressed ? 0 : stalls + 1;
      if (stalls >= 2) { verdict.stopReason = 'stalled'; return; }
      allowed = extendTurns(allowed, turn, progressed, cap);
    }
  }

  async runPlannedActions(ctx, plan, observation, catalog, record, verdict) {
    let lastKey = null;
    for (const planned of plan.actions.slice(0, 3)) {
      // Refs are numbered per snapshot, so resolve through the plan's own snapshot.
      const fromCatalog = catalog.find(c => c.ref === planned.ref);
      const intended = observation.controls.find(c => c.ref === planned.ref);
      const key = fromCatalog?.key || (intended && controlKey(intended));
      if (!key || (intended && !intended.classification.allowed)) {
        record.steps.push({ref: cleanText(planned.ref, 12), outcome: 'refused: not an allowed control'});
        continue;
      }
      if (key === lastKey) {
        record.steps.push({name: cleanText(key.split('|').pop(), 60), outcome: 'skipped: repeated the same control'});
        continue;
      }
      lastKey = key;
      const control = await this.revealControl(ctx, key);
      if (!control) {
        record.steps.push({name: cleanText(key.split('|').pop(), 60), outcome: 'control could not be reached'});
        continue;
      }
      const value = control.classification.kind === 'search' ? safeSearchQuery(planned.value) : planned.value;
      const result = await this.runStep(ctx, control, {value, source: 'ai-goal'});
      if (result?.ok && !result.unjudged) verdict.stepsExecuted++;
      record.steps.push({step: result?.id, name: cleanText(control.name, 60), kind: control.classification.kind, why: cleanAiText(planned.why, 120), outcome: result?.ok ? 'executed' : cleanText(result?.reason, 80)});
      if (!result?.ok || result.navigated) return; // the remaining refs no longer describe this page
    }
  }

  /** Opens the landing page, reporting an outage or a block. False means nothing more can run. */
  async openLanding(ctx) {
    const {name, page} = ctx;
    let response;
    try {
      response = await this.gotoSettled(ctx, this.config.url).catch(() => this.gotoSettled(ctx, this.config.url));
    } catch (e) {
      upsertFinding(this.report.findings, {kind: 'site-unreachable', title: 'Landing page could not be loaded', severity: 'P0', device: name, evidence: {reason: cleanText(e.message, 250), url: this.config.url}});
      this.record(ctx, 'navigate', this.config.url, {ok: false, reason: e.message});
      return false;
    }
    this.record(ctx, 'navigate', this.config.url, {ok: !!response?.ok(), reason: `HTTP ${response?.status()}`, after: {url: page.url(), title: await page.title()}});
    if ([403, 429].includes(response?.status())) { this.access.landingDenied = true; return false; }
    if (!response?.ok()) {
      this.addFinding(ctx, {kind: 'page-http', title: `Landing page returned HTTP ${response?.status() || 'unknown'}`, severity: 'P0', evidence: {url: this.config.url, status: response?.status()}});
      return false;
    }
    return true;
  }

  async auditDevice(name, isPrimary) {
    const profile = DEVICE_PROFILES[name];
    const count = this.config.devices.length;
    const context = await this.newGuardedContext(profile).catch(e => { this.limitation(`${name}: ${profile.engine} could not start: ${e.message}`); return null; });
    if (!context) return null;
    const page = await context.newPage();
    const ctx = {name, profile, cfg: forDevice(this.config, name), page, isPrimary, step: 'landing', budget: deviceShare(this.config.maxActions, count, isPrimary) + (this.mode === 'intelligent' && isPrimary ? this.aiReserve() : 0), shots: deviceShare(this.config.screenshotLimit, count, isPrimary)};
    this.attachListeners(ctx);
    // Traces record every header and cookie, so they exist only on request and are never published.
    if (this.trace) await context.tracing.start({screenshots: true, snapshots: isPrimary, sources: false});
    try {
      if (!(await this.openLanding(ctx))) return null;
      await this.shot(ctx, 'first-visit');
      await this.stage(ctx, 'consent', () => this.dismissConsent(ctx));
      await this.stage(ctx, 'landing checks', async () => { await scrollThrough(page); await this.inspectPage(ctx, {isLanding: true}); });
      await this.stage(ctx, 'accessibility', () => this.scanAccessibility(ctx));
      if (profile.family === 'mobile') await this.stage(ctx, 'phone layout', () => this.checkPhoneLayout(ctx));
      const urls = await this.stage(ctx, 'link discovery', () => this.allInternalPaths(ctx)) || new Map();
      if (isPrimary) await this.stage(ctx, 'link check', () => this.checkLinks(ctx, urls));
      const picks = await this.stage(ctx, 'page sampling', () => this.samplePages(ctx, urls)) || [];
      await this.stage(ctx, 'exploration', () => this.explore(ctx));
      if (isPrimary) await this.stage(ctx, 'filter combinations', () => this.runCombos(ctx));
      if (this.mode === 'intelligent' && isPrimary) {
        await this.stage(ctx, 'AI goals', () => this.pursueGoals(ctx).catch(e => {
          if (e instanceof AiStopped) { this.limitation(`AI goals skipped: ${e.message}`); return undefined; }
          throw e;
        }));
      }
      return {context: this.contextOptions(profile), detailUrl: picks.find(p => ctx.cfg.detailPathPrefixes.some(x => p.path.startsWith(x)))?.url};
    } finally {
      if (this.trace) await context.tracing.stop({path: path.join(this.out, `trace-${name}.zip`)}).catch(() => {});
      await context.close().catch(() => {});
    }
  }

  async measurePerformance(deviceName, target) {
    const profile = DEVICE_PROFILES[deviceName];
    if (profile.engine !== 'chromium' || this.aborted) return;
    const browser = await this.getBrowser('chromium');
    for (const url of [this.config.url, target.detailUrl].filter(Boolean)) {
      await this.stage({name: deviceName}, `performance ${pathOf(url)}`, async () => {
        const metrics = await measurePage(browser, url, target.context);
        const p = pathOf(url);
        this.report.performance.push({device: deviceName, path: p, metrics});
        for (const {highlight, ...f} of analyzePerformance(metrics, p)) upsertFinding(this.report.findings, {...f, device: deviceName, page: templateOf(p)});
      });
    }
  }

  /** Retries one-off failures. A problem that does not come back is not a defect yet. */
  async reverify() {
    const candidates = this.report.findings.filter(f => REVERIFIABLE.has(f.kind)).slice(0, REVERIFY_LIMIT);
    if (!candidates.length || this.aborted) return;
    const profile = DEVICE_PROFILES[this.config.devices[0]];
    const context = await this.newGuardedContext(profile).catch(() => null);
    if (!context) return;
    const page = await context.newPage();
    const ctx = {name: this.config.devices[0], profile, cfg: forDevice(this.config, this.config.devices[0]), page, step: 'reverify', budget: 0, shots: 0};
    try {
      for (const finding of candidates) {
        if (this.aborted) return;
        const reproduced = await this.stage(ctx, `re-check ${finding.kind}`, () => this.reproduce(ctx, finding));
        if (reproduced === undefined || reproduced === null) continue;
        finding.verification = {reproduced, at: this.now().toISOString()};
        if (!reproduced) finding.status = 'TRANSIENT';
        else if (finding.status === 'LIKELY' && finding.kind !== 'control-no-effect') finding.status = 'CONFIRMED';
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  async reproduce(ctx, finding) {
    const evidence = finding.instances[0]?.evidence || {};
    const {page} = ctx;
    await page.waitForTimeout(Math.max(1500, this.config.rateLimitMs));
    if (finding.kind === 'broken-image' && evidence.images?.[0]?.url) {
      const res = await page.context().request.get(evidence.images[0].url, {timeout: 15000, failOnStatusCode: false}).catch(() => null);
      return res ? res.status() >= 400 : null;
    }
    if (['page-http-error', 'resource-http-error', 'broken-internal-link'].includes(finding.kind) && evidence.url && evidence.status) {
      const res = await page.context().request.get(evidence.url, {timeout: 15000, failOnStatusCode: false}).catch(() => null);
      return res ? res.status() >= 400 : null;
    }
    if (finding.kind === 'showtime-data-mismatch' && evidence.url) {
      await page.goto(evidence.url, {waitUntil: 'domcontentloaded', timeout: 30000}).catch(() => {});
      await settle(page, 5000);
      if (!(await this.expandShowtimes(ctx))) return null;
      const screenings = extractScreenings(await readJsonLd(page), this.config.timezone).filter(s => s.title === evidence.film && `${s.date} ${s.time}` === evidence.structuredStart);
      if (!screenings.length) return null; // the listing changed, so this attempt says nothing
      return compareWithRendered(screenings, await readPageText(page), this.now()).length > 0;
    }
    if (finding.kind === 'site-unreachable' || finding.kind === 'page-http') {
      const response = await page.goto(this.config.url, {waitUntil: 'domcontentloaded', timeout: 30000}).catch(() => null);
      return !response?.ok();
    }
    if (finding.kind === 'request-failed' && evidence.url) {
      const res = await page.context().request.get(evidence.url, {timeout: 15000, failOnStatusCode: false}).catch(() => null);
      return res === null;
    }
    if (finding.kind === 'javascript-error' && evidence.pageUrl) {
      const messages = [];
      const listener = e => messages.push(cleanText(e.message, 300));
      page.on('pageerror', listener);
      await page.goto(evidence.pageUrl, {waitUntil: 'domcontentloaded', timeout: 30000}).catch(() => {});
      await settle(page, 5000);
      page.off('pageerror', listener);
      return messages.includes(evidence.message);
    }
    if ((finding.kind === 'control-no-effect' || finding.kind === 'control-obscured') && evidence.reproduce) {
      const {controlKey: key, path: steps} = evidence.reproduce;
      await this.freshStart(ctx);
      for (const step of steps) {
        const stepControl = locateControl(await observe(page, ctx.cfg), step, controlKey);
        if (stepControl) await act(page, stepControl, ctx.cfg);
      }
      const control = locateControl(await observe(page, ctx.cfg), key, controlKey);
      if (!control) return null;
      const result = await act(page, control, ctx.cfg, {changeTimeout: 6000});
      if (finding.kind === 'control-obscured') return result.code === 'obscured';
      return result.ok ? result.changed === false : null;
    }
    return null;
  }

  async aiReview() {
    try {
      const evaluation = await reviewEvidence(this.ai, {config: this.config, report: this.report, outDir: this.out});
      this.report.aiSummary = cleanAiText(evaluation.summary, 600);
      const validEvidence = new Set([...this.report.actions.map(x => x.id), ...this.report.screenshots]);
      this.report.suggestions = (evaluation.suggestions || []).filter(x => validEvidence.has(x.evidenceStep)).slice(0, 8).map(s => ({
        title: cleanAiText(s.title, 120), severity: s.severity === 'P2' ? 'P2' : 'P3', device: cleanAiText(s.device, 30), evidenceStep: s.evidenceStep,
        userImpact: cleanAiText(s.userImpact), suggestedFix: cleanAiText(s.suggestedFix), validationNeeded: cleanAiText(s.validationNeeded),
      }));
      this.lessons = cleanLessons(evaluation.lessons);
    } catch (e) {
      this.limitation(`AI visual review unavailable: ${e.message}`);
    }
  }

  finalize() {
    this.report.access = {...this.access, blocked: this.isAccessBlocked(), ratio: this.access.attempted ? Number((this.access.denied / this.access.attempted).toFixed(2)) : 0};
    if (this.report.access.blocked) {
      const before = this.report.findings.length;
      this.report.findings = this.report.findings.filter(f => !ACCESS_SHADOWED.has(f.kind));
      this.report.access.findingsWithheld = before - this.report.findings.length;
      this.limitation(`The site refused ${this.access.denied} of ${this.access.attempted} requests from this network, so this audit is not valid evidence about the site.`);
    }
    annotateFindings(this.report.findings, this.memory);
    this.report.findings = sortFindings(this.report.findings, this.config.devices[0]);
    this.report.blockers = this.report.findings.filter(f => f.severity === 'P0' && f.status !== 'TRANSIENT').length;
    this.report.coverage.templates = [...this.templates];
    this.report.coverage.inspectedTemplates = [...this.inspectedTemplates];
    this.report.coverage.a11yTemplates = [...this.a11yTemplates];
    this.report.coverage.checksRun = [...this.checksRun];
    this.report.coverage.controlKeys = [...new Set(this.report.actions.filter(a => a.outcome === 'PASS' && a.controlKey).map(a => a.controlKey))];
    this.report.coverage.sources = this.report.showtimes.results.map(r => r.source);
    this.report.coverage.stateCount = Object.keys(this.graph.states).length;
    this.report.model = graphSummary(this.graph);
    this.report.safety = {
      blockedRequests: this.safety.blocked, samples: this.safety.samples, allowlistedWrites: this.safety.allowedWrites, allowlistedReads: this.safety.allowedReads,
      robots: {found: this.robots.found, rules: this.robots.rules.length, respected: this.config.respectRobots},
      statement: 'All requests passed through a read-only guard. Write requests and navigation off the audited site were aborted before leaving the browser.',
    };
    this.report.ai = this.ai.summary();
    this.report.goalsSummary = summarizeGoals(this.report.goals);
    for (const [device, list] of Object.entries(this.report.coverage.missingHints)) {
      if (list.length) this.limitation(`${device}: configured controls not found during exploration: ${list.join(', ')}`);
    }
    if (this.config.showtimes.enabled && this.mode !== 'ux' && !this.report.showtimes.results.length) this.limitation('Showtimes were not compared with any cinema source in this run.');
  }

  async run() {
    fs.mkdirSync(path.join(this.out, 'screenshots'), {recursive: true});
    fs.mkdirSync(path.join(this.out, 'ai'), {recursive: true});
    const loaded = loadMemory(this.memoryFile, this.config.slug);
    this.memory = loaded.memory;
    if (loaded.warning) this.limitation(loaded.warning);
    const deadline = setTimeout(() => {
      this.aborted = true;
      this.limitation('Audit exceeded its maximum runtime and stopped early');
      for (const b of Object.values(this.browsers)) b.close().catch(() => {});
    }, this.config.maxRunMinutes * 60000);
    const {report, config, mode} = this;
    try {
      this.log(`starting ${mode} audit of ${config.url} (${config.devices.join(', ')})`);
      if (config.respectRobots) this.robots = await fetchRobots(new URL(config.url).origin, config.userAgentSuffix || 'Mozilla/5.0');
      this.policy = createPolicy(config, {robotsRules: config.respectRobots ? this.robots.rules : []});
      if (config.respectRobots) config.robotsRules = this.robots.rules;
      if (mode === 'ux') {
        this.uxAuditor = new UxAuditor(this);
        await this.uxAuditor.collect();
        this.report.coverage.missingHints = {}; // a UX audit explores briefly, so absence means little
        await this.reverify();
      } else {
        let primary = null;
        for (const [index, device] of config.devices.entries()) {
          if (this.aborted) break;
          const result = await this.auditDevice(device, index === 0);
          if (index === 0) primary = result;
        }
        await this.stage({name: config.devices[0]}, 'showtime sources', () => this.verifyShowtimes(config.devices[0]));
        if (primary) await this.measurePerformance(config.devices[0], primary);
        await this.reverify();
      }
      this.finalize();
      if (mode === 'ux') {
        if (report.access.blocked) report.ux = {valid: false, reason: 'The site refused this audit, so no UX assessment can be made from it.'};
        else if (report.actions.length) await this.uxAuditor.assess({expert: !this.aborted});
        report.ai = this.ai.summary();
      }
      if (mode === 'intelligent' && report.actions.length && !this.aborted && !report.access.blocked) {
        await this.aiReview();
        report.ai = this.ai.summary();
      }
      report.status = report.access.blocked ? 'BLOCKED_BY_SITE_PROTECTION' : this.aborted ? 'TIMED_OUT' : !report.actions.length ? 'NO_ACTIONS' : report.errors.length ? 'COMPLETED_WITH_LIMITATIONS' : 'COMPLETED';
    } catch (e) {
      report.status = 'FAILED';
      this.limitation(e.stack || e.message);
    } finally {
      clearTimeout(deadline);
      for (const b of Object.values(this.browsers)) await b.close().catch(() => {});
      report.finishedAt = this.now().toISOString();
      if (report.status === 'COMPLETED' || report.status === 'COMPLETED_WITH_LIMITATIONS') {
        learnFromRun(this.memory, report, {stateMetrics: this.stateMetrics, lessons: this.lessons, timezone: config.timezone});
        if (report.ux?.valid) report.ux.resolvedThisRun = learnUx(this.memory.ux, report.ux, report.finishedAt);
      }
      else recordIncompleteRun(this.memory, report);
      report.history = this.memory.history.slice(-30);
      if (report.ux?.valid) report.ux.journeyHistory = Object.fromEntries(report.ux.journeys.map(j => [j.key, this.memory.ux.journeys[j.key]?.runs || []]));
      saveReport(report, this.out);
      saveMemoryFile(this.memory, this.memoryFile);
    }
    this.log(`finished ${report.status}: ${report.actions.length} actions, ${report.findings.length} findings (${report.blockers} blockers), ${report.errors.length} limitations`);
    return report;
  }
}

function checkContext(record, start) {
  return {startCount: start.listing.count, executed: record.steps.filter(s => s.outcome === 'executed' && s.kind !== 'search').map(s => s.name)}; // typing a word is not using a filter
}

/** Which query parameters a step changed, added or removed. */
export function changedParams(beforeUrl, afterUrl) {
  const before = new URL(beforeUrl).searchParams;
  const after = new URL(afterUrl).searchParams;
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter(k => before.get(k) !== after.get(k));
}

/** A screenshot may be published or sent to Claude, so nothing a person typed may appear in it. */
function pageIsSafeToCapture(page) {
  return page.evaluate(() => {
    const visibleField = el => el.getClientRects().length > 0;
    if ([...document.querySelectorAll('input[type=password]')].some(visibleField)) return false;
    return ![...document.querySelectorAll('input,textarea')].some(el => el.value && ['email', 'tel', 'password'].includes(el.type));
  }).catch(() => false);
}

function stateLabel(observation) {
  return cleanText(`${templateOf(pathOf(observation.url))}${observation.active.length ? ` with ${observation.active.slice(0, 2).join(', ')}` : ''}`, 60);
}
