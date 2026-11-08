// The UX Research & Design Auditor. It reuses the audit's guarded browser, journeys and findings,
// adds what those lack, and keeps measured facts apart from expert judgement throughout.
import crypto from 'node:crypto';
import path from 'node:path';
import {DEVICE_PROFILES, forDevice} from './config.mjs';
import {observe, act, settle, locateControl, stateSignature, waitForChange, liveDescription, SERVER_ERROR_PAGE} from './browser.mjs';
import {classifyControl, cleanText, isAllowedUrl, isExcludedPath} from './security.mjs';
import {templateOf, scrollThrough} from './checks.mjs';
import {controlKey, stateKeyOf, untestedControls, markTried} from './explorer.mjs';
import {robotsAllows} from './guard.mjs';
import {AiStopped, proposeGoals, cleanAiText} from './claude.mjs';
import {isUsableCheck} from './goals.mjs';
import {choosePages} from './audit.mjs';
import {collectDesign} from './ux-design.mjs';
import {watchFeedback, readFeedback, describeStep, computeJourneyMetrics, isInterstitial, recoveryControls} from './ux-metrics.mjs';
import {tabWalk, analyzeTabWalk, pointerOnlyControls, findOverlay, rememberFixedElements, testDialog, controlAppearance, focusIsLost, readAccessibilityTree} from './ux-keyboard.mjs';
import {DEFAULT_THRESHOLDS, rubricVersion} from './ux-framework.mjs';
import {evaluateMeasured, buildMeasuredIssues} from './ux-measures.mjs';
import {reviewBatch, validateReview, verifyIssues, finishExpertIssue, selectImages} from './ux-review.mjs';
import {buildScorecard, compareScores} from './ux-scorecard.mjs';
import {designSignature, reconcileIssues, chooseUxPages, orderKeyboardControls, orderBatches, priorHypotheses} from './ux-memory.mjs';

const pathOf = url => { try { return new URL(url).pathname; } catch { return String(url).slice(0, 80); } };
const NARROW_WINDOW = {width: 390, height: 844};
const NOT_FOUND_PROBE = '/guardian-ux-probe-not-a-real-page';
const NOT_FOUND_TEXT = /not found|404|does ?n.t exist|no longer|nicht gefunden|existiert nicht|gibt es nicht/i;
const SEVERITY_RANK = {P0: 0, P1: 1, P2: 2, P3: 3};
const CLASS_RANK = {'detected-defect': 0, 'expert-judgment': 1, 'research-needed': 2};

export class UxAuditor {
  constructor(audit) {
    this.a = audit;
    this.config = audit.config;
    this.ux = audit.config.ux;
    this.thresholds = {...DEFAULT_THRESHOLDS, ...this.ux.thresholds};
    this.shots = [];
    this.texts = [];
    this.signatures = {};
    this.picks = null;
    this.proposedJourneys = null;
    this.keyboardControls = [];
    this.landingNav = {};
    this.data = {pages: [], journeys: [], recovery: {}, parity: null, keyControlDepth: {}, keyboard: {tested: false, device: this.ux.keyboardDevice, walks: [], pointerOnly: [], activations: [], dialogs: [], semantics: []}};
  }

  get memory() { return this.a.memory.ux; }

  registerShot(file, meta) {
    const id = `S${String(this.shots.length + 1).padStart(2, '0')}`;
    const base = path.basename(file, path.extname(file));
    this.shots.push({id, file, jpg: `ai/${base}.jpg`, stage: 'finding', ...meta});
    return id;
  }

  /** Any screenshot taken by the shared checks can also be cited as evidence. */
  shotIdOf(file) {
    const known = this.shots.find(s => s.file === file);
    if (known) return known.id;
    const device = Object.keys(DEVICE_PROFILES).sort((a, b) => b.length - a.length).find(name => path.basename(file).replace(/^\d+-/, '').startsWith(`${name}-`));
    return this.registerShot(file, {device: device || 'unknown', template: '(detail)'});
  }

  async capture(ctx, name, meta, options) {
    const file = await this.a.shot(ctx, name, options);
    if (!file) return null;
    return this.registerShot(file, {device: ctx.name, template: templateOf(pathOf(ctx.page.url())), url: pathOf(ctx.page.url()), ...meta});
  }

  newContext(name, shots) {
    const profile = DEVICE_PROFILES[name];
    return this.a.newGuardedContext(profile).then(async context => {
      const page = await context.newPage();
      const ctx = {name, profile, cfg: forDevice(this.config, name), page, isPrimary: false, step: 'landing', budget: 0, shots};
      this.a.attachListeners(ctx);
      return {context, ctx};
    }).catch(e => { this.a.limitation(`${name}: ${profile.engine} could not start: ${e.message}`); return {}; });
  }

