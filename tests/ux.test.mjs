// The UX method as pure logic: no browser, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CRITERIA, DIMENSIONS, CATEGORIES, EXPERT_BATCHES, DEFAULT_THRESHOLDS, severityOf, rubricVersion} from '../src/ux-framework.mjs';
import {CATALOG} from '../src/ux-catalog.mjs';
import {buildScorecard, compareScores} from '../src/ux-scorecard.mjs';
import {computeJourneyMetrics, isEmptyState, isInterstitial, recoveryControls} from '../src/ux-metrics.mjs';
import {analyzeTabWalk, summarizeAxTree} from '../src/ux-keyboard.mjs';
import {evaluateMeasured, buildMeasuredIssues} from '../src/ux-measures.mjs';
import {validateReview, assertsInventedFact, resolveConfidence, finishExpertIssue, selectImages, reviewSchema} from '../src/ux-review.mjs';
import {emptyUxMemory, sanitizeUxMemory, reconcileIssues, learnUx, chooseUxPages, orderBatches, priorHypotheses, designSignature} from '../src/ux-memory.mjs';
import {normalizeConfig} from '../src/config.mjs';

test('every criterion has one dimension, one category and a stated rubric', () => {
  assert.equal(new Set(CRITERIA.map(c => c.id)).size, CRITERIA.length);
  for (const c of CRITERIA) {
    assert.ok(DIMENSIONS[c.dimension], c.id);
    assert.ok(CATEGORIES[c.category], c.id);
    assert.ok(c.rubric.pass && c.rubric.fail, c.id);
    if (c.method === 'expert') assert.ok(EXPERT_BATCHES.includes(c.batch), c.id);
  }
});

test('all ten Nielsen heuristics and the other named principles are assessed separately', () => {
  for (let n = 1; n <= 10; n++) assert.ok(CRITERIA.some(c => c.dimension === `nielsen-${n}`), `nielsen-${n}`);
  for (const d of ['information-architecture', 'cognitive-load', 'progressive-disclosure', 'interaction-design', 'visual-hierarchy', 'wcag-operable', 'wcag-robust']) assert.ok(CRITERIA.some(c => c.dimension === d), d);
  for (const id of ['X-hierarchy', 'X-density', 'X-legibility', 'X-spacing', 'X-affordance', 'X-consistency', 'X-discoverability', 'X-feedback', 'X-empty', 'X-responsive']) assert.ok(CRITERIA.some(c => c.id === id), id);
});

test('accessibility is scored only by measurement, never by opinion', () => {
  assert.ok(CRITERIA.filter(c => c.category === 'accessibility').every(c => c.method === 'measured'));
});

test('every catalogue entry supplies the full recommendation structure', () => {
  const sample = {count: 2, stops: 4, names: ['x'], name: 'x', at: 'x', first: {from: 'a', to: 'b'}, tabs: 9, missing: ['main'], h1Count: 1, problem: 'p', actions: 3, target: 1, shortest: null, control: 'c', recovery: false, backtracks: 1, repeated: 1, status: 200, hasMessage: false, label: 'l', destinations: ['a'], reason: 'r', y: 900, viewport: 700, share: 1.2, h1: 14, body: 13, ratio: 1.1, reasons: ['A limit was exceeded'], limit: 3, paths: ['/a'], title: 't', rule: 'r', help: 'h', affected: 1, helpUrl: 'u', selectors: 's', template: '/'};
  for (const [kind, entry] of Object.entries(CATALOG)) {
    assert.ok(CRITERIA.some(c => c.id === entry.criterion), `${kind} criterion`);
    assert.ok(entry.problem(sample).length > 5, kind);
    for (const field of ['cause', 'fix', 'alt', 'benefit', 'guide', 'validate']) assert.ok(entry[field], `${kind}.${field}`);
    assert.ok(entry.accept.length >= 1, `${kind}.accept`);
    assert.ok(['blocks', 'major', 'minor', 'polish'].includes(entry.impact), kind);
  }
});

