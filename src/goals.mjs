// Decides what happened on an AI visitor journey. Claude's opinion is never the verdict:
// success needs a condition, fixed before the journey began, to be true on the final page.
import {stateKeyOf} from './explorer.mjs';

export const OUTCOMES = ['SUCCESS', 'FAILURE', 'INCOMPLETE'];
export const CHECK_KINDS = ['page-path-contains', 'page-text-contains', 'listing-at-least', 'booking-link-visible', 'filter-active', 'listing-narrowed-by'];
export const ALSO_REQUIRE = ['none', 'booking-link', 'non-empty-listing'];

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function isUsableCheck(check) {
  if (!check || !CHECK_KINDS.includes(check.kind)) return false;
  if (check.alsoRequire && !ALSO_REQUIRE.includes(check.alsoRequire)) return false;
  if (check.kind === 'listing-at-least') return Number.isFinite(Number(check.value)) && Number(check.value) >= 1;
  if (check.kind === 'booking-link-visible') return true;
  return typeof check.value === 'string' && norm(check.value).length >= 4;
}

/** Booking links are observed, never followed, so a journey can end by finding one. */
export function visibleBookingLinks(observation, config) {
  const primary = new RegExp(config.primaryActionPattern, 'i');
  const prefix = config.booking?.redirectPrefix;
  return observation.controls.filter(c => {
    if (c.tag !== 'a' || !c.href) return false;
    let path;
    try { path = new URL(c.href).pathname; } catch { return false; }
    return (prefix && path.startsWith(prefix)) || primary.test(c.name);
  });
}

function mainConditionHolds(check, observation, config, context) {
  const url = new URL(observation.url);
  // For filters whose state is only visual: the named control was used and the list got shorter.
  if (check.kind === 'listing-narrowed-by') return observation.listing.count > 0 && observation.listing.count < (context.startCount ?? 0) && (context.executed || []).some(name => norm(name).includes(norm(check.value)));
  if (check.kind === 'page-path-contains') return `${url.pathname}${url.search}`.toLowerCase().includes(norm(check.value));
  if (check.kind === 'page-text-contains') return norm(observation.fullText ?? observation.text).includes(norm(check.value));
  if (check.kind === 'listing-at-least') return observation.listing.count >= Number(check.value);
  if (check.kind === 'filter-active') return observation.active.some(name => norm(name).includes(norm(check.value)));
  return visibleBookingLinks(observation, config).length > 0;
}

export function evaluateCheck(check, observation, config, context = {}) {
  if (!isUsableCheck(check) || !mainConditionHolds(check, observation, config, context)) return false;
  if (check.alsoRequire === 'booking-link') return visibleBookingLinks(observation, config).length > 0;
  if (check.alsoRequire === 'non-empty-listing') return observation.listing.count > 0;
  return true;
}

export function quoteIsOnPage(quote, observation) {
  const q = norm(quote);
  return q.length >= 4 && norm(observation.fullText ?? observation.text).includes(q);
}

export function progressOf(observation) {
  const items = observation.listing.items.slice(0, 12).map(norm).join('|');
  return `${stateKeyOf(observation)}|${observation.listing.count}|${items}`;
}

export function initialTurns(estimated, cap) {
  const value = Number.isFinite(Number(estimated)) ? Math.round(Number(estimated)) : 3;
  return Math.max(2, Math.min(value, Math.min(4, cap)));
}

/** A journey earns more turns by getting somewhere, up to a hard cap. */
export function extendTurns(allowed, turn, progressed, cap) {
  return progressed && turn + 1 >= allowed ? Math.min(allowed + 1, cap) : allowed;
}

export function classifyGoal({vacuous = false, stepsExecuted = 0, checkMet = false, claimed = null, quoteFound = false, stopReason = null}) {
  if (vacuous) return {outcome: 'INCOMPLETE', reason: 'criterion-already-met-before-journey'};
  if (stepsExecuted === 0 && !claimed) return {outcome: 'INCOMPLETE', reason: 'no-steps-executed'};
  if (checkMet && stepsExecuted > 0) return {outcome: 'SUCCESS', reason: 'success-condition-verified'};
  if (claimed === 'blocked') return quoteFound ? {outcome: 'FAILURE', reason: 'visitor-blocked-with-evidence'} : {outcome: 'INCOMPLETE', reason: 'blocked-claim-without-evidence'};
  if (claimed === 'achieved') return {outcome: 'INCOMPLETE', reason: 'success-claim-not-verified'};
  return {outcome: 'INCOMPLETE', reason: stopReason || 'turn-budget-exhausted'};
}

export function summarizeGoals(goals) {
  const counts = {total: goals.length, SUCCESS: 0, FAILURE: 0, INCOMPLETE: 0};
  for (const goal of goals) counts[goal.outcome]++;
  return counts;
}