  async measurePage(ctx, stage) {
    const observation = await observe(ctx.page, ctx.cfg);
    const design = await collectDesign(ctx.page, {keyPattern: this.ux.keyControls, listingTop: observation.listing.top});
    const template = templateOf(pathOf(ctx.page.url()));
    // A detail page starts with its title. Its longest list is rarely what the page is about.
    if (ctx.cfg.detailPathPrefixes.some(prefix => pathOf(ctx.page.url()).startsWith(prefix)) && Number.isFinite(design.h1.y)) design.firstContentY = design.h1.y;
    const shot = await this.capture(ctx, `${stage}-${template}`, {stage});
    this.data.pages.push({device: ctx.name, family: ctx.profile.family, template, url: pathOf(ctx.page.url()), design, shot, headings: observation.headings.slice(0, 6), textSample: observation.text.slice(0, 1200), controls: [...new Set(observation.controls.filter(c => c.classification.allowed && c.name).map(c => c.name))].slice(0, 40)});
    this.texts.push(observation.fullText);
    if (ctx.name === this.ux.devices[0]) this.signatures[template] ||= designSignature(design.signatureParts);
    if (template === '/') this.landingNav[ctx.name] = design.navPaths;
  }

  async auditDevice(name, isPrimary, shotShare) {
    const a = this.a;
    const {context, ctx} = await this.newContext(name, shotShare);
    if (!context) return;
    try {
      if (!(await a.openLanding(ctx))) return;
      await a.stage(ctx, 'consent', () => a.dismissConsent(ctx));
      await a.stage(ctx, 'landing checks', async () => { await scrollThrough(ctx.page); await a.inspectPage(ctx, {isLanding: true}); await this.measurePage(ctx, 'landing'); });
      await a.stage(ctx, 'accessibility', () => a.scanAccessibility(ctx));
      if (ctx.profile.family === 'mobile') await a.stage(ctx, 'phone layout', () => a.checkPhoneLayout(ctx));
      if (isPrimary) {
        const urls = await a.stage(ctx, 'link discovery', () => a.allInternalPaths(ctx)) || new Map();
        const candidates = choosePages(urls, ctx.cfg, a.memory.coverage.paths, this.config.maxPages);
        this.picks = chooseUxPages(candidates, this.memory, this.ux.maxPages);
      }
      for (const pick of this.picks || []) await this.visitPage(ctx, pick);
      if (isPrimary) {
        ctx.budget = this.ux.exploreActions;
        // Exploration must not spend the screenshots that the journeys and probes need as evidence.
        const available = ctx.shots;
        ctx.shots = Math.min(available, this.ux.exploreShots);
        const allowance = ctx.shots;
        await a.stage(ctx, 'exploration', () => a.explore(ctx));
        await a.stage(ctx, 'opening menus', () => this.openRemainingMenus(ctx));
        ctx.shots = available - (allowance - ctx.shots);
        await a.stage(ctx, 'empty-state probe', () => this.probeEmptySearch(ctx));
        await a.stage(ctx, 'error-page probe', () => this.probeNotFound(ctx));
        this.recordKeyControlDepth(ctx);
      }
      if (this.journeyDevices().includes(name)) await a.stage(ctx, 'visitor journeys', () => this.runJourneys(ctx));
    } finally {
      await context.close().catch(() => {});
    }
  }

  /** Memory steers exploration elsewhere, but comparing navigation needs every menu opened. */
  async openRemainingMenus(ctx) {
    const a = this.a;
    const root = Object.values(a.graph.states).find(s => s.depth === 0);
    if (!root) return;
    const open = new Set(untestedControls(a.graph));
    for (const control of root.controls.filter(c => c.expanded !== null && c.expanded !== undefined && open.has(controlKey(c))).slice(0, 6)) {
      if (a.aborted) return;
      const key = controlKey(control);
      markTried(a.graph, root, key);
      ctx.currentKey = null;
      if (!(await a.goToState(ctx, root).catch(() => false))) continue;
      const live = locateControl(await observe(ctx.page, ctx.cfg), key, controlKey);
      if (!live) continue;
      ctx.budget++;
      const result = await a.runStep(ctx, live, {state: root});
      ctx.currentKey = null;
      if (result?.after && !result.unjudged) await a.recordObservedState(ctx, result.after, [key]);
    }
  }

