// Runs the real UX auditor in a real browser against sites with planted UX anti-patterns.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startUxFixture, uxConfig} from './fixtures/ux-sites.mjs';

let browsersReady = false;
try {
  const {chromium, webkit} = await import('playwright');
  browsersReady = fs.existsSync(chromium.executablePath()) && fs.existsSync(webkit.executablePath());
} catch { browsersReady = false; }
const skip = !browsersReady && 'Playwright browsers not installed';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fake = path.join(root, 'tests', 'fixtures', 'fake-claude-ux.cjs');

function audit(dir, config) {
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const log = path.join(dir, 'claude.jsonl');
  const child = spawn(process.execPath, ['src/cli.mjs', '--mode', 'ux', '--config', file, '--out', path.join(dir, 'out'), '--memory', path.join(dir, 'state.json')], {cwd: root, stdio: 'ignore', env: {...process.env, GUARDIAN_CLAUDE_BIN: fake, FAKE_CLAUDE_LOG: log}});
  return new Promise(resolve => child.on('close', code => resolve({code, report: JSON.parse(fs.readFileSync(path.join(dir, 'out', 'fixture', 'report.json'), 'utf8')), calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []})));
}

const stopServer = s => { s.close(); s.closeAllConnections(); };

test('planted UX anti-patterns are found, each with evidence, and history works', {skip, timeout: 560000}, async () => {
  const {server, hits, port} = await startUxFixture('bad');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-ux-'));
  const config = uxConfig('bad', port);
  const {code, report, calls} = await audit(dir, config);
  assert.equal(code, 0);
  assert.equal(report.status, 'COMPLETED');
  const {ux} = report;
  const kinds = new Set(ux.issues.map(i => i.kind));
  const planted = {
    'confusing navigation': ['nav-label-conflict'],
    'hidden controls': ['hover-only-control', 'key-control-buried'],
    'unnecessary steps': ['journey-excess-actions', 'journey-interstitial'],
    'poor error recovery': ['empty-no-message', 'empty-no-recovery', 'notfound-soft', 'notfound-no-path', 'journey-dead-end'],
    'mobile layout problems': ['layout-overflow', 'tap-target-too-small', 'primary-content-late', 'desktop-only-destination'],
    'keyboard failures': ['kb-focus-obscured', 'kb-focus-not-visible', 'kb-unreachable-control', 'kb-activation-fails', 'kb-trap', 'kb-positive-tabindex', 'kb-focus-lost', 'dialog-no-semantics', 'dialog-focus-not-moved', 'dialog-focus-escapes', 'dialog-no-escape', 'sem-landmarks', 'sem-headings', 'sem-state-not-exposed', 'sem-no-status'],
    'feedback': ['journey-result-offscreen', 'journey-backtracking'],
  };
  for (const [name, expected] of Object.entries(planted)) for (const kind of expected) assert.ok(kinds.has(kind), `${name}: expected ${kind}; got ${[...kinds].join(', ')}`);

  // Every recommendation is backed by evidence that exists on disk.
  const shots = new Map(ux.shots.map(s => [s.id, s]));
  const actions = new Set(report.actions.map(a => a.id));
  for (const issue of ux.issues) {
    assert.ok(issue.evidenceRefs.length, `${issue.kind} has evidence`);
    for (const ref of issue.evidenceRefs) {
      if (ref.startsWith('A')) assert.ok(actions.has(ref), `${ref} is a real action`);
      else assert.ok(fs.existsSync(path.join(dir, 'out', 'fixture', shots.get(ref).jpg)), `${ref} exists`);
    }
    for (const field of ['userGoal', 'persona', 'problem', 'principle', 'recommendation', 'alternative', 'expectedBenefit', 'implementationGuidance', 'validationMethod']) assert.ok(issue[field], `${issue.kind}.${field}`);
    assert.ok(issue.acceptanceCriteria.length && issue.reproductionSteps.length, issue.kind);
  }

  // The specific measurements behind the planted steps.
  const results = ux.journeys.find(j => j.id === 'reach-results');
  assert.equal(results.outcome, 'SUCCESS');
  assert.equal(results.metrics.actionCount, 3);
  assert.equal(results.metrics.interstitialSteps, 2);
  assert.equal(results.metrics.repeatedActions, 0);
  assert.equal(results.metrics.deadEnds, 0, 'moving to a new page is not a dead end');
  assert.ok(results.stages.length >= 3, 'screenshots are taken at each stage');
  const western = ux.journeys.find(j => j.id === 'find-western');
  assert.equal(western.metrics.repeatedActions, 1);
  assert.equal(western.metrics.deadEnds, 1);
  assert.equal(ux.journeys.find(j => j.id === 'filter-comedy').metrics.resultsOffScreen, 1);
  assert.ok(calls.filter(c => c.schema.includes('status') || c.images === 0).every(c => !c.elsewhere), 'journeys can only use what a visitor can see');

  // Measured facts and expert claims are kept apart, and the evidence rules work end to end.
  assert.ok(ux.issues.some(i => i.class === 'detected-defect' && i.provenance === 'measured'));
  assert.ok(ux.issues.some(i => i.class === 'expert-judgment' && i.provenance === 'expert'));
  assert.ok(ux.issues.some(i => i.class === 'research-needed'));
  assert.ok(ux.issues.filter(i => i.provenance === 'expert').every(i => i.rootCause.status === 'hypothesis'));
  assert.ok(ux.issues.filter(i => i.provenance === 'expert').every(i => i.severity !== 'P0'));
  assert.ok(ux.issues.some(i => ['P0', 'P1'].includes(i.severity)), 'severity is not capped at P2');
  const reasons = ux.expert.rejected.map(r => r.reason);
  for (const reason of ['no-screenshot-or-action-evidence', 'asserted-unmeasured-human-state', 'quote-not-on-any-page', 'contradicted-on-cross-check']) assert.ok(reasons.includes(reason), reason);
  for (const title of ['Claims a feeling', 'Cites a screenshot it never saw', 'Misquotes the page', 'Reviewer contradicted please']) assert.equal(ux.issues.some(i => i.title === title), false, title);
  assert.equal(ux.issues.some(i => i.title === 'Duplicate of an earlier claim'), false, 'duplicates merge into the first claim');
  assert.ok(ux.expert.merged >= 1);
  assert.ok(ux.assessments.find(a => a.criterion === 'X-empty').verdict === 'not-assessed', 'insufficient evidence stays unscored');
  assert.ok(ux.assessments.find(a => a.criterion === 'X-spacing').verdict === 'not-assessed', 'an uncited verdict is discarded');

  // Bounded and read-only.
  assert.ok(report.ai.calls <= report.ai.budget);
  assert.ok(calls.every(c => c.fenced), 'page data is always fenced');
  assert.ok(calls.filter(c => c.images > 0).every(c => c.images <= 8));
  assert.equal(hits.some(h => !h.startsWith('GET ')), false, 'only reads reach the server');
  assert.equal(report.findings.some(f => /guardian-ux-probe/.test(JSON.stringify(f))), false, 'the error-page probe is not a defect in itself');
  assert.equal(report.showtimes.results.length, 0);

  // The owner's report.
  const html = fs.readFileSync(path.join(dir, 'out', 'fixture', 'site', 'ux', 'index.html'), 'utf8');
  for (const text of ['What visitors are trying to do', 'Where the design makes it harder', 'What should change first', 'How we will know it worked', 'not a conformance statement', 'Detected by measurement', 'Expert judgement', 'Needs user research', 'noindex']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /satisfaction score/i);
  assert.ok(fs.readFileSync(path.join(dir, 'out', 'fixture', 'ux-report.md'), 'utf8').includes('Acceptance'));
  assert.ok(fs.existsSync(path.join(dir, 'out', 'site', 'fixture', 'ux', 'index.html')), 'the dashboard includes the report');
  assert.match(fs.readFileSync(path.join(dir, 'out', 'site', 'index.html'), 'utf8'), /Expert UX report/);

  // A second run reuses what worked and compares like with like.
  const second = await audit(dir, config);
  stopServer(server);
  const again = second.report.ux;
  assert.ok(again.journeys.filter(j => j.id !== 'find-western').every(j => j.planner === 'replayed'), 'known routes cost no Claude calls');
  assert.ok(second.report.ai.calls < report.ai.calls, `fewer calls on a repeat: ${second.report.ai.calls} vs ${report.ai.calls}`);
  assert.equal(again.trend.comparable, true);
  const measuredKept = again.issues.filter(i => i.provenance === 'measured');
  assert.ok(measuredKept.some(i => i.trend === 'RECURRING' && i.occurrences === 2));
  const firstConfidence = new Map(ux.issues.map(i => [i.id, i.confidence]));
  for (const i of again.issues.filter(x => x.provenance === 'expert' && firstConfidence.has(x.id))) assert.equal(i.confidence, firstConfidence.get(i.id), 'repetition is not evidence');
  assert.ok(second.report.ux.journeyHistory[results.key].length === 2);
});