test('severity follows actual impact and is not capped at P2', () => {
  assert.equal(severityOf({impact: 'blocks', core: true, objective: true, allDevices: true, confidence: 'high'}), 'P0');
  assert.equal(severityOf({impact: 'blocks', core: true, objective: false, allDevices: true, confidence: 'high'}), 'P1', 'P0 needs objective proof');
  assert.equal(severityOf({impact: 'major', core: true}), 'P1');
  assert.equal(severityOf({impact: 'major', core: false}), 'P2');
  assert.equal(severityOf({impact: 'polish', core: true}), 'P3');
  assert.equal(severityOf({impact: 'major', core: true, confidence: 'low'}), 'P2', 'low confidence lowers one level');
});

const row = (criterion, verdict) => ({criterion, verdict, detail: 'd', evidenceRefs: ['S01']});

test('a score is a reproducible weighted average', () => {
  const list = [row('A-axe', 'pass'), row('A-focus-visible', 'fail'), row('A-reachable', 'pass'), row('A-order', 'concern'), row('A-dialog', 'pass'), row('A-focus-recovery', 'pass'), row('A-semantics', 'pass')];
  const first = buildScorecard(list).accessibility;
  assert.deepEqual(first.score, buildScorecard([...list].reverse()).accessibility.score);
  assert.equal(first.score, Math.round(100 * (3 + 0 + 4 + 1.5 + 3 + 2 + 3) / 21));
});

test('no number is given when evidence is insufficient', () => {
  const none = buildScorecard([]).accessibility;
  assert.equal(none.score, null);
  assert.match(none.reason, /No measured/);
  const expertOnly = buildScorecard([row('X-ia', 'pass'), row('X-recognition', 'pass'), row('X-discoverability', 'pass')]).discoverability;
  assert.equal(expertOnly.score, null, 'opinion alone can never produce a score');
  const thin = buildScorecard([row('A-axe', 'pass'), row('A-semantics', 'pass')]).accessibility;
  assert.equal(thin.score, null);
  assert.match(thin.reason, /weight/);
});

test('expert opinion can never move a score, and uncited verdicts do not count', () => {
  const measured = [row('D-key-controls', 'pass'), row('D-hover', 'pass'), row('D-link-labels', 'fail')];
  const score = expert => buildScorecard([...measured, row('X-ia', expert)]).discoverability;
  assert.equal(score('pass').score, score('fail').score);
  assert.equal(score('fail').expert.fail, 1);
  assert.deepEqual(score('pass').calculation, {earned: 5, assessedWeight: 7, totalWeight: 7});
  const uncited = buildScorecard([{...row('A-axe', 'pass'), evidenceRefs: []}, row('A-reachable', 'pass'), row('A-order', 'pass'), row('A-focus-visible', 'pass')]).accessibility;
  assert.equal(uncited.rows.find(r => r.criterion === 'A-axe').verdict, 'not-assessed');
  assert.equal(uncited.rows.find(r => r.criterion === 'A-reachable').earned, 4);
});

test('weights are configurable and change the rubric version', () => {
  assert.notEqual(rubricVersion(DEFAULT_THRESHOLDS, {'A-axe': 9}), rubricVersion(DEFAULT_THRESHOLDS, {}));
  const list = [row('A-axe', 'fail'), row('A-reachable', 'pass'), row('A-order', 'pass'), row('A-focus-visible', 'pass'), row('A-semantics', 'pass')];
  assert.ok(buildScorecard(list, {weights: {'A-axe': 20}}).accessibility.score < buildScorecard(list).accessibility.score);
});

test('runs are compared only under the same rubric and journeys', () => {
  const cards = {clarity: {score: 70, measuredScore: 60}};
  const history = [{at: 'old', rubric: 'other', journeySet: 'j', categories: {clarity: {score: 10, measuredScore: 10}}}, {at: 'then', rubric: 'r', journeySet: 'j', categories: {clarity: {score: 60, measuredScore: 50}}}];
  assert.equal(compareScores(cards, history, {rubric: 'r', journeySet: 'j'}).categories.clarity.score, 10);
  assert.equal(compareScores(cards, history, {rubric: 'new', journeySet: 'j'}).comparable, false);
  assert.equal(compareScores(cards, history, {rubric: 'r', journeySet: 'changed'}).categories.clarity.score, null);
});

const step = (over = {}) => ({ok: true, key: 'k', actionId: 'A1', control: 'c', fromState: 'a', toState: 'b', changed: true, navigated: false, automationMs: 100, responseMs: 50, feedback: 'in-viewport', empty: false, recovery: [], expanded: 0, dialogOpen: false, ...over});