  async visitPage(ctx, pick) {
    const a = this.a;
    if (a.aborted) return;
    await a.stage(ctx, `page ${pick.path}`, async () => {
      const response = await a.gotoSettled(ctx, pick.url);
      a.record(ctx, 'visit', pick.path, {ok: !!response?.ok(), reason: `HTTP ${response?.status()}`, after: {url: ctx.page.url(), title: await ctx.page.title()}}, {source: 'ux-page'});
      if (!response?.ok()) return;
      await scrollThrough(ctx.page);
      await a.inspectPage(ctx);
      await this.measurePage(ctx, 'page');
      await a.stage(ctx, `accessibility ${pick.path}`, () => a.scanAccessibility(ctx));
      await ctx.page.waitForTimeout(this.config.rateLimitMs);
    });
  }

  recordKeyControlDepth(ctx) {
    const pattern = new RegExp(this.ux.keyControls, 'i');
    // Judged per kind of control, so a secondary search box cannot count against a visible main one.
    const shallowest = {};
    for (const term of this.ux.keyControls.split('|')) {
      const matches = new RegExp(term, 'i');
      for (const state of Object.values(this.a.graph.states)) {
        for (const c of state.controls.filter(x => pattern.test(`${x.name} ${x.type || ''}`) && matches.test(`${x.name} ${x.type || ''}`))) {
          if (!shallowest[term] || state.depth < shallowest[term].depth) shallowest[term] = {depth: state.depth, name: c.name};
        }
      }
    }
    this.data.keyControlDepth[ctx.name] = shallowest;
  }

  journeyDevices() { return this.ux.journeyDevices.length ? this.ux.journeyDevices : [this.ux.devices[0]]; }

  /** A search that cannot match anything shows how the site handles a failed attempt. */
  async probeEmptySearch(ctx) {
    const a = this.a;
    await a.freshStart(ctx);
    const before = await observe(ctx.page, ctx.cfg);
    let control = before.controls.find(c => c.classification.allowed && c.classification.kind === 'search');
    if (!control) {
      const known = Object.values(a.graph.states).flatMap(s => s.controls).find(c => c.classification.kind === 'search');
      if (known) control = await a.revealControl(ctx, controlKey(known));
    }
    if (!control) { this.data.recovery.emptySearch = {tested: false, reason: 'No search control was found.'}; return; }
    const query = this.ux.emptySearchQuery;
    const result = await act(ctx.page, control, ctx.cfg, {value: query});
    if (!result.ok) { this.data.recovery.emptySearch = {tested: false, reason: result.reason}; return; }
    await settle(ctx.page, 2500);
    const after = await observe(ctx.page, ctx.cfg);
    const empty = after.emptyMessage || after.listing.count === 0 || after.listing.count < before.listing.count * 0.2;
    const action = a.record(ctx, 'ux-probe', `Search with no possible match: ${query}`, {...result, after: {url: after.url, title: after.title, itemCount: after.listing.count}}, {source: 'ux-probe', value: query});
    if (!empty) { this.data.recovery.emptySearch = {tested: false, reason: 'The search still returned results, so no empty state appeared.', action}; return; }
    const shot = await this.capture(ctx, 'empty-search', {stage: 'empty-state', actionId: action});
    this.texts.push(after.fullText);
    this.data.recovery.emptySearch = {tested: true, device: ctx.name, template: templateOf(pathOf(after.url)), hasMessage: after.emptyMessage || after.text.toLowerCase().includes(query.toLowerCase()), recovery: recoveryControls(after), shot, action};
  }

  /** One read of an address that cannot exist, opened in a separate tab so it is not a finding. */
  async probeNotFound(ctx) {
    const a = this.a;
    if (!robotsAllows(a.robots.rules, NOT_FOUND_PROBE)) { this.data.recovery.notFound = {tested: false, reason: 'robots.txt disallows the probe.'}; return; }
    const probe = await ctx.page.context().newPage();
    try {
      const response = await probe.goto(new URL(NOT_FOUND_PROBE, this.config.url).href, {waitUntil: 'domcontentloaded', timeout: 25000});
      await settle(probe, 3000);
      const status = response?.status() ?? 0;
      if ([401, 403, 429].includes(status)) { this.data.recovery.notFound = {tested: false, reason: `The site answered HTTP ${status}.`}; return; }
      const observation = await observe(probe, ctx.cfg);
      const action = a.record(ctx, 'ux-probe', 'Open an address that does not exist', {ok: true, after: {url: observation.url, title: observation.title}}, {source: 'ux-probe'});
      const shot = await this.capture({...ctx, page: probe}, 'not-found', {stage: 'error-page', actionId: action});
      this.texts.push(observation.fullText);
      const internalLinks = observation.controls.filter(c => c.tag === 'a' && c.href && isAllowedUrl(c.href, ctx.cfg)).length;
      this.data.recovery.notFound = {tested: true, device: ctx.name, status, hasMessage: NOT_FOUND_TEXT.test(observation.text), internalLinks, shot, action};
    } finally {
      await probe.close().catch(() => {});
    }
  }