test('a well-built site produces no measured UX problems', {skip, timeout: 300000}, async () => {
  const {server, hits, port} = await startUxFixture('good');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-ux-'));
  const {report} = await audit(dir, uxConfig('good', port));
  stopServer(server);
  const {ux} = report;
  const measured = ux.issues.filter(i => i.provenance === 'measured');
  assert.deepEqual(measured.map(i => `${i.kind}: ${i.title}`), [], 'false positives on the control site');
  for (const c of Object.values(ux.scorecard)) assert.equal(c.measuredScore, 100, c.label);
  assert.equal(ux.keyboard.dialogs.length, 1, 'the dialog was really tested');
  const dialog = ux.keyboard.dialogs[0];
  assert.deepEqual([dialog.semantic, dialog.focusMoved, dialog.escapedFocus, dialog.escapeCloses, dialog.focusRestored], [true, true, 0, true, true]);
  assert.equal(ux.recovery.notFound.status, 404);
  assert.equal(ux.recovery.emptySearch.hasMessage, true);
  assert.equal(hits.some(h => !h.startsWith('GET ')), false);
  assert.match(fs.readFileSync(path.join(dir, 'out', 'fixture', 'site', 'ux', 'index.html'), 'utf8'), /not a conformance statement/, 'a clean result still carries the warning');
});

test('without Claude the measured assessment still stands, and says what is missing', {skip, timeout: 300000}, async () => {
  const {server, port} = await startUxFixture('good');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-ux-'));
  const config = uxConfig('good', port);
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify({...config, ux: {...config.ux, devices: ['desktop'], journeys: []}}));
  const child = spawn(process.execPath, ['src/cli.mjs', '--mode', 'ux', '--config', file, '--out', path.join(dir, 'out'), '--memory', path.join(dir, 'state.json')], {cwd: root, stdio: 'ignore', env: {...process.env, GUARDIAN_CLAUDE_BIN: path.join(dir, 'no-such-claude')}});
  await new Promise(resolve => child.on('close', resolve));
  stopServer(server);
  const {ux} = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'fixture', 'report.json'), 'utf8'));
  assert.equal(ux.expert.status, 'unavailable');
  assert.equal(ux.issues.filter(i => i.provenance === 'expert').length, 0);
  assert.equal(typeof ux.scorecard.accessibility.score, 'number');
  assert.ok(ux.assessments.filter(a => a.provenance === 'expert').length === 0);
  assert.equal(ux.scorecard['task-efficiency'].score, null, 'no journeys means no efficiency score');
});
