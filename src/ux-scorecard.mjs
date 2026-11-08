// Turns per-criterion verdicts into category scores. The arithmetic is fixed and published, and a
// category with too little evidence gets no number at all.
import {CATEGORIES, CRITERIA, VERDICT_VALUE} from './ux-framework.mjs';

const MIN_ASSESSED = 2;

function scoreOf(rows) {
  const scored = rows.filter(r => r.verdict in VERDICT_VALUE);
  const total = scored.reduce((n, r) => n + r.weight, 0);
  if (!total) return null;
  return Math.round(100 * scored.reduce((n, r) => n + r.weight * VERDICT_VALUE[r.verdict], 0) / total);
}

/**
 * A number appears only when enough of the category's weight was assessed and at least one
 * assessed criterion was measured, so a score can never rest on expert opinion alone.
 */
export function buildScorecard(assessments, {weights = {}, minCoverage = 0.5} = {}) {
  const byId = new Map(assessments.map(a => [a.criterion, a]));
  const categories = {};
  for (const [id, label] of Object.entries(CATEGORIES)) {
    const rows = CRITERIA.filter(c => c.category === id).map(c => {
      const a = byId.get(c.id);
      return {criterion: c.id, question: c.question, method: c.method, dimension: c.dimension, weight: weights[c.id] ?? c.weight, rubric: c.rubric, verdict: a?.verdict || 'not-assessed', detail: a?.detail || 'No evidence was collected for this criterion in this run.', evidenceRefs: a?.evidenceRefs || []};
    });
    const possible = rows.reduce((n, r) => n + r.weight, 0);
    const assessed = rows.filter(r => r.verdict in VERDICT_VALUE);
    const coverage = possible ? assessed.reduce((n, r) => n + r.weight, 0) / possible : 0;
    const measuredRows = assessed.filter(r => r.method === 'measured');
    const enough = coverage >= minCoverage && assessed.length >= MIN_ASSESSED && measuredRows.length > 0;
    let reason = null;
    if (!enough) {
      if (!measuredRows.length) reason = 'No measured criterion could be assessed.';
      else if (assessed.length < MIN_ASSESSED) reason = 'Too few criteria could be assessed.';
      else reason = `Only ${Math.round(coverage * 100)}% of this category's weight was assessed. The minimum is ${Math.round(minCoverage * 100)}%.`;
    }
    categories[id] = {label, score: enough ? scoreOf(assessed) : null, measuredScore: enough ? scoreOf(measuredRows) : null, coverage: Number(coverage.toFixed(2)), reason, rows};
  }
  return categories;
}

/** Compares with the latest earlier run that used the same rubric on the same journeys. */
export function compareScores(categories, history, {rubric, journeySet, pages = []}) {
  const previous = [...history].reverse().find(h => h.rubric === rubric && h.journeySet === journeySet);
  const trend = {};
  for (const [id, c] of Object.entries(categories)) {
    const before = previous?.categories?.[id];
    const delta = (now, then) => (now == null || then == null ? null : now - then);
    trend[id] = {previousAt: previous?.at || null, score: delta(c.score, before?.score ?? null), measuredScore: delta(c.measuredScore, before?.measuredScore ?? null), history: history.filter(h => h.rubric === rubric).slice(-12).map(h => ({at: h.at, score: h.categories?.[id]?.score ?? null}))};
  }
  const before = [...(previous?.pages || [])].sort().join('|');
  return {comparable: !!previous, samePages: !!previous && before === [...pages].sort().join('|'), categories: trend};
}
