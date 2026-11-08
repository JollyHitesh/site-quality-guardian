import test from 'node:test';
import assert from 'node:assert/strict';
import {nextScreeningPlausibility} from '../src/showtimes.mjs';
test('Berlin local time used instead of visitor timezone',()=>{
 const now=new Date('2026-11-08T12:00:00Z'); // 13:00 Berlin
 assert.equal(nextScreeningPlausibility('Next: Sun 8 Nov · 11:00 at Kino',now).status,'PAST_NEXT_SHOWTIME');
 assert.equal(nextScreeningPlausibility('Next: Sun 8 Nov · 15:00 at Kino',now).status,'PLAUSIBLE');
});
test('year rollover',()=>{
 const now=new Date('2026-12-31T22:00:00Z');
 assert.equal(nextScreeningPlausibility('Next: Fri 1 Jan · 12:00 at Kino',now).status,'PLAUSIBLE');
});
test('no assumptions for unknown format',()=>{
 assert.equal(nextScreeningPlausibility('Upcoming screenings',new Date()).status,'NOT_DETECTED');
});