test('journey metrics count what happened and nothing else', () => {
  const steps = [step({key: 'x', navigated: true, fromState: 'a', toState: 'b'}), step({key: 'y', navigated: true, fromState: 'b', toState: 'a'}), step({key: 'z', fromState: 'a', toState: 'c', feedback: 'off-screen'})];
  const m = computeJourneyMetrics(steps, {startState: 'a', edges: [{from: 'a', to: 'c'}]});
  assert.equal(m.actionCount, 3);
  assert.equal(m.backtracks, 1);
  assert.equal(m.unnecessaryNavigations, 2);
  assert.equal(m.shortestKnownActions, 1);
  assert.equal(m.excessOverShortest, 2);
  assert.equal(m.resultsOffScreen, 1);
  assert.equal(m.automationElapsedMs, 300);
  for (const invented of Object.keys(m)) assert.doesNotMatch(invented, /frustrat|satisf|cognitive|humanTime/i);
});

test('the same label on two different pages is not a repeated action', () => {
  const m = computeJourneyMetrics([step({key: 'continue', fromState: 'a', toState: 'b', navigated: true}), step({key: 'continue', fromState: 'b', toState: 'c', navigated: true})], {startState: 'a'});
  assert.equal(m.repeatedActions, 0);
  assert.equal(computeJourneyMetrics([step({key: 'x', fromState: 'a', toState: 'a'}), step({key: 'x', fromState: 'a', toState: 'a'})], {startState: 'a'}).repeatedActions, 1);
});

test('dead ends separate those with a way out', () => {
  const m = computeJourneyMetrics([step({empty: true, recovery: ['Clear filters']}), step({key: 'q', fromState: 'b', toState: 'b', empty: true})], {startState: 'a'});
  assert.equal(m.deadEnds, 2);
  assert.equal(m.deadEndsWithoutRecovery, 1);
});

test('moving to another page is not an empty result', () => {
  const page = (url, count, emptyMessage = false) => ({url: `https://x.test${url}`, listing: {count}, emptyMessage});
  assert.equal(isEmptyState(page('/a', 0), page('/', 6)), false);
  assert.equal(isEmptyState(page('/', 0), page('/', 6)), true);
  assert.equal(isEmptyState(page('/b', 3, true), page('/', 6)), true);
});

test('a step counts as a pass-through page only when it offers almost nothing', () => {
  assert.equal(isInterstitial({navigated: true, itemsAfter: 0, mainControls: 1, textLength: 60}, false), true);
  assert.equal(isInterstitial({navigated: true, itemsAfter: 0, mainControls: 1, textLength: 60}, true), false, 'the destination is not a pass-through');
  assert.equal(isInterstitial({navigated: true, itemsAfter: 8, mainControls: 1, textLength: 60}, false), false);
  assert.equal(isInterstitial({navigated: true, itemsAfter: 0, mainControls: 9, textLength: 60}, false), false);
});

test('recovery controls are recognised, in German too', () => {
  const controls = ['Clear filters', 'Zurücksetzen', 'Tonight'].map(name => ({name, covered: false}));
  assert.deepEqual(recoveryControls({controls}), ['Clear filters', 'Zurücksetzen']);
});

const stop = (over = {}) => ({name: 'x', css: 'a', region: 'main', href: '', tabindex: null, covered: false, focusVisible: true, rect: {x: 0, y: 0, w: 10, h: 10}, ...over});

test('tab walk analysis finds hidden focus, jumps and missing bypass', () => {
  const stops = [stop({region: 'nav', rect: {x: 0, y: 900, w: 9, h: 9}}), stop({region: 'nav', focusVisible: false, rect: {x: 0, y: 10, w: 9, h: 9}}), stop({tabindex: '3', covered: true, rect: {x: 0, y: 1000, w: 9, h: 9}})];
  const a = analyzeTabWalk({stops, ended: true, trap: null}, {viewportHeight: 600});
  assert.equal(a.notVisibleCount, 1);
  assert.equal(a.orderJumps.length, 1);
  assert.equal(a.positiveTabindex.length, 1);
  assert.equal(a.obscured.length, 1);
  assert.equal(a.tabsToMain, 3);
  assert.equal(a.skipLink, false);
  assert.equal(analyzeTabWalk({stops: [stop({href: '#main', name: 'Skip to main content'})], ended: true}, {viewportHeight: 600}).skipLink, true);
});

