import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSignals, analyzeSticky, analyzeTapTargets, templateOf} from '../src/checks.mjs';
import {analyzePerformance, rate} from '../src/perf.mjs';
import {upsertFinding, sortFindings, saveReport} from '../src/report.mjs';
import {normalizeConfig, forDevice, deviceShare} from '../src/config.mjs';
import {parseCliOutput, pickScreenshots} from '../src/claude.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const clean = {url: 'https://x.test/', viewportWidth: 390, docWidth: 390, overflowOffenders: [], headings: ['Hi'], textLength: 2000, bodyStart: 'Welcome', tapTargets: [], textFields: [], smallText: [], smallTextCount: 0, brokenImages: [], oversizedImages: [], bookingLinkCount: 0, invalidBookingLinks: []};
const kinds = list => list.map(f => f.kind);
const target = (o = {}) => ({label: 'x', element: 'a', w: 100, h: 30, rect: {x: 0, y: 0, w: 100, h: 30}, primary: false, crowded: false, ...o});

test('a healthy page produces no findings', () => {
  assert.deepEqual(analyzeSignals(clean, {family: 'mobile'}), []);
});
test('blank landing page is a blocker, blank inner page is not', () => {
  assert.equal(analyzeSignals({...clean, textLength: 5}, {family: 'mobile', isLanding: true})[0].severity, 'P0');
  assert.equal(analyzeSignals({...clean, textLength: 5}, {family: 'mobile'})[0].severity, 'P1');
});
test('overflow is more severe on phones', () => {
  const raw = {...clean, docWidth: 500};
  assert.equal(analyzeSignals(raw, {family: 'mobile'})[0].severity, 'P1');
  assert.equal(analyzeSignals({...raw, viewportWidth: 1440, docWidth: 1600}, {family: 'desktop'})[0].severity, 'P2');
});
test('phone-only rules do not fire on desktop', () => {
  const raw = {...clean, textFields: [{label: 'q', element: 'input', fontSize: 14, rect: {}}], smallTextCount: 3};
  assert.deepEqual(analyzeSignals(raw, {family: 'desktop'}), []);
  assert.deepEqual(kinds(analyzeSignals(raw, {family: 'mobile'})), ['input-zoom-ios', 'small-text']);
});
test('16px inputs are fine', () => {
  assert.deepEqual(analyzeSignals({...clean, textFields: [{label: 'q', element: 'input', fontSize: 16, rect: {}}]}, {family: 'mobile'}), []);
});
test('tap target tiers', () => {
  assert.deepEqual(kinds(analyzeTapTargets([target({w: 14, h: 14, crowded: true})])), ['tap-target-too-small']);
  assert.deepEqual(analyzeTapTargets([target({w: 14, h: 14, crowded: false})]), [], 'a small but well-spaced target meets WCAG 2.5.8');
  assert.deepEqual(kinds(analyzeTapTargets([target({primary: true})])), ['primary-tap-target-small']);
  assert.deepEqual(kinds(analyzeTapTargets([target()])), ['tap-target-comfort']);
});
test('tap targets of the same kind are grouped', () => {
  const [f] = analyzeTapTargets([target({label: 'Save'}), target({label: 'Save'}), target({label: 'Go'})]);
  assert.deepEqual(f.evidence.targets.map(t => [t.label, t.count]), [['Save', 2], ['Go', 1]]);
});
test('sticky coverage limits differ by orientation', () => {
  assert.equal(analyzeSticky({share: 0.36}).length, 1);
  assert.equal(analyzeSticky({share: 0.2}).length, 0);
  assert.equal(analyzeSticky({share: 0.4}, {landscape: true}).length, 0);
  assert.equal(analyzeSticky({share: 0.6}, {landscape: true}).length, 1);
});
test('page templates', () => {
  assert.equal(templateOf('/'), '/');
  assert.equal(templateOf('/about'), '/about');
  assert.equal(templateOf('/movies/foo'), '/movies/:slug');
  assert.equal(templateOf('/guide/a/b'), '/guide/:slug');
});
test('performance rating and findings', () => {
  assert.equal(rate('lcpMs', 2500), 'good');
  assert.equal(rate('lcpMs', 3000), 'needs-improvement');
  assert.equal(rate('lcpMs', 4001), 'poor');
  assert.equal(rate('cls', null), 'unknown');
  const f = analyzePerformance({lcpMs: 5000, cls: 0.01, tbtMs: 300, lcpLazy: true}, '/');
  assert.deepEqual(f.map(x => [x.kind, x.severity]), [['performance-lcpMs', 'P2'], ['performance-tbtMs', 'P3'], ['lazy-lcp-image', 'P2']]);
});
test('repeat findings merge across pages and devices and keep the worst severity', () => {
  const all = [];
  upsertFinding(all, {kind: 'k', title: 'T', severity: 'P3', status: 'LIKELY', device: 'mobile', page: '/a'});
  upsertFinding(all, {kind: 'k', title: 'T', severity: 'P1', device: 'desktop', page: '/b'});
  assert.equal(all.length, 1);
  assert.equal(all[0].severity, 'P1');
  assert.equal(all[0].status, 'CONFIRMED');
  assert.deepEqual(all[0].devices, ['mobile', 'desktop']);
  assert.deepEqual(all[0].pages, ['/a', '/b']);
});
test('long titles differing at the end stay separate findings', () => {
  const all = [];
  const stem = 'a'.repeat(100);
  upsertFinding(all, {kind: 'k', title: `${stem}1`});
  upsertFinding(all, {kind: 'k', title: `${stem}2`});
  assert.equal(all.length, 2);
});
test('sorting puts severity first, then the priority device', () => {
  const list = [{severity: 'P2', devices: ['desktop'], title: 'd'}, {severity: 'P2', devices: ['mobile'], title: 'm'}, {severity: 'P1', devices: ['desktop'], title: 'top'}];
  assert.deepEqual(sortFindings(list, 'mobile').map(f => f.title), ['top', 'm', 'd']);
});
test('report escapes page-controlled text', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-report-'));
  const findings = [];
  upsertFinding(findings, {kind: 'k', title: '<img src=x onerror=alert(1)>', device: 'mobile', page: '/', evidence: {a: '<script>'}});
  saveReport({config: {name: 'N', url: 'u'}, mode: 'smoke', status: 'COMPLETED', finishedAt: 't', actions: [], findings, screenshots: [], visitedPaths: [], performance: [], suggestions: [{title: '<b>x', severity: 'P2', device: 'm', evidenceStep: 'A1', userImpact: 'i', suggestedFix: 'f', validationNeeded: 'v'}], errors: [], coverage: {missingControls: {}}}, out);
  const html = fs.readFileSync(path.join(out, 'site', 'index.html'), 'utf8');
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>x'), false);
});
test('config validation and device overrides', () => {
  assert.throws(() => normalizeConfig({url: 'https://x.test', allowedHosts: []}), /allowedHosts/);
  assert.throws(() => normalizeConfig({url: 'https://x.test', allowedHosts: ['x.test'], devices: ['fridge']}), /Unknown device/);
  const c = normalizeConfig({url: 'https://x.test', allowedHosts: ['x.test'], devices: ['mobile', 'mobile-small', 'desktop'], filters: ['A'], deviceOverrides: {mobile: {filters: ['B']}, 'mobile-small': {filters: ['C']}}});
  assert.deepEqual(forDevice(c, 'mobile').filters, ['B']);
  assert.deepEqual(forDevice(c, 'mobile-small').filters, ['C'], 'exact device beats family');
  assert.deepEqual(forDevice(c, 'desktop').filters, ['A']);
});
test('the first device gets the largest budget share', () => {
  assert.equal(deviceShare(50, 1, true), 50);
  assert.equal(deviceShare(50, 3, true), 30);
  assert.equal(deviceShare(50, 3, false), 10);
});
test('CLI output parser reads the final stream line and rejects errors', () => {
  assert.deepEqual(parseCliOutput('{"type":"system"}\n{"type":"result","structured_output":{"a":1}}\n'), {a: 1});
  assert.deepEqual(parseCliOutput('{"result":"```json\\n{\\"a\\":2}\\n```"}'), {a: 2});
  assert.throws(() => parseCliOutput('{"is_error":true,"subtype":"error_max_turns"}'), /error_max_turns/);
});
test('screenshots from the priority device are sent to the AI first', () => {
  const shots = ['screenshots/01-desktop-a.png', 'screenshots/02-mobile-small-a.png', 'screenshots/03-mobile-a.png'];
  assert.deepEqual(pickScreenshots(shots, 'mobile', 2), ['screenshots/03-mobile-a.png', 'screenshots/01-desktop-a.png']);
});
