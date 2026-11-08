import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {emptyMemory, loadMemory, saveMemoryFile, sanitizeMemory, annotateFindings, learnFromRun, recordIncompleteRun, hotTemplates} from '../src/memory.mjs';

const finding = (over = {}) => ({fingerprint: 'k-1', kind: 'k', title: 'Thing broke', severity: 'P2', status: 'CONFIRMED', devices: ['mobile'], pages: ['/'], instances: [], ...over});
const report = (findings, over = {}) => ({mode: 'smoke', status: 'COMPLETED', finishedAt: '2026-11-08T00:00:00Z', findings, actions: [], visitedPaths: ['/'], config: {devices: ['mobile']}, coverage: {templates: ['/'], inspectedTemplates: ['/'], states: ['s1'], stateCount: 1}, ...over});

function run(memory, findings, over) {
  const r = report(findings, over);
  annotateFindings(r.findings, memory);
  learnFromRun(memory, r);
  return r;
}

test('a finding moves from new, to recurring, to resolved, to regressed', () => {
  const m = emptyMemory();
  assert.equal(run(m, [finding()]).findings[0].trend, 'NEW');
  assert.equal(run(m, [finding()]).findings[0].trend, 'RECURRING');
  run(m, []);
  assert.equal(m.findings['k-1'].state, 'open', 'one miss could be chance');
  const r = run(m, []);
  assert.equal(m.findings['k-1'].state, 'resolved');
  assert.deepEqual(r.resolvedThisRun, ['Thing broke']);
  assert.equal(run(m, [finding()]).findings[0].trend, 'REGRESSED');
  assert.equal(m.findings['k-1'].regressions, 1);
});

test('a finding is not resolved if its page was not checked', () => {
  const m = emptyMemory();
  run(m, [finding({pages: ['/movies/:slug']})]);
  const elsewhere = {coverage: {templates: ['/movies/:slug'], inspectedTemplates: ['/'], states: [], stateCount: 0}};
  run(m, [], elsewhere);
  run(m, [], elsewhere);
  assert.equal(m.findings['k-1'].state, 'open');
  assert.equal(m.findings['k-1'].misses, 0);
});

test('a sampled or behavioural finding resolves only when its own check is repeated', () => {
  const m = emptyMemory();
  run(m, [finding({fingerprint: 'link', kind: 'source-link-broken', pages: [], scope: 'https://a.example/x'}), finding({fingerprint: 'reload', kind: 'state-lost-on-reload'}), finding({fingerprint: 'a11y', kind: 'accessibility-x', pages: ['/blog']}), finding({fingerprint: 'goal', kind: 'goal-blocked', pages: []})]);
  const unrelated = {coverage: {inspectedTemplates: ['/', '/blog'], a11yTemplates: [], checksRun: [], controlKeys: [], sources: ['https://b.example/y'], states: [], stateCount: 0}};
  run(m, [], unrelated);
  run(m, [], unrelated);
  for (const key of ['link', 'reload', 'a11y', 'goal']) assert.equal(m.findings[key].state, 'open', key);
  const repeated = {coverage: {inspectedTemplates: ['/', '/blog'], a11yTemplates: ['/blog'], checksRun: ['state-lost-on-reload'], controlKeys: [], sources: ['https://a.example/x'], states: [], stateCount: 0}};
  run(m, [], repeated);
  run(m, [], repeated);
  for (const key of ['link', 'reload', 'a11y']) assert.equal(m.findings[key].state, 'resolved', key);
  assert.equal(m.findings.goal.state, 'open', 'absence cannot resolve an AI-visitor finding');
});

test('alternating results are labelled flaky', () => {
  const m = emptyMemory();
  run(m, [finding()]);
  run(m, []);
  run(m, [finding()]);
  run(m, []);
  assert.equal(run(m, [finding()]).findings[0].trend, 'FLAKY');
});

test('transient failures do not count as defects', () => {
  const m = emptyMemory();
  const r = run(m, [finding({status: 'TRANSIENT'})]);
  assert.equal(r.findings[0].trend, 'TRANSIENT');
  assert.equal(m.findings['k-1'], undefined);
  assert.equal(m.history.at(-1).transient, 1);
});