test('the accessibility tree summary reads landmarks and heading skips', () => {
  const node = (role, name, extra = {}) => ({ignored: false, role: {value: role}, name: {value: name}, ...extra});
  const heading = level => node('heading', `h${level}`, {properties: [{name: 'level', value: {value: level}}]});
  const s = summarizeAxTree([node('main', ''), {ignored: true, role: {value: 'navigation'}}, heading(1), heading(3), node('status', '')]);
  assert.equal(s.landmarks.main, 1);
  assert.equal(s.landmarks.navigation, 0, 'ignored nodes are not exposed');
  assert.deepEqual(s.headingSkips[0], {from: 1, to: 3, at: 'h3'});
  assert.equal(s.liveRegions, 1);
});

const inputs = over => ({pages: [], journeys: [], recovery: {}, findings: [], keyboard: {tested: false}, parity: null, keyControlDepth: {}, actionIds: new Set(), shotIdOf: f => f, a11yPagesScanned: 0, keyControlsDeclared: false, ...over});

test('with no data every measured criterion is honestly not assessed', () => {
  const {assessments, seeds} = evaluateMeasured(inputs(), DEFAULT_THRESHOLDS);
  assert.deepEqual(assessments.map(a => a.criterion).sort(), CRITERIA.filter(c => c.method === 'measured').map(c => c.id).sort());
  assert.ok(assessments.every(a => a.verdict === 'not-assessed'));
  assert.equal(seeds.length, 0);
});

const landing = (keyControls, extra = {}) => ({device: 'mobile', family: 'mobile', template: '/', shot: 'S01', design: {viewport: {w: 390, h: 800}, firstContentY: 100, h1: {count: 1, fontSize: 30}, bodyFontPx: 16, lineLengthChars: 60, firstView: {controls: 5}, buttonStyles: 2, lowAffordance: [], hoverReveals: [], navConflicts: [], keyControls, ...extra}});

test('a secondary control cannot count against a visible main control of its kind', () => {
  const visible = [{label: 'Search films', y: 100, inFirstView: true}];
  const verdict = depth => evaluateMeasured(inputs({pages: [landing(visible)], keyControlDepth: {mobile: depth}}), DEFAULT_THRESHOLDS).assessments.find(a => a.criterion === 'D-key-controls').verdict;
  assert.equal(verdict({search: {depth: 3, name: 'Search cinema or district'}}), 'pass');
  assert.equal(verdict({filter: {depth: 2, name: 'Filters'}}), 'concern', 'a different kind of control still has to be findable');
  assert.equal(verdict({filter: {depth: 1, name: 'Filters'}}), 'pass', 'one action away is allowed');
});

test('a server crash is not mistaken for a design state', async () => {
  const {SERVER_ERROR_PAGE} = await import('../src/browser.mjs');
  assert.ok(SERVER_ERROR_PAGE.test('Application error: a server-side exception has occurred while loading'));
  assert.equal(SERVER_ERROR_PAGE.test('No screenings match your search'), false);
});

test('an inconclusive journey is neither a pass nor a failure', () => {
  const j = {key: 'k', title: 't', device: 'mobile', outcome: 'INCOMPLETE', steps: [], stages: [], metrics: {actionCount: 0}};
  const {assessments} = evaluateMeasured(inputs({journeys: [j]}), DEFAULT_THRESHOLDS);
  assert.equal(assessments.find(a => a.criterion === 'E-journey-success').verdict, 'not-assessed');
});

test('a measured problem with nothing to cite is left out', () => {
  const {issues, withoutEvidence} = buildMeasuredIssues([{kind: 'kb-trap', subject: '/', device: 'desktop', template: '/', m: {at: 'x'}, refs: []}], {audience: 'a', coreTemplates: ['/'], devices: ['desktop']});
  assert.equal(issues.length, 0);
  assert.equal(withoutEvidence, 1);
});

