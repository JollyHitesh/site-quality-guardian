import test from 'node:test';
import assert from 'node:assert/strict';
import {berlinTimeParts, nextScreeningPlausibility, extractScreenings, compareWithRendered, matchOnSourcePage, chooseSample, summarizeVerification} from '../src/showtimes.mjs';

const TZ = 'Europe/Berlin';
const event = (over = {}) => ({'@type': 'ScreeningEvent', name: 'Wings (OMEU)', startDate: '2026-11-08T13:00:00.000Z', url: 'https://x.test/movies/wings', location: {'@type': 'MovieTheater', name: 'Lichtblick', url: 'https://cinema.example/programm'}, workPresented: {'@type': 'Movie', name: 'Wings of Desire', alternateName: 'Der Himmel über Berlin'}, ...over});
const ld = (...nodes) => [JSON.stringify({'@graph': nodes})];

test('Berlin local time used instead of visitor timezone', () => {
  const p = berlinTimeParts(new Date('2026-11-08T23:30:00Z'), TZ);
  assert.deepEqual([p.day, p.hour, p.minute], [9, 0, 30]);
});

test('"Next" label rejects a screening that is long past', () => {
  const now = new Date('2026-11-08T20:00:00Z');
  assert.equal(nextScreeningPlausibility('Next: Sun 8 Nov · 14:00', now, TZ).status, 'PAST_NEXT_SHOWTIME');
  assert.equal(nextScreeningPlausibility('Next: Sun 8 Nov · 22:00', now, TZ).status, 'PLAUSIBLE');
  assert.equal(nextScreeningPlausibility('no label', now, TZ).status, 'NOT_DETECTED');
  assert.equal(nextScreeningPlausibility('Next: Fri 1 Jan · 10:00', new Date('2026-12-31T10:00:00Z'), TZ).shown.startsWith('2027'), true, 'year rollover');
});

test('schema.org events convert to site-local time', () => {
  const [s] = extractScreenings(ld(event()), TZ);
  assert.equal(s.title, 'Wings of Desire');
  assert.equal(s.alternateTitle, 'Der Himmel über Berlin');
  assert.deepEqual([s.date, s.time, s.venue], ['2026-11-08', '14:00', 'Lichtblick']);
  assert.equal(s.venueUrl, 'https://cinema.example/programm');
});

test('summer time is handled', () => {
  assert.equal(extractScreenings(ld(event({startDate: '2026-07-01T18:00:00Z'})), TZ)[0].time, '20:00');
});

test('malformed structured data is skipped, not fatal', () => {
  assert.deepEqual(extractScreenings(['{not json', '[1,2]', JSON.stringify({'@type': 'WebSite'}), JSON.stringify(event({startDate: 'soon'}))], TZ), []);
});

test('duplicates collapse', () => {
  assert.equal(extractScreenings(ld(event(), event()), TZ).length, 1);
});

const screening = extractScreenings(ld(event()), TZ)[0];
const NOW = new Date('2026-11-08T10:00:00Z');

test('rendered times are compared with structured data', () => {
  assert.deepEqual(compareWithRendered([screening], 'Sun 8 Nov 14:00 OmeU', NOW), []);
  const [issue] = compareWithRendered([screening], 'Sun 8 Nov 15:00 OmeU', NOW);
  assert.deepEqual([issue.type, issue.timeShown], ['not-rendered', false]);
});

test('past screenings are reported, within a grace period', () => {
  assert.equal(compareWithRendered([screening], 'x', new Date('2026-11-08T14:00:00Z'))[0].type, 'past');
  assert.deepEqual(compareWithRendered([screening], '14:00 8 Nov', new Date('2026-11-08T13:10:00Z')), []);
});

const page = body => `${'Programm und Tickets. '.repeat(20)} ${body}`;

test('a source page confirms title, date and time together', () => {
  assert.equal(matchOnSourcePage(screening, page('Wings of Desire 08.11. 14:00 Uhr OmeU')).status, 'MATCH');
  assert.equal(matchOnSourcePage(screening, page('Der Himmel über Berlin, So 8.11. um 14.00')).status, 'MATCH');
});

test('a different time on the same date is a mismatch', () => {
  assert.equal(matchOnSourcePage(screening, page('Wings of Desire 08.11. 16:30 Uhr')).status, 'MISMATCH');
});

test('absence is never treated as a mismatch', () => {
  assert.equal(matchOnSourcePage(screening, page('Some other film 08.11. 14:00')).status, 'NOT_FOUND');
  assert.equal(matchOnSourcePage(screening, page('Wings of Desire, coming soon')).status, 'TITLE_ONLY');
  assert.equal(matchOnSourcePage(screening, 'tiny').status, 'UNAVAILABLE');
});

test('format tags in the title do not hide a match', () => {
  const tagged = {...screening, title: 'Wings of Desire (OmeU)', alternateTitle: null};
  assert.equal(matchOnSourcePage(tagged, page('Wings of Desire 08.11. 14:00')).status, 'MATCH');
});

test('samples prefer upcoming screenings and vary the source', () => {
  const list = [
    {startDate: '2026-11-08T09:00:00Z', venueUrl: 'https://a.example/x', title: 'past'},
    {startDate: '2026-11-08T12:00:00Z', venueUrl: 'https://b.example/x', title: 'soon'},
    {startDate: '2026-11-08T12:30:00Z', venueUrl: 'https://b.example/y', title: 'same host'},
    {startDate: '2026-11-08T13:00:00Z', venueUrl: 'https://c.example/x', title: 'other'},
    {startDate: '2026-11-08T14:00:00Z', venueUrl: null, title: 'no source'},
  ];
  assert.deepEqual(chooseSample(list, 5, NOW).map(s => s.title), ['soon', 'other']);
});

test('sources that answered before are tried first', () => {
  const list = [
    {startDate: '2026-11-08T12:00:00Z', venueUrl: 'https://blocked.example/x', title: 'blocked'},
    {startDate: '2026-11-08T13:00:00Z', venueUrl: 'https://useful.example/x', title: 'useful'},
  ];
  const stats = {'blocked.example': {attempts: 4, useful: 0}, 'useful.example': {attempts: 4, useful: 4}};
  assert.deepEqual(chooseSample(list, 1, NOW, stats).map(s => s.title), ['useful']);
});

test('a weekday or "heute" can identify the date on a source page', () => {
  assert.equal(matchOnSourcePage(screening, page('Sonntag Wings of Desire 14:00 Uhr')).status, 'MATCH');
  assert.equal(matchOnSourcePage(screening, page('Heute Wings of Desire 14:00 Uhr'), new Date('2026-11-08T10:00:00Z')).status, 'MATCH');
  assert.equal(matchOnSourcePage(screening, page('Heute Wings of Desire 14:00 Uhr'), new Date('2026-11-05T10:00:00Z')).status, 'TIME_ONLY');
});

test('verdicts never overstate what was checked', () => {
  assert.equal(summarizeVerification([]).verdict, 'NOT_VERIFIED');
  assert.equal(summarizeVerification([{status: 'UNAVAILABLE'}, {status: 'NOT_FOUND'}]).verdict, 'INCONCLUSIVE');
  assert.equal(summarizeVerification([{status: 'MATCH'}, {status: 'NOT_FOUND'}]).verdict, 'PARTIALLY_VERIFIED');
  assert.equal(summarizeVerification([{status: 'MATCH'}, {status: 'MISMATCH'}]).verdict, 'MISMATCHES_FOUND');
});