test('an incomplete run records history but learns nothing', () => {
  const m = emptyMemory();
  run(m, [finding()]);
  const before = JSON.stringify(m.findings);
  recordIncompleteRun(m, report([], {status: 'TIMED_OUT'}));
  assert.equal(JSON.stringify(m.findings), before);
  assert.equal(m.runs, 1);
  assert.equal(m.history.at(-1).status, 'TIMED_OUT');
});

test('only completed actions count as coverage', () => {
  const m = emptyMemory();
  run(m, [], {actions: [{device: 'mobile', controlKey: 'button|map', outcome: 'PASS'}, {device: 'mobile', controlKey: 'button|x', outcome: 'SKIPPED/ERROR: no'}]});
  assert.equal(m.coverage.controls['mobile|button|map'], 1);
  assert.equal(m.coverage.controls['mobile|button|x'], undefined);
});

test('source usefulness is learned', () => {
  const m = emptyMemory();
  run(m, [], {showtimes: {results: [{source: 'https://a.example/x', status: 'MATCH'}, {source: 'https://b.example/y', status: 'UNAVAILABLE'}]}});
  assert.deepEqual(m.sources['a.example'], {attempts: 1, useful: 1});
  assert.deepEqual(m.sources['b.example'], {attempts: 1, useful: 0});
});

test('open findings identify the page types needing attention', () => {
  const m = emptyMemory();
  run(m, [finding({pages: ['/movies/:slug']})]);
  assert.deepEqual(hotTemplates(m), ['/movies/:slug']);
});

test('state survives a save and load, written atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-mem-'));
  const file = path.join(dir, 'nested', 'site.json');
  const m = emptyMemory('site');
  run(m, [finding()]);
  saveMemoryFile(m, file);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['site.json']);
  assert.equal(loadMemory(file, 'site').memory.findings['k-1'].seenRuns, 1);
});

test('a corrupt file is preserved and reported, not silently discarded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-mem-'));
  const file = path.join(dir, 'site.json');
  fs.writeFileSync(file, '{broken');
  const {memory, warning} = loadMemory(file, 'site');
  assert.equal(memory.runs, 0);
  assert.match(warning, /unreadable/);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{broken');
});

test('a missing file is simply a first run', () => {
  const {memory, warning} = loadMemory('/nonexistent/x.json', 'site');
  assert.equal(memory.runs, 0);
  assert.equal(warning, null);
});

test('hostile memory is coerced and bounded on load', () => {
  const m = sanitizeMemory({
    schemaVersion: 2, runs: 'many', history: 'x',
    findings: {a: {title: 'x'.repeat(5000), severity: 'P9', state: 'hacked', seenRuns: -4, pages: ['/'.repeat(500)], bits: 'evil1'}, b: 'notobject'},
    lessons: [{text: 'y'.repeat(900), at: 't'}, 'str'], baselines: {s: {itemCount: ['a', 3], headings: 'x'}},
  });
  assert.equal(m.runs, 0);
  assert.deepEqual(m.history, []);
  assert.equal(m.findings.a.title.length, 160);
  assert.equal(m.findings.a.severity, 'P3');
  assert.equal(m.findings.a.state, 'open');
  assert.equal(m.findings.a.seenRuns, 0);
  assert.equal(m.findings.a.bits, '1');
  assert.equal(m.findings.b, undefined);
  assert.equal(m.lessons.length, 1);
  assert.equal(m.lessons[0].text.length, 200);
  assert.deepEqual(m.baselines.s.itemCount, [3]);
});

test('the earlier memory format upgrades without losing coverage', () => {
  const m = sanitizeMemory({schemaVersion: 1, runs: 3, actionCounts: {'mobile:click:Map': 2}, visitedPaths: {'/a': 4}, lastFindings: [{fingerprint: 'x'}]});
  assert.equal(m.runs, 3);
  assert.equal(m.coverage.paths['/a'], 4);
  assert.equal(m.coverage.controls['mobile|button|Map'], 2);
  assert.deepEqual(m.findings, {});
});