  /** Same journeys every run where possible, so results can be compared between runs. */
  async journeyList(ctx) {
    if (this.resolvedJourneys) return this.resolvedJourneys;
    const persona = this.config.audiences[0] || 'First-time visitor';
    const configured = this.ux.journeys.map(j => ({coreTask: true, persona, ...j}));
    let journeys = configured.length ? configured : this.memory.proposed;
    if (!journeys.length) {
      await this.a.freshStart(ctx);
      const landing = await observe(ctx.page, ctx.cfg);
      const proposals = await proposeGoals(this.a.ai, {config: this.config, siteModel: {}, memoryNotes: this.a.memoryNotes(), landing: {url: landing.url, text: landing.text.slice(0, 1500), listing: landing.listing.count}, count: this.ux.maxJourneys + 1});
      journeys = proposals.filter(g => isUsableCheck(g.successCheck)).slice(0, this.ux.maxJourneys).map((g, i) => ({...g, id: `proposed-${i + 1}`, persona, coreTask: true}));
      this.proposedJourneys = journeys;
    }
    this.resolvedJourneys = journeys.filter(j => isUsableCheck(j.successCheck)).slice(0, this.ux.maxJourneys);
    return this.resolvedJourneys;
  }

  async runJourneys(ctx) {
    const a = this.a;
    ctx.budget = this.ux.journeyActions;
    let journeys;
    try { journeys = await this.journeyList(ctx); } catch (e) {
      if (e instanceof AiStopped) { a.limitation(`UX journeys could not be planned: ${e.message}`); return; }
      throw e;
    }
    for (const journey of journeys) {
      if (a.aborted || ctx.budget <= 0) return;
      try { await this.runJourney(ctx, journey); } catch (e) {
        ctx.uxTrace = null;
        if (e instanceof AiStopped) { a.limitation(`Stopped planning journeys: ${e.message}`); return; }
        a.limitation(`Journey "${cleanText(journey.title, 60)}" stopped: ${e.message}`);
      }
    }
  }

  createTrace(ctx, journey) {
    const auditor = this;
    let stageNumber = 0;
    const trace = {
      steps: [], stages: [], startState: null, startUrl: null, lastFile: null,
      async capture(stage, actionId) {
        if (stageNumber >= auditor.ux.stagesPerJourney) return;
        const id = await auditor.capture(ctx, `journey-${journey.id}-${++stageNumber}`, {stage, journey: journey.title, actionId});
        if (id) { trace.stages.push({shot: id, stage, actionId: actionId || null}); trace.lastFile = auditor.shots.find(s => s.id === id).file; }
      },
      async onStart(observation) { trace.startState = stateKeyOf(observation); trace.startUrl = pathOf(observation.url); await trace.capture('journey-start'); },
      beforeAction: control => watchFeedback(ctx.page, control.css),
      async afterAction({id, control, key, result, before, after}) {
        const feedback = result.navigated ? null : await readFeedback(ctx.page);
        trace.steps.push(describeStep({id, control, key, result, before, after, feedback}));
        if (after) auditor.texts.push(after.fullText);
        await trace.capture(after && SERVER_ERROR_PAGE.test(after.text) ? 'server-error' : 'journey-step', id);
      },
    };
    return trace;
  }

  async runJourney(ctx, journey) {
    const a = this.a;
    const key = `${journey.id}@${ctx.name}`;
    const known = this.memory.journeys[key];
    const trace = this.createTrace(ctx, journey);
    ctx.uxTrace = trace;
    const goal = {title: journey.title, why: journey.why || '', estimatedTurns: journey.estimatedTurns || 3, successCheck: journey.successCheck, replayPath: known?.path?.length ? known.path : null};
    try { await a.runJourney(ctx, goal); } finally { ctx.uxTrace = null; }
    const record = a.report.goals.at(-1);
    const steps = record.replayRestarted ? trace.steps.slice(record.replayRestarted) : trace.steps;
    steps.forEach((s, i, list) => { s.interstitial = isInterstitial(s, i === list.length - 1); });
    const metrics = computeJourneyMetrics(steps, {startState: trace.startState, edges: a.graph.edges});
    this.data.journeys.push({
      key, id: journey.id, title: journey.title, why: journey.why || '', persona: journey.persona, device: ctx.name, coreTask: journey.coreTask !== false, targetActions: journey.targetActions || null, successCheck: journey.successCheck,
      outcome: record.outcome, reason: record.reason, problem: record.problem, planner: record.planner || 'claude', replayFailed: !!record.replayFailed, turns: record.turns, startUrl: trace.startUrl, template: trace.startUrl ? templateOf(trace.startUrl) : '/',
      metrics, steps, stages: trace.stages.filter(s => !record.replayRestarted || !steps.length || s.stage === 'journey-start' || steps.some(x => x.actionId === s.actionId)), path: steps.some(s => s.kind === 'search') ? [] : steps.filter(s => s.ok).map(s => s.key), // a typed query cannot be replayed from a key
    });
  }

