import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheck, isUsableCheck, classifyGoal, summarizeGoals, initialTurns, extendTurns, quoteIsOnPage, progressOf, visibleBookingLinks} from '../src/goals.mjs';
import {redactText, redactDeep} from '../src/redact.mjs';
import {validateBooking} from '../src/showtimes.mjs';
import {normalizeConfig} from '../src/config.mjs';

const config = normalizeConfig({url: 'https://x.test/', allowedHosts: ['x.test'], booking: {redirectPrefix: '/go/', requireSponsoredRel: true}});
const obs = (extra = {}) => ({url: 'https://x.test/movies/a', text: 'Showing Tonight at the Lichtblick', title: '', active: [], expanded: [], dialogOpen: false, headings: [], controls: [], listing: {count: 5, items: ['a']}, ...extra});

test('success conditions are checked against the page itself', () => {
  assert.equal(evaluateCheck({kind: 'page-text-contains', value: 'at the lichtblick'}, obs(), config), true);
  assert.equal(evaluateCheck({kind: 'page-text-contains', value: 'never there'}, obs(), config), false);
  assert.equal(evaluateCheck({kind: 'page-path-contains', value: '/movies/'}, obs(), config), true);
  assert.equal(evaluateCheck({kind: 'listing-at-least', value: '5'}, obs(), config), true);
  assert.equal(evaluateCheck({kind: 'listing-at-least', value: '6'}, obs(), config), false);
});

test('a condition looks at the whole page, not just what fits in a prompt', () => {
  const long = obs({text: 'x'.repeat(4000), fullText: `${'x'.repeat(5000)} Clear all filters`});
  assert.equal(evaluateCheck({kind: 'page-text-contains', value: 'clear all filters'}, long, config), true);
  assert.equal(quoteIsOnPage('clear all filters', long), true);
});

test('a filter condition reads which controls are switched on', () => {
  const check = {kind: 'filter-active', value: 'English subtitles', alsoRequire: 'non-empty-listing'};
  assert.equal(evaluateCheck(check, obs({active: ['English subtitles (OmeU)']}), config), true);
  assert.equal(evaluateCheck(check, obs({active: []}), config), false);
  assert.equal(evaluateCheck(check, obs({active: ['English subtitles (OmeU)'], listing: {count: 0, items: []}}), config), false, 'an empty result is not success');
});

test('a second requirement makes a journey condition specific', () => {
  const check = {kind: 'page-path-contains', value: '/movies/', alsoRequire: 'booking-link'};
  const link = {tag: 'a', name: 'Cinema site', href: 'https://x.test/go/abc'};
  assert.equal(evaluateCheck(check, obs({controls: [link]}), config), true);
  assert.equal(evaluateCheck(check, obs({controls: []}), config), false);
  assert.equal(evaluateCheck(check, obs({url: 'https://x.test/', controls: [link]}), config), false, 'a booking link on the landing page is not the journey');
  assert.equal(isUsableCheck({kind: 'page-path-contains', value: '/movies/', alsoRequire: 'bogus'}), false);
});

test('a booking link can end a journey without being followed', () => {
  const link = {tag: 'a', name: 'Cinema site', href: 'https://x.test/go/abc'};
  const other = {tag: 'a', name: 'About', href: 'https://x.test/about'};
  assert.equal(visibleBookingLinks(obs({controls: [other]}), config).length, 0);
  assert.equal(evaluateCheck({kind: 'booking-link-visible', value: ''}, obs({controls: [other, link]}), config), true);
});

test('meaningless conditions are rejected', () => {
  assert.equal(isUsableCheck({kind: 'page-text-contains', value: 'a'}), false);
  assert.equal(isUsableCheck({kind: 'listing-at-least', value: 'many'}), false);
  assert.equal(isUsableCheck({kind: 'made-up', value: 'something'}), false);
  assert.equal(isUsableCheck(undefined), false);
  assert.equal(evaluateCheck({kind: 'page-text-contains', value: 'a'}, obs(), config), false);
});

test('only a verified condition is a success', () => {
  assert.deepEqual(classifyGoal({stepsExecuted: 2, checkMet: true}), {outcome: 'SUCCESS', reason: 'success-condition-verified'});
  assert.equal(classifyGoal({stepsExecuted: 2, checkMet: false, claimed: 'achieved'}).reason, 'success-claim-not-verified');
  assert.equal(classifyGoal({stepsExecuted: 2, checkMet: false, claimed: 'achieved'}).outcome, 'INCOMPLETE');
});

test('exploration alone is never a successful journey', () => {
  assert.equal(classifyGoal({stepsExecuted: 8, stopReason: 'turn-budget-exhausted'}).outcome, 'INCOMPLETE');
  assert.equal(classifyGoal({stepsExecuted: 0, checkMet: true}).outcome, 'INCOMPLETE', 'a condition met with no steps proves nothing');
  assert.equal(classifyGoal({stepsExecuted: 0, checkMet: true, claimed: 'achieved'}).outcome, 'INCOMPLETE');
  assert.equal(classifyGoal({vacuous: true, stepsExecuted: 3, checkMet: true}).reason, 'criterion-already-met-before-journey');
});

