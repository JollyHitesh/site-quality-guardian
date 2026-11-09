// What a journey's automation log can prove: counts and timings of what the browser did.
// Nothing here estimates what a person would feel, or how long a person would take.
import {stateKeyOf} from './explorer.mjs';

const RECOVERY = /\b(clear|reset|remove|back|undo|show all|all films|all movies|view all|try again|home|start over|l(?:ö|oe)schen|zur(?:ü|ue)ck|zur(?:ü|ue)cksetzen|alle anzeigen|startseite)\b/i;

/** Controls that would let a visitor out of the current state. */
export function recoveryControls(observation) {
  return observation.controls.filter(c => !c.covered && c.name && RECOVERY.test(c.name)).map(c => c.name.slice(0, 40)).slice(0, 6);
}

/** Moving to a different page is not an empty result, so only an in-place loss counts. */
export function isEmptyState(observation, before) {
  const samePage = !!before && new URL(before.url).pathname === new URL(observation.url).pathname;
  return observation.emptyMessage || (samePage && before.listing.count > 0 && observation.listing.count === 0);
}

/** Starts recording which parts of the page change after the next action. */
export async function watchFeedback(page, css) {
  await page.evaluate(selector => {
    const control = document.querySelector(selector);
    const changed = new Set();
    const removed = new Set();
    const observer = new MutationObserver(list => {
      for (const m of list) {
        if (control && control.contains(m.target)) continue;
        if (m.type === 'characterData') { if (m.target.parentElement) changed.add(m.target.parentElement); continue; }
        m.addedNodes.forEach(n => { const el = n.nodeType === 1 ? n : n.parentElement; if (el) changed.add(el); });
        if (m.removedNodes.length && m.target.nodeType === 1) removed.add(m.target);
      }
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true});
    window.__guardianFeedback = {changed, removed, observer};
  }, css).catch(() => {});
}

/** Reports whether what changed is where the visitor can see it. Null after a navigation. */
export async function readFeedback(page) {
  return page.evaluate(() => {
    const watch = window.__guardianFeedback;
    if (!watch) return null;
    watch.observer.disconnect();
    delete window.__guardianFeedback;
    let inViewport = 0, offScreen = 0, status = false;
    const tally = el => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      if (el.closest('[role=status],[role=alert],[role=log],[aria-live]:not([aria-live=off])')) status = true;
      if (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) inViewport++;
      else offScreen++;
    };
    for (const el of watch.changed) if ((el.innerText || '').trim() && el.getBoundingClientRect().height >= 2) tally(el);
    for (const el of watch.removed) if (!watch.changed.has(el)) tally(el); // content taken away is also a visible change
    return {inViewport, offScreen, status, liveRegionPresent: !!document.querySelector('[role=status],[role=alert],[role=log],[aria-live]:not([aria-live=off])')};
  }).catch(() => null);
}

/** Turns one executed action into a fact record for the journey. */
export function describeStep({id, control, key, result, before, after, feedback}) {
  const empty = after ? isEmptyState(after, before) : false;
  const mainControls = after ? after.controls.filter(c => c.region === 'main' && c.classification.allowed).length : null;
  return {
    actionId: id, control: String(control.name || control.placeholder || key).slice(0, 70), kind: control.classification.kind, key, ok: !!result.ok && !!after,
    fromState: before ? stateKeyOf(before) : null, toState: after ? stateKeyOf(after) : null,
    fromUrl: before ? new URL(before.url).pathname : null, toUrl: after ? new URL(after.url).pathname : null,
    changed: result.changed ?? null, navigated: !!result.navigated, automationMs: result.ms ?? null, responseMs: result.responseMs ?? null,
    feedback: result.navigated ? 'navigated' : !feedback ? 'unknown' : feedback.inViewport > 0 ? 'in-viewport' : feedback.offScreen > 0 ? 'off-screen' : 'none',
    statusAnnounced: !!feedback?.status, liveRegionPresent: !!feedback?.liveRegionPresent,
    itemsBefore: before?.listing.count ?? null, itemsAfter: after?.listing.count ?? null, listingChanged: !!after && before?.listing.count !== after.listing.count,
    empty, recovery: after && empty ? recoveryControls(after) : [],
    mainControls, textLength: after?.textLength ?? null, expanded: after?.expanded?.length ?? 0, dialogOpen: !!after?.dialogOpen,
  };
}