  /** Runs on a desktop profile, because keyboard use implies a physical keyboard. */
  async keyboard() {
    const a = this.a;
    const device = this.ux.keyboardDevice;
    if (DEVICE_PROFILES[device].engine !== 'chromium') { a.limitation('Keyboard tests need a Chromium device profile, so they were skipped.'); return; }
    const {context, ctx} = await this.newContext(device, this.ux.keyboardShots);
    if (!context) return;
    const k = this.data.keyboard;
    try {
      if (!(await a.openLanding(ctx))) return;
      await a.stage(ctx, 'consent', () => a.dismissConsent(ctx));
      await a.stage(ctx, 'keyboard walk', () => this.keyboardPage(ctx));
      for (const pick of (this.picks || []).slice(0, this.ux.keyboardPages - 1)) {
        await a.stage(ctx, `keyboard walk ${pick.path}`, async () => {
          const response = await a.gotoSettled(ctx, pick.url);
          if (response?.ok()) await this.keyboardPage(ctx);
        });
      }
      await a.stage(ctx, 'keyboard operation', () => this.keyboardActivations(ctx));
      k.tested = k.walks.length > 0;
    } finally {
      await context.close().catch(() => {});
    }
  }

  async keyboardPage(ctx) {
    const a = this.a;
    const k = this.data.keyboard;
    const template = templateOf(pathOf(ctx.page.url()));
    const walk = await tabWalk(ctx.page, {maxTabs: this.ux.maxTabs});
    const analysis = analyzeTabWalk(walk, {viewportHeight: ctx.page.viewportSize().height});
    const action = a.record(ctx, 'keyboard', `Tab through ${template}: ${analysis.stops} stops`, {ok: true, after: {url: ctx.page.url(), title: await ctx.page.title()}}, {source: 'keyboard'});
    const hidden = walk.stops.filter(s => s.focusVisible === false).slice(0, 6).map(s => s.rect);
    const shot = await this.capture(ctx, `keyboard-${template}`, {stage: 'keyboard', actionId: action}, hidden.length ? {highlight: hidden} : undefined);
    k.walks.push({template, analysis, action, shot});
    const pointer = await pointerOnlyControls(ctx.page);
    if (pointer.length) {
      const pointerShot = await this.capture(ctx, `pointer-only-${template}`, {stage: 'keyboard', actionId: action}, {highlight: pointer.map(p => p.rect)});
      k.pointerOnly.push({template, names: pointer.map(p => p.name), action, shot: pointerShot});
    }
    const tree = await readAccessibilityTree(ctx.page).catch(e => { a.limitation(`Accessibility tree unavailable: ${e.message}`); return null; });
    if (tree) k.semantics.push({template, tree, action, shot});
  }