test('measured issues carry every required field and mark causes correctly', () => {
  const {issues} = buildMeasuredIssues([{kind: 'kb-unreachable-control', subject: 'p', device: 'desktop', template: '/', m: {names: ['Sort']}, refs: ['S01']}, {kind: 'journey-result-offscreen', subject: 'j', device: 'mobile', template: '/', m: {control: 'Filter'}, refs: ['A1']}], {audience: 'a', coreTemplates: ['/'], devices: ['mobile', 'desktop']});
  for (const i of issues) for (const f of ['userGoal', 'persona', 'problem', 'principle', 'observedEvidence', 'reproductionSteps', 'severity', 'confidence', 'scope', 'rootCause', 'recommendation', 'alternative', 'expectedBenefit', 'implementationGuidance', 'acceptanceCriteria', 'validationMethod']) assert.ok(i[f], `${i.kind}.${f}`);
  assert.equal(issues[0].rootCause.status, 'established');
  assert.equal(issues[1].rootCause.status, 'hypothesis');
  assert.equal(issues[0].class, 'detected-defect');
  assert.equal(issues[0].severity, 'P1', 'a blocked keyboard task on a core page is rated by impact');
});

const criteria = CRITERIA.filter(c => c.batch === 'language');
const good = {criterion: 'X-language', title: 't', problem: 'p', recommendation: 'r', validationMethod: 'v', impact: 'major', evidenceRefs: ['S01'], quote: ''};
const check = (issues, over = {}) => validateReview({assessments: [], issues}, {criteria, shownShots: new Set(['S01']), actionIds: new Set(['A001']), pageText: 'Original version films', ...over});

test('expert claims must cite evidence the reviewer was actually shown', () => {
  assert.equal(check([good]).issues.length, 1);
  assert.equal(check([{...good, evidenceRefs: ['A001']}]).issues.length, 1, 'an action is evidence');
  assert.equal(check([{...good, evidenceRefs: ['S02']}]).rejected[0].reason, 'no-screenshot-or-action-evidence');
  assert.equal(check([{...good, criterion: 'X-hierarchy'}]).rejected[0].reason, 'unknown-criterion');
  assert.equal(check([{...good, recommendation: ''}]).rejected[0].reason, 'incomplete-record');
});

test('quotes must exist on a page', () => {
  assert.equal(check([{...good, quote: 'original version'}]).issues.length, 1);
  assert.equal(check([{...good, quote: 'not on the site'}]).rejected[0].reason, 'quote-not-on-any-page');
});

test('asserted feelings and invented human numbers are refused, hedged hypotheses are not', () => {
  for (const claim of ['Users feel frustrated here', 'Visitors will get confused', '40% of users leave', 'A satisfaction score of 3', 'It takes users 12 seconds']) assert.ok(assertsInventedFact([claim]), claim);
  for (const claim of ['This may cause difficulty', 'The label could be misread', 'The automation took 12 seconds']) assert.equal(assertsInventedFact([claim]), false, claim);
  assert.equal(check([{...good, problem: 'Users are confused by this'}]).rejected[0].reason, 'asserted-unmeasured-human-state');
});

test('an assessment without shown evidence does not count', () => {
  const r = validateReview({assessments: [{criterion: 'X-ia', verdict: 'fail', rationale: 'x', evidenceRefs: ['S77']}, {criterion: 'X-help', verdict: 'insufficient-evidence', rationale: 'x', evidenceRefs: []}, {criterion: 'X-language', verdict: 'pass', rationale: 'x', evidenceRefs: ['S01']}]}, {criteria, shownShots: new Set(['S01']), actionIds: new Set()});
  assert.deepEqual(r.assessments.map(a => a.verdict), ['not-assessed', 'not-assessed', 'pass']);
});

test('the review schema allows every impact level', () => {
  assert.deepEqual(reviewSchema(['X-ia']).properties.issues.items.properties.impact.enum, ['blocks', 'major', 'minor', 'polish']);
});

test('a model calling itself confident does not make it so', () => {
  assert.equal(resolveConfidence('high', {refs: ['S01'], measuredCorroboration: false, supported: true}), 'medium');
  assert.equal(resolveConfidence('high', {refs: ['S01', 'A002'], measuredCorroboration: false, supported: true}), 'high');
  assert.equal(resolveConfidence('high', {refs: ['S01', 'A002'], measuredCorroboration: false, supported: false}), 'low', 'unchecked claims stay low');
  assert.equal(resolveConfidence('low', {refs: ['S01', 'S02'], measuredCorroboration: true, supported: true}), 'low');
});