function shortestPath(edges, from, to) {
  if (from === to) return null; // an in-place update has no route to compare
  const next = new Map();
  for (const e of edges) { if (!next.has(e.from)) next.set(e.from, new Set()); next.get(e.from).add(e.to); }
  const seen = new Set([from]);
  let frontier = [from];
  for (let depth = 1; frontier.length; depth++) {
    const following = [];
    for (const state of frontier) {
      for (const target of next.get(state) || []) {
        if (target === to) return depth;
        if (!seen.has(target)) { seen.add(target); following.push(target); }
      }
    }
    frontier = following;
  }
  return null;
}

/** A step that only hands the visitor on to the next step, with little else to offer. */
export function isInterstitial(step, isLast) {
  return !isLast && step.navigated && !step.itemsAfter && step.mainControls !== null && step.mainControls <= 2 && (step.textLength ?? 9999) < 1200;
}

/**
 * Observable path quality. Every number is a count or timing of the automated run.
 * `excessOverShortest` needs the state graph to contain a route between the same two states.
 */
export function computeJourneyMetrics(steps, {startState, edges = []}) {
  const executed = steps.filter(s => s.ok);
  const sequence = [startState, ...executed.map(s => s.toState)];
  let backtracks = 0;
  const seen = new Set();
  sequence.forEach((state, i) => {
    if (seen.has(state) && sequence[i - 1] !== state) backtracks++;
    seen.add(state);
  });
  // Navigation inside a loop got the visitor nowhere: they ended up where they had been.
  const wasted = new Set();
  sequence.forEach((state, i) => {
    const earlier = sequence.indexOf(state);
    if (earlier < i - 1) for (let n = earlier; n < i; n++) wasted.add(n);
  });
  const uses = {};
  for (const s of executed) { const k = `${s.fromState}|${s.key}`; uses[k] = (uses[k] || 0) + 1; }
  const deadEnds = executed.filter(s => (s.changed === false && !s.navigated) || s.empty);
  const contentSteps = executed.filter(s => !s.navigated && s.feedback !== 'unknown' && s.changed !== false);
  const finalState = sequence.at(-1);
  const shortestKnown = executed.length && startState ? shortestPath(edges, startState, finalState) : null;
  const firstResponse = executed.map(s => s.responseMs).filter(Number.isFinite);
  return {
    actionCount: executed.length,
    attemptedActions: steps.length,
    automationElapsedMs: executed.reduce((n, s) => n + (s.automationMs || 0), 0),
    medianResponseMs: firstResponse.length ? [...firstResponse].sort((a, b) => a - b)[Math.floor(firstResponse.length / 2)] : null,
    uniqueStates: new Set(sequence).size,
    navigations: executed.filter(s => s.navigated).length,
    backtracks,
    repeatedActions: Object.values(uses).reduce((n, count) => n + Math.max(0, count - 1), 0),
    unnecessaryNavigations: executed.filter((s, i) => s.navigated && wasted.has(i)).length,
    deadEnds: deadEnds.length,
    deadEndsWithoutRecovery: deadEnds.filter(s => s.empty ? !s.recovery.length : true).length,
    resultsInViewport: contentSteps.filter(s => s.feedback === 'in-viewport').length,
    resultsOffScreen: contentSteps.filter(s => s.feedback === 'off-screen').length,
    actionsWithoutVisibleFeedback: contentSteps.filter(s => s.feedback === 'none' && s.expanded === 0 && !s.dialogOpen).length,
    interstitialSteps: executed.filter((s, i) => isInterstitial(s, i === executed.length - 1)).length,
    shortestKnownActions: shortestKnown,
    excessOverShortest: shortestKnown === null ? null : Math.max(0, executed.length - shortestKnown),
  };
}
