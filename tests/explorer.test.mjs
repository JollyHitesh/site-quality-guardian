import test from 'node:test';
import assert from 'node:assert/strict';
import {controlKey, stateKeyOf, createGraph, addState, nextCandidate, markTried, graphSummary} from '../src/explorer.mjs';
import {checkCommutative, checkEmptyResult, checkFilterSemantics, detectAnomalies, updateBaseline, listingFingerprint, sameListing} from '../src/invariants.mjs';
import {changedParams} from '../src/audit.mjs';

const allowed = {allowed: true, kind: 'activate', reason: 'ok'};
const control = (name, extra = {}) => ({tag: 'button', role: 'button', name, region: 'main', classification: allowed, ...extra});
const obs = (extra = {}) => ({url: 'https://x.test/', title: 'T', active: [], expanded: [], dialogOpen: false, headings: [], controls: [], listing: {count: 0, items: []}, ...extra});
const limits = {maxStates: 50, maxDepth: 3, maxPerGroup: 2};

test('repeated links collapse to one page type', () => {
  const a = {tag: 'a', role: 'link', name: 'Film A', href: 'https://x.test/movies/a'};
  const b = {tag: 'a', role: 'link', name: 'Film B', href: 'https://x.test/movies/b'};
  assert.equal(controlKey(a), controlKey(b));
});

test('state identity follows selections, not changing data', () => {
  const base = obs({controls: [control('Filters')]});
  assert.equal(stateKeyOf(base), stateKeyOf(obs({controls: [control('Filters')], listing: {count: 99, items: ['x']}, title: 'Other'})));
  assert.notEqual(stateKeyOf(base), stateKeyOf(obs({controls: [control('Filters')], active: ['Tomorrow']})));
  assert.notEqual(stateKeyOf(base), stateKeyOf(obs({controls: [control('Filters')], url: 'https://x.test/?lang=en'})));
  assert.equal(stateKeyOf(base), stateKeyOf(obs({controls: [control('Filters')], url: 'https://x.test/?utm_source=x'})));
});

test('dates in a URL do not make a new state every day', () => {
  const a = obs({url: 'https://x.test/?date=2026-11-09'});
  const b = obs({url: 'https://x.test/?date=2026-12-24'});
  assert.equal(stateKeyOf(a), stateKeyOf(b));
});

test('a drawer without ARIA still counts as a new state, ignoring labels with counts', () => {
  const closed = obs({controls: [control('Filters')]});
  const open = obs({controls: [control('Filters'), control('English')]});
  assert.notEqual(stateKeyOf(closed), stateKeyOf(open));
  assert.equal(stateKeyOf(closed), stateKeyOf(obs({controls: [control('Filters'), control('Today 18')]})));
});

function graphWith(controls) {
  const graph = createGraph();
  addState(graph, 'root', obs({controls}), [], limits);
  return graph;
}

test('never-tested controls are tried before well-tested ones', () => {
  const graph = graphWith([control('Old'), control('New')]);
  const pick = nextCandidate(graph, {counts: {'mobile|button|old': 9}, device: 'mobile'}, limits);
  assert.equal(pick.control.name, 'New');
});

test('open defects pull attention back to their page type', () => {
  const graph = graphWith([
    {tag: 'a', role: 'link', name: 'Blog', href: 'https://x.test/blog/a', region: 'main', classification: {allowed: true, kind: 'navigate'}},
    {tag: 'a', role: 'link', name: 'Film', href: 'https://x.test/movies/a', region: 'main', classification: {allowed: true, kind: 'navigate'}},
  ]);
  assert.equal(nextCandidate(graph, {hotTemplates: ['/movies/:slug']}, limits).control.name, 'Film');
});

test('filter-like controls are explored before the footer', () => {
  const graph = graphWith([control('Imprint', {region: 'footer'}), control('Filters')]);
  assert.equal(nextCandidate(graph, {}, limits).control.name, 'Filters');
});