const raw = {criterion: 'X-ia', title: 'Title', classification: 'expert-judgment', impact: 'blocks', confidence: 'high', problem: 'p', observedEvidence: 'o', evidenceRefs: ['S01'], reproductionSteps: ['a'], template: '/', recommendation: 'r', alternative: 'a', expectedBenefit: 'b', implementationGuidance: 'g', acceptanceCriteria: ['c'], validationMethod: 'v', userGoal: 'u', persona: 'p', rootCauseHypothesis: 'h', quote: '', priorId: ''};
const options = verification => ({shotsById: new Map([['S01', {device: 'mobile', template: '/'}]]), coreTemplates: ['/'], devices: ['mobile'], audience: 'a', verification});

test('expert issues are labelled, root causes stay hypotheses, and P0 is impossible', () => {
  const issue = finishExpertIssue(raw, options({verdict: 'supported', reason: 'x'}));
  assert.equal(issue.provenance, 'expert');
  assert.equal(issue.rootCause.status, 'hypothesis');
  assert.equal(issue.severity, 'P1');
  assert.equal(finishExpertIssue(raw, options({verdict: 'weak', reason: 'x'})).class, 'research-needed');
});

test('images are varied across devices', () => {
  const shots = ['mobile', 'mobile', 'mobile', 'tablet', 'desktop'].map((device, i) => ({id: `S${i}`, device, stage: 'landing', jpg: 'x.jpg'}));
  assert.deepEqual(new Set(selectImages('responsive', shots, 3).map(s => s.device)), new Set(['mobile', 'tablet', 'desktop']));
});

const issue = over => ({id: 'x1', provenance: 'expert', kind: 'expert', class: 'expert-judgment', criterion: 'X-ia', title: 'Navigation groups overlap in meaning', templates: ['/'], devices: ['mobile'], confidence: 'medium', ...over});
const uxRun = (issues, over = {}) => ({issues, suppressed: [], assessments: [{criterion: 'X-ia', verdict: 'concern'}, {criterion: 'A-axe', verdict: 'pass'}], signatures: {'/': 'sig'}, coverage: {templates: ['/'], devices: ['mobile'], keyboardControls: []}, journeys: [], rubricVersion: 'r', journeySet: 'j', scorecard: {}, ...over});

test('repeating a hypothesis does not raise its confidence', () => {
  const memory = emptyUxMemory();
  for (let run = 0; run < 5; run++) {
    const {kept} = reconcileIssues([issue()], memory, {signatures: {'/': 'sig'}});
    assert.equal(kept[0].confidence, 'medium');
    learnUx(memory, uxRun(kept), `2026-01-0${run + 1}`);
  }
  assert.equal(memory.issues.x1.seenRuns, 5);
});

function resolved() {
  const memory = emptyUxMemory();
  const first = reconcileIssues([issue()], memory, {signatures: {'/': 'sig'}});
  learnUx(memory, uxRun(first.kept), '2026-01-01');
  learnUx(memory, uxRun([]), '2026-01-02');
  learnUx(memory, uxRun([]), '2026-01-03');
  assert.equal(memory.issues.x1.state, 'resolved');
  return memory;
}

test('a resolved hypothesis does not return without new evidence', () => {
  const {kept, suppressed} = reconcileIssues([issue()], resolved(), {signatures: {'/': 'sig'}});
  assert.equal(kept.length, 0);
  assert.equal(suppressed[0].reason, 'resolved-with-no-new-evidence');
});

test('a resolved hypothesis returns if the design changed', () => {
  assert.equal(reconcileIssues([issue()], resolved(), {signatures: {'/': 'changed'}}).kept[0].trend, 'REGRESSED');
});

test('a resolved hypothesis returns if a measurement now backs it', () => {
  assert.equal(reconcileIssues([issue()], resolved(), {signatures: {'/': 'sig'}, failingCriteria: new Set(['X-ia'])}).kept.length, 1);
});

test('a rewording of a resolved hypothesis is still the same hypothesis', () => {
  const {kept} = reconcileIssues([issue({id: 'new-id', title: 'Navigation groups overlap in their meaning badly'})], resolved(), {signatures: {'/': 'sig'}});
  assert.equal(kept.length, 0);
});

test('a measured regression always shows, because a measurement is new evidence', () => {
  const memory = emptyUxMemory();
  memory.issues.m1 = {provenance: 'measured', state: 'resolved', criterion: 'A-axe', templates: ['/'], devices: [], title: 't', signature: 'sig', seenRuns: 2};
  assert.equal(reconcileIssues([issue({id: 'm1', provenance: 'measured', criterion: 'A-axe'})], memory, {signatures: {'/': 'sig'}}).kept[0].trend, 'REGRESSED');
});