test('a failure needs evidence from the page', () => {
  assert.deepEqual(classifyGoal({stepsExecuted: 1, claimed: 'blocked', quoteFound: true}).outcome, 'FAILURE');
  assert.equal(classifyGoal({stepsExecuted: 1, claimed: 'blocked', quoteFound: false}).reason, 'blocked-claim-without-evidence');
  assert.equal(classifyGoal({stepsExecuted: 0, claimed: 'blocked', quoteFound: true}).outcome, 'FAILURE', 'being stuck immediately is still a failure');
});

test('each stop reason stays incomplete and is recorded', () => {
  for (const stopReason of ['stalled', 'ai-call-budget', 'action-budget']) {
    assert.deepEqual(classifyGoal({stepsExecuted: 1, stopReason}), {outcome: 'INCOMPLETE', reason: stopReason});
  }
});

test('step budgets adapt to progress, within a hard cap', () => {
  assert.equal(initialTurns(3, 6), 3);
  assert.equal(initialTurns(99, 6), 4);
  assert.equal(initialTurns(undefined, 6), 3);
  assert.equal(initialTurns(1, 6), 2);
  assert.equal(extendTurns(3, 2, true, 6), 4, 'progress on the last turn earns another');
  assert.equal(extendTurns(3, 2, false, 6), 3, 'no progress earns nothing');
  assert.equal(extendTurns(3, 0, true, 6), 3, 'turns only extend when they run out');
  assert.equal(extendTurns(6, 5, true, 6), 6, 'never past the cap');
});

test('progress means the page actually changed', () => {
  assert.equal(progressOf(obs()), progressOf(obs()));
  assert.notEqual(progressOf(obs()), progressOf(obs({listing: {count: 2, items: ['b']}})));
  assert.notEqual(progressOf(obs()), progressOf(obs({url: 'https://x.test/about'})));
});

test('quoted evidence must really be on the page', () => {
  assert.equal(quoteIsOnPage('tonight at the', obs()), true);
  assert.equal(quoteIsOnPage('invented quote', obs()), false);
  assert.equal(quoteIsOnPage('', obs()), false);
});

test('journey outcomes are counted', () => {
  assert.deepEqual(summarizeGoals([{outcome: 'SUCCESS'}, {outcome: 'FAILURE'}, {outcome: 'INCOMPLETE'}, {outcome: 'INCOMPLETE'}]), {total: 4, SUCCESS: 1, FAILURE: 1, INCOMPLETE: 2});
});

const future = {title: 'F', venue: 'V', date: '2030-01-01', time: '10:00', startDate: '2030-01-01T09:00:00Z'};
const NOW = new Date('2026-11-08T10:00:00Z');

test('booking destinations are validated from published data', () => {
  const r = validateBooking([{...future, offerUrl: 'https://kino.example/tickets'}, {...future, offerUrl: null}, {...future, offerUrl: 'http://kino.example/x'}, {...future, offerUrl: 'not a url'}], [{rel: 'sponsored nofollow'}, {rel: 'nofollow'}], config, NOW);
  assert.equal(r.status, 'STATIC_ONLY');
  assert.equal(r.withDestination, 1);
  assert.deepEqual(r.destinationHosts, {'kino.example': 1});
  assert.equal(r.missing.length, 1);
  assert.deepEqual(r.invalid.map(x => x.reason), ['uses http', 'unparseable']);
  assert.equal(r.redirectLinksMissingRel, 1);
});

test('past screenings are not judged for booking', () => {
  assert.equal(validateBooking([{...future, startDate: '2020-01-01T00:00:00Z', offerUrl: null}], [], config, NOW).missing.length, 0);
});

test('a sponsored redirect prefix can never be requested', () => {
  assert.ok(config.excludePaths.includes('/go'));
});

test('site files may not carry credentials or session data', () => {
  for (const key of ['storageState', 'httpCredentials', 'cookies', 'extraHTTPHeaders', 'token', 'password']) {
    assert.throws(() => normalizeConfig({url: 'https://x.test', allowedHosts: ['x.test'], [key]: 'x'}), /credentials or session data/, key);
  }
});

test('secrets and personal data are redacted', () => {
  const key = ['sk', 'ant', 'abcdefghijklmnop'].join('-');
  const pat = `ghp_${'a'.repeat(30)}`;
  const jwt = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(8)}`;
  for (const value of [key, pat, jwt, 'write to me@example.org', 'Authorization: abcdefghijklmnopqrstuvwxyz', 'cookie: id=abc', 'cf_clearance=abc123', 'DE89 3704 0044 0532 0130 00', '4111 1111 1111 1111']) {
    const clean = redactText(`before ${value} after`);
    assert.ok(clean.includes('[redacted'), value);
    assert.ok(clean.includes('before'));
  }
  assert.equal(redactText('https://x.test/?token=abc&date=2026-11-09'), 'https://x.test/?token=[redacted]&date=2026-11-09');
});

test('ordinary content is left alone', () => {
  for (const value of ['Sun 8 Nov 14:00 OmU', '2026-11-08T13:00:00.000Z', 'https://www.ov-berlin.de/go/cmw26zbgo01fvfq1fd0jcao8e', 'Screen 1234567890', 'A cinema in Berlin']) {
    assert.equal(redactText(value), value);
  }
});

test('redaction reaches nested report data', () => {
  assert.deepEqual(redactDeep({a: [{b: 'mail x@y.co now'}], n: 3, nothing: null}), {a: [{b: 'mail [redacted-email] now'}], n: 3, nothing: null});
});