test('a control already tried elsewhere gives way to one not yet seen', () => {
  const graph = graphWith([control('Repeat'), control('Fresh')]);
  graph.groupsTried[controlKey(control('Repeat'))] = 1;
  assert.equal(nextCandidate(graph, {}, limits).control.name, 'Fresh');
});

test('exploration stops at the configured limits and reports what is untested', () => {
  const graph = graphWith([control('A'), control('B')]);
  const first = nextCandidate(graph, {}, limits);
  markTried(graph, first.state, first.key);
  markTried(graph, graph.states.root, controlKey(control('B')));
  assert.equal(nextCandidate(graph, {}, limits), null);
  assert.deepEqual(graphSummary(graph).untested, []);
  assert.equal(addState(createGraph(), 'x', obs(), [], {maxStates: 0}), null);
});

test('filter order must not change results', () => {
  const list = (count, items) => ({count, items});
  assert.deepEqual(checkCommutative(['a', 'b'], list(2, ['x', 'y']), list(2, ['y', 'x'].sort())), []);
  assert.equal(checkCommutative(['a', 'b'], list(5, ['x']), list(1, ['z']))[0].kind, 'filter-order-dependent');
  assert.equal(sameListing(listingFingerprint({count: 2, items: ['A b', 'c']}), listingFingerprint({count: 2, items: ['c', 'a  B']})), true);
});

test('a filter that empties the list must explain itself', () => {
  assert.equal(checkEmptyResult('A', {count: 5}, {count: 0}, false).length, 1);
  assert.equal(checkEmptyResult('A', {count: 5}, {count: 0}, true).length, 0);
  assert.equal(checkEmptyResult('A', {count: 1}, {count: 0}, false).length, 0);
});

test('filter meaning is enforced only where the page shows the attribute', () => {
  const rule = {itemsMustMatch: 'OmU', applicableIf: '\\b(OV|OmU)\\b'};
  assert.deepEqual(checkFilterSemantics(rule, 'German', {items: ['Film A OmU', 'Film B OmU', 'Film C OmU']}), []);
  assert.equal(checkFilterSemantics(rule, 'German', {items: ['Film A OV', 'Film B OV', 'Film C OV']})[0].kind, 'filter-semantics');
  assert.deepEqual(checkFilterSemantics(rule, 'German', {items: ['Film A', 'Film B', 'Film C']}), [], 'cards without language tags prove nothing');
});

test('anomalies need history, and need a large change', () => {
  const current = {itemCount: 3, textLength: 5000, controlCount: 80, headings: ['Listing']};
  assert.deepEqual(detectAnomalies(current, undefined, 'home'), []);
  let baseline;
  for (let i = 0; i < 2; i++) baseline = updateBaseline(baseline, {itemCount: 40, textLength: 5000, controlCount: 80, headings: ['Listing']});
  assert.deepEqual(detectAnomalies(current, baseline, 'home'), [], 'two runs are not a pattern');
  baseline = updateBaseline(baseline, {itemCount: 40, textLength: 5000, controlCount: 80, headings: ['Listing']});
  assert.deepEqual(detectAnomalies({...current, itemCount: 39}, baseline, 'home'), [], 'normal variation');
  assert.equal(detectAnomalies(current, baseline, 'home')[0].kind, 'anomaly-itemCount');
});

test('a redesign is flagged as a structure change', () => {
  let baseline;
  for (let i = 0; i < 3; i++) baseline = updateBaseline(baseline, {headings: ['One', 'Two', 'Three']});
  assert.equal(detectAnomalies({headings: ['Other']}, baseline, 'home').find(f => f.kind === 'anomaly-structure').status, 'LIKELY');
});

test('changed query parameters are identified', () => {
  assert.deepEqual(changedParams('https://x.test/?a=1', 'https://x.test/?a=2&b=3').sort(), ['a', 'b']);
  assert.deepEqual(changedParams('https://x.test/', 'https://x.test/'), []);
});