  activationCandidates(observation) {
    const seen = new Set(this.keyboardControls);
    return observation.controls.filter(c => {
      const key = controlKey(c);
      if (!c.classification.allowed || c.classification.kind !== 'activate' || c.tag === 'a' || c.tag === 'input' || c.covered || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async keyboardActivations(ctx) {
    const a = this.a;
    await a.freshStart(ctx);
    // Controls the journeys relied on are tested first, since visitors depend on them most.
    const taskControls = new Set(a.report.actions.filter(x => x.listingChanged && x.controlKey).map(x => x.controlKey));
    const chosen = orderKeyboardControls(this.activationCandidates(await observe(ctx.page, ctx.cfg)), controlKey, this.memory, this.ux.keyboardControls, taskControls);
    for (const candidate of chosen) {
      if (a.aborted) return;
      await a.stage(ctx, `keyboard ${cleanText(candidate.name, 30)}`, () => this.activateByKeyboard(ctx, controlKey(candidate)));
    }
    // A narrow window, as with zoomed desktop use, often swaps in drawers that need testing too.
    await ctx.page.setViewportSize(NARROW_WINDOW);
    await a.freshStart(ctx);
    const revealers = this.activationCandidates(await observe(ctx.page, ctx.cfg)).filter(c => (c.expanded !== null && c.expanded !== undefined) || /filter|menu|view|options/i.test(c.name));
    for (const candidate of revealers.slice(0, this.ux.keyboardNarrowControls)) {
      if (a.aborted) return;
      await a.stage(ctx, `keyboard, narrow window: ${cleanText(candidate.name, 30)}`, () => this.activateByKeyboard(ctx, controlKey(candidate), {narrow: true}));
    }
  }

  async activateByKeyboard(ctx, key, {narrow = false} = {}) {
    const a = this.a;
    const k = this.data.keyboard;
    const {page} = ctx;
    await a.freshStart(ctx);
    const observation = await observe(page, ctx.cfg);
    const control = locateControl(observation, key, controlKey);
    if (!control) return;
    const locator = page.locator(`css=${control.css}`).first();
    if (await locator.count() === 0) return;
    const live = await locator.evaluate(liveDescription);
    if (!classifyControl({...control, ...live}, ctx.cfg).allowed) return;
    await rememberFixedElements(page);
    await locator.focus({timeout: 3000});
    const look = await controlAppearance(page, control.css);
    const startUrl = page.url();
    const signature = await stateSignature(page);
    await page.keyboard.press('Enter');
    let changed = await waitForChange(page, signature, 1500);
    if (!changed) {
      await page.keyboard.press('Space');
      changed = await waitForChange(page, signature, 1500);
    }
    await page.waitForTimeout(400);
    if (!isAllowedUrl(page.url(), ctx.cfg)) return;
    const navigated = page.url() !== startUrl;
    const after = navigated ? null : await controlAppearance(page, control.css);
    const overlay = navigated ? null : await findOverlay(page);
    const entry = {key, name: narrow ? `${control.name} (narrow window)` : control.name, template: templateOf(pathOf(startUrl)), keyboardWorks: changed, navigated, openedOverlay: !!overlay, focusLost: changed && !navigated ? await focusIsLost(page) : false, stateHidden: !!(changed && !navigated && !overlay && look && after && look.look !== after.look && !after.pressed && !look.pressed), mouseWorks: null};
    entry.action = a.record(ctx, 'keyboard', `Enter on "${cleanText(control.name, 50)}"`, {ok: true, changed, navigated, after: {url: page.url(), title: await page.title()}}, {source: 'keyboard', controlKey: key});
    entry.shot = (overlay || entry.stateHidden || entry.focusLost) ? await this.capture(ctx, `keyboard-result-${k.activations.length + 1}`, {stage: 'keyboard', actionId: entry.action}) : null;
    k.activations.push(entry);
    this.keyboardControls.push(key);
    if (overlay) {
      const result = await testDialog(page, control.css);
      k.dialogs.push({key, name: entry.name, template: entry.template, semantic: overlay.semantic, modal: overlay.modal, dialogName: overlay.name, action: entry.action, shot: entry.shot, ...result});
    }
    if (!changed) {
      await a.freshStart(ctx);
      const again = locateControl(await observe(page, ctx.cfg), key, controlKey);
      if (again) {
        const result = await act(page, again, ctx.cfg, {changeTimeout: 2500});
        entry.mouseWorks = !!(result.ok && (result.changed || result.navigated));
      }
    }
  }

  /** Compares what desktop navigation offers against what the phone exposes. */
  compareDevices() {
    const phone = this.ux.devices.find(d => DEVICE_PROFILES[d].family === 'mobile');
    const desktop = this.ux.devices.find(d => DEVICE_PROFILES[d].family === 'desktop');
    if (!phone || !desktop || phone !== this.ux.devices[0]) { this.data.parity = {assessed: false, reason: 'Needs a phone as the first device plus a desktop.'}; return; }
    if (!this.landingNav[phone] || !this.landingNav[desktop]) { this.data.parity = {assessed: false, reason: 'A landing page could not be measured on both devices.'}; return; }
    const open = new Set(untestedControls(this.a.graph));
    const root = Object.values(this.a.graph.states).find(s => s.depth === 0);
    if (root?.controls.some(c => c.expanded !== null && c.expanded !== undefined && open.has(controlKey(c)))) { this.data.parity = {assessed: false, reason: 'Not every phone menu was opened during exploration.'}; return; }
    const reachable = new Set(this.landingNav[phone]);
    for (const state of Object.values(this.a.graph.states)) for (const c of state.controls) if (c.href) reachable.add(pathOf(c.href));
    const cfg = this.config;
    const desktopOnly = this.landingNav[desktop].filter(p => !reachable.has(p) && !isExcludedPath(p, cfg) && classifyControl({tag: 'a', role: 'link', name: '', href: new URL(p, cfg.url).href}, cfg).allowed);
    const refs = this.data.pages.filter(p => p.template === '/' && [phone, desktop].includes(p.device)).map(p => p.shot).filter(Boolean);
    this.data.parity = {assessed: true, desktopOnly, phoneDevice: phone, refs};
  }

  async collect() {
    const a = this.a;
    const count = this.ux.devices.length;
    const reservedForKeyboard = this.ux.keyboardShots;
    const remaining = Math.max(8, this.config.screenshotLimit - reservedForKeyboard);
    const primaryShare = Math.ceil(remaining * 0.6);
    const otherShare = count > 1 ? Math.max(3, Math.floor((remaining - primaryShare) / (count - 1))) : 0;
    for (const [index, device] of this.ux.devices.entries()) {
      if (a.aborted) break;
      await this.auditDevice(device, index === 0, index === 0 ? primaryShare : otherShare);
    }
    if (!a.aborted) await this.keyboard();
    this.compareDevices();
  }

  measuredInputs() {
    const {report} = this.a;
    return {
      ...this.data, findings: report.findings.filter(f => f.status !== 'TRANSIENT'), shotIdOf: file => this.shotIdOf(file), actionIds: new Set(report.actions.map(x => x.id)), a11yPagesScanned: report.coverage.a11yPagesScanned || 0,
      keyControlsDeclared: this.ux.keyControlsDeclared,
    };
  }

  evidenceFor(batch, shown, measuredIssues, measuredAssessments) {
    const {data} = this;
    const pages = data.pages.map(p => ({device: p.device, template: p.template, shot: p.shot, headings: p.headings, text: p.textSample.slice(0, batch === 'language' ? 900 : 300), controls: p.controls.slice(0, batch === 'language' ? 30 : 12), measured: {firstContentY: p.design.firstContentY, viewport: p.design.viewport, bodyFontPx: p.design.bodyFontPx, h1: p.design.h1, firstView: p.design.firstView, buttonStyles: p.design.buttonStyles}}));
    return {
      shots: shown.map(s => ({id: s.id, device: s.device, template: s.template, stage: s.stage, journey: s.journey, action: s.actionId})),
      journeys: data.journeys.map(j => ({title: j.title, persona: j.persona, device: j.device, outcome: j.outcome, metrics: j.metrics, steps: j.steps.map(s => ({action: s.actionId, control: s.control, feedback: s.feedback, itemsBefore: s.itemsBefore, itemsAfter: s.itemsAfter, to: s.toUrl}))})),
      pages, recovery: data.recovery, alreadyMeasured: measuredIssues.map(i => i.title).slice(0, 40), measuredVerdicts: measuredAssessments.filter(x => x.verdict !== 'not-assessed').map(x => ({criterion: x.criterion, verdict: x.verdict})), priorHypotheses: priorHypotheses(this.memory),
    };
  }

  async expertReview(measuredIssues, measuredAssessments) {
    const a = this.a;
    const status = {status: 'not-run', batches: [], rejected: [], verification: null, reviewedCriteria: 0};
    const assessments = [], accepted = [];
    const usable = this.shots.filter(s => s.jpg);
    const batches = orderBatches(this.memory, Math.max(0, this.ux.reviewCalls - 1));
    const pageText = this.texts.join(' ').slice(0, 800000);
    const actionIds = new Set(a.report.actions.map(x => x.id));
    for (const batch of batches) {
      if (a.aborted) break;
      const shown = selectImages(batch, usable, this.ux.imagesPerBatch);
      try {
        a.log(`expert review: ${batch}`);
        const {output, criteria} = await reviewBatch(a.ai, {batch, config: this.config, evidence: this.evidenceFor(batch, shown, measuredIssues, measuredAssessments), shots: shown, outDir: a.out});
        const result = validateReview(output, {criteria, shownShots: new Set(shown.map(s => s.id)), actionIds, pageText});
        assessments.push(...result.assessments);
        accepted.push(...result.issues.map(issue => ({issue, shown})));
        status.rejected.push(...result.rejected);
        status.batches.push({batch, assessed: result.assessments.filter(x => x.verdict !== 'not-assessed').length, issues: result.issues.length, rejected: result.rejected.length});
      } catch (e) {
        a.limitation(`Expert review (${batch}) unavailable: ${e.message}`);
        if (e instanceof AiStopped) break;
      }
    }
    status.status = status.batches.length ? (status.batches.length === batches.length ? 'complete' : 'partial') : 'unavailable';
    status.reviewedCriteria = assessments.filter(x => x.verdict !== 'not-assessed').length;
    return {assessments, accepted, status};
  }

  async verifyExpert(accepted, status) {
    if (!accepted.length) return new Map();
    const cited = [...new Set(accepted.flatMap(x => x.issue.evidenceRefs))].map(id => this.shots.find(s => s.id === id)).filter(Boolean).slice(0, this.ux.imagesPerBatch + 2);
    try {
      this.a.log('expert review: verification');
      const verdicts = await verifyIssues(this.a.ai, {issues: accepted.map(x => x.issue), shots: cited, config: this.config, outDir: this.a.out});
      status.verification = 'complete';
      return verdicts;
    } catch (e) {
      status.verification = 'unavailable';
      this.a.limitation(`Expert claims could not be cross-checked: ${e.message}`);
      return new Map();
    }
  }

  /** Decides the verdicts, runs the review and assembles what the website owner receives. */
  async assess({expert = true} = {}) {
    const {report} = this.a;
    for (const file of report.screenshots) this.shotIdOf(file);
    const flaky = report.findings.filter(f => f.status === 'TRANSIENT' && /http|javascript/.test(f.kind));
    if (flaky.length) this.a.limitation(`The site returned an intermittent error during this run that did not recur on re-test (${flaky.length} record(s), for example: ${cleanText(flaky[0].title, 80)}). Check the server logs around ${report.startedAt}.`);
    const measured = evaluateMeasured(this.measuredInputs(), this.thresholds);
    const coreTemplates = [...new Set(['/', ...this.data.journeys.filter(j => j.coreTask).flatMap(j => j.steps.filter(s => s.ok).map(s => templateOf(s.toUrl)))])];
    const audience = this.config.audiences[0] || 'First-time visitor';
    const {issues: measuredIssues, withoutEvidence} = buildMeasuredIssues(measured.seeds, {audience, coreTemplates, devices: this.ux.devices});
    if (withoutEvidence) this.a.limitation(`${withoutEvidence} measured problem(s) had no screenshot or action to cite, so they were left out.`);
    const review = expert ? await this.expertReview(measuredIssues, measured.assessments) : {assessments: [], accepted: [], status: {status: 'not-run', batches: [], rejected: [], verification: null, reviewedCriteria: 0}};
    const verdicts = await this.verifyExpert(review.accepted, review.status);
    const shotsById = new Map(this.shots.map(s => [s.id, s]));
    const failingCriteria = new Set(measured.assessments.filter(x => ['fail', 'concern'].includes(x.verdict)).map(x => x.criterion));
    const expertIssues = [];
    review.accepted.forEach(({issue}, index) => {
      const verification = verdicts.get(String(index)) || null;
      const original = review.accepted[Number(verification?.duplicateOf)];
      if (verification?.duplicateOf && Number(verification.duplicateOf) < index && original) {
        original.issue.evidenceRefs = [...new Set([...original.issue.evidenceRefs, ...issue.evidenceRefs])].slice(0, 6);
        review.status.merged = (review.status.merged || 0) + 1;
        return;
      }
      if (verification?.verdict === 'contradicted') { review.status.rejected.push({title: cleanAiText(issue.title, 120), criterion: issue.criterion, reason: 'contradicted-on-cross-check'}); return; }
      expertIssues.push(finishExpertIssue(issue, {shotsById, coreTemplates, devices: this.ux.devices, audience, measuredCriteria: failingCriteria, verification}));
    });
    const {kept, suppressed} = reconcileIssues([...measuredIssues, ...expertIssues], this.memory, {signatures: this.signatures, decisions: this.ux.decisions, failingCriteria});
    const issues = kept.sort((x, y) => CLASS_RANK[x.class] - CLASS_RANK[y.class] || SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);

    const assessments = [...measured.assessments, ...review.assessments];
    const weights = this.ux.scorecard.weights || {};
    const rubric = rubricVersion(this.thresholds, weights);
    const journeySet = crypto.createHash('sha1').update(this.data.journeys.map(j => j.key).sort().join('|')).digest('hex').slice(0, 8);
    const scorecard = buildScorecard(assessments, {weights, minCoverage: this.ux.scorecard.minCoverage});
    const cited = new Set([...issues.flatMap(i => i.evidenceRefs), ...assessments.flatMap(x => x.evidenceRefs), ...this.data.journeys.flatMap(j => j.stages.map(s => s.shot))]);
    const pages = this.data.pages.map(({textSample, controls, ...p}) => p);
    report.ux = {
      valid: true, rubricVersion: rubric, journeySet, thresholds: this.thresholds, devices: this.ux.devices, primaryDevice: this.ux.devices[0], issues, suppressed, assessments, scorecard,
      trend: compareScores(scorecard, this.memory.scoreHistory, {rubric, journeySet, pages: [...new Set(this.data.pages.map(p => p.template))]}), journeys: this.data.journeys, recovery: this.data.recovery, keyboard: this.data.keyboard, parity: this.data.parity, pages,
      shots: this.shots.filter(s => cited.has(s.id) || s.stage !== 'finding'), expert: review.status, signatures: this.signatures, proposedJourneys: this.proposedJourneys, pagePicks: (this.picks || []).map(p => p.template),
      coverage: {devices: this.ux.devices, templates: [...new Set(pages.map(p => p.template))], keyboardControls: this.keyboardControls},
    };
  }
}