test('owner decisions are honoured until the design changes', () => {
  const memory = emptyUxMemory();
  memory.issues.x1 = {provenance: 'expert', state: 'open', criterion: 'X-ia', templates: ['/'], devices: [], title: 't', signature: 'sig', seenRuns: 1};
  assert.equal(reconcileIssues([issue()], memory, {signatures: {'/': 'sig'}, decisions: {x1: {decision: 'rejected'}}}).suppressed[0].reason, 'rejected-by-owner');
  assert.equal(reconcileIssues([issue()], memory, {signatures: {'/': 'new'}, decisions: {x1: {decision: 'rejected'}}}).kept.length, 1);
  const validated = reconcileIssues([issue()], memory, {signatures: {'/': 'sig'}, decisions: {x1: {decision: 'validated', note: 'Tree test'}}}).kept[0];
  assert.equal(validated.validated, true);
  assert.equal(validated.confidence, 'high', 'real research is what raises confidence');
});

test('absence counts only if the same criterion was assessed on the same page type', () => {
  const memory = emptyUxMemory();
  learnUx(memory, uxRun([issue()]), '2026-01-01');
  learnUx(memory, uxRun([], {assessments: []}), '2026-01-02');
  learnUx(memory, uxRun([], {coverage: {templates: ['/other'], devices: ['mobile'], keyboardControls: []}}), '2026-01-03');
  learnUx(memory, uxRun([], {coverage: {templates: ['/'], devices: ['desktop'], keyboardControls: []}}), '2026-01-04');
  assert.equal(memory.issues.x1.misses, 0);
  assert.equal(memory.issues.x1.state, 'open');
});

test('history steers what is reviewed next', () => {
  const memory = emptyUxMemory();
  memory.coverage.templates = {'/a': 5, '/b': 5};
  memory.issues.q = {state: 'open', templates: ['/b'], provenance: 'measured'};
  const picks = chooseUxPages(['/a', '/b', '/new'].map(template => ({template})), memory, 2).map(p => p.template);
  assert.deepEqual(picks, ['/new', '/b']);
  for (const c of CRITERIA.filter(x => x.batch === 'language')) memory.coverage.criteria[c.id] = 9;
  assert.equal(orderBatches(memory, 5).at(-1), 'language');
  assert.equal(orderBatches(memory, 2).length, 2);
});

test('stable pages keep scores comparable, with one slot left to rotate', () => {
  const memory = emptyUxMemory();
  memory.stablePages = ['/a', '/b', '/c'];
  memory.coverage.templates = {'/a': 1, '/b': 1, '/c': 1};
  const picks = chooseUxPages(['/a', '/b', '/c', '/new'].map(template => ({template})), memory, 3).map(p => p.template);
  assert.deepEqual(picks, ['/a', '/b', '/new']);
  const cards = {clarity: {score: 70, measuredScore: 60}};
  const history = [{at: 't', rubric: 'r', journeySet: 'j', pages: ['/a'], categories: {clarity: {score: 60, measuredScore: 60}}}];
  assert.equal(compareScores(cards, history, {rubric: 'r', journeySet: 'j', pages: ['/a']}).samePages, true);
  assert.equal(compareScores(cards, history, {rubric: 'r', journeySet: 'j', pages: ['/b']}).samePages, false);
});

test('only open expert items are offered, for de-duplication', () => {
  const memory = emptyUxMemory();
  memory.issues.a = {provenance: 'expert', state: 'open', criterion: 'X-ia', title: 'A'};
  memory.issues.b = {provenance: 'expert', state: 'resolved', criterion: 'X-ia', title: 'B'};
  memory.issues.c = {provenance: 'measured', state: 'open', criterion: 'A-axe', title: 'C'};
  assert.deepEqual(priorHypotheses(memory).map(x => x.id), ['a']);
});

test('UX memory from the shared branch is bounded and cleaned', () => {
  const clean = sanitizeUxMemory({issues: {a: {title: 'y'.repeat(900), state: 'hacked', seenRuns: -4}}, journeys: {j: {title: 't', path: ['a', 9], runs: 'x'}}, proposed: [{title: 'p', successCheck: {kind: 'x', value: 'v'.repeat(500)}}], scoreHistory: [{at: 'x', categories: {c: {score: 900}}}], coverage: 7});
  assert.equal(clean.issues.a.title.length, 160);
  assert.equal(clean.issues.a.state, 'open');
  assert.equal(clean.issues.a.seenRuns, 0);
  assert.deepEqual(clean.journeys.j.path, ['a']);
  assert.equal(clean.proposed[0].successCheck.value.length, 100);
  assert.equal(clean.scoreHistory[0].categories.c.score, 100);
  assert.deepEqual(sanitizeUxMemory('nonsense'), emptyUxMemory());
});

test('the design signature ignores order only by what it is given', () => {
  assert.equal(designSignature({a: 1}), designSignature({a: 1}));
  assert.notEqual(designSignature({a: 1}), designSignature({a: 2}));
});

const base = {name: 'x', url: 'https://x.test/', allowedHosts: ['x.test']};

test('UX settings are validated', () => {
  assert.throws(() => normalizeConfig({...base, ux: {devices: ['fridge']}}), /Unknown UX device/);
  assert.throws(() => normalizeConfig({...base, ux: {keyControls: '('}}), /regular expression/);
  assert.throws(() => normalizeConfig({...base, ux: {journeys: [{title: 't'}]}}), /needs "id"/);
  assert.throws(() => normalizeConfig({...base, ux: {journeys: [{id: 'Bad Id', title: 't', successCheck: {}}]}}), /lowercase/);
  assert.equal(normalizeConfig({...base, ux: {maxCalls: 900}}).ux.maxCalls, 30, 'Claude usage stays bounded');
  assert.deepEqual(normalizeConfig(base).ux.devices, ['mobile', 'tablet', 'desktop']);
});

test('reaching the Claude usage limit stops further calls rather than retrying', async () => {
  const {createAi, AiStopped} = await import('../src/claude.mjs');
  let calls = 0;
  const ai = createAi({ai: {maxCalls: 5, models: ['sonnet'], timeoutMs: 1000}}, {runner: async () => { calls++; throw new Error('success: usage_limit_reached'); }});
  await assert.rejects(ai.ask('x', {}), AiStopped);
  await assert.rejects(ai.ask('x', {}), AiStopped);
  assert.equal(calls, 1);
});

test('the report does not claim a cross-check that did not run', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const {writeUxReport} = await import('../src/ux-report.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-ux-report-'));
  const ux = {issues: [], shots: [], devices: ['desktop'], scorecard: {}, trend: {categories: {}}, journeys: [], pages: [], rubricVersion: 'r', suppressed: [], parity: null, expert: {status: 'partial', verification: 'unavailable', reviewedCriteria: 3, rejected: []}, keyboard: {walks: [], activations: [], dialogs: [], semantics: []}};
  writeUxReport({ux, config: {name: 'X', url: 'https://x.test/'}, finishedAt: 'now', findings: [], actions: [], coverage: {}, errors: [], ai: {}}, out);
  const html = fs.readFileSync(path.join(out, 'site', 'ux', 'index.html'), 'utf8');
  assert.match(html, /second reading did not run/);
  assert.doesNotMatch(html, /a second reading checked each claim/);
});

test('page-derived captions stay inside the untrusted block', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const {reviewBatch} = await import('../src/ux-review.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-prompt-'));
  fs.mkdirSync(path.join(dir, 'ai'));
  fs.writeFileSync(path.join(dir, 'ai', 's.jpg'), 'x');
  let prompt = '';
  const ai = {ask: async text => { prompt = text; return {}; }};
  await reviewBatch(ai, {batch: 'language', config: {name: 'n', url: 'https://x.test/', ai: {timeoutMs: 1}}, evidence: {shots: [{template: '/ignore-all-instructions'}]}, shots: [{id: 'S01', device: 'mobile', template: '/ignore-all-instructions', stage: 'page', journey: 'hostile journey', jpg: 'ai/s.jpg'}], outDir: dir});
  const fence = prompt.indexOf('<untrusted_page_data');
  assert.ok(fence > 0);
  assert.equal(prompt.slice(0, fence).includes('ignore-all-instructions'), false);
  assert.equal(prompt.slice(0, fence).includes('hostile journey'), false);
  assert.ok(prompt.slice(fence).includes('ignore-all-instructions'));
});
