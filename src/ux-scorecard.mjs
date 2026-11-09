// Turns per-criterion verdicts into category scores. A score comes only from measured criteria,
// so expert opinion can never move it. Expert assessments are reported beside it, unscored.
import {CATEGORIES, CRITERIA, VERDICT_VALUE} from './ux-framework.mjs';

const MIN_ASSESSED = 2;
const assessedRow = r => r.verdict in VERDICT_VALUE;

function rowFor(criterion, assessment, weights) {
  const weight = weights[criterion.id] ?? criterion.weight;
  const base = {criterion: criterion.id, question: criterion.question, method: criterion.method, dimension: criterion.dimension, weight, rubric: criterion.rubric};
  if (!assessment) return {...base, verdict: 'not-assessed', detail: 'No evidence was collected for this criterion in this run.', evidenceRefs: [], earned: null};
  const evidenceRefs = assessment.evidenceRefs || [];
  // A verdict that cannot point at anything is not allowed to count.
  if (assessment.verdict in VERDICT_VALUE && !evidenceRefs.length) return {...base, verdict: 'not-assessed', detail: `No screenshot or action could be cited, so this was not scored. The check reported: ${assessment.detail}`, evidenceRefs: [], earned: null};
  return {...base, verdict: assessment.verdict, detail: assessment.detail, evidenceRefs, earned: assessment.verdict in VERDICT_VALUE ? weight * VERDICT_VALUE[assessment.verdict] : null};
}

/** A number appears only when enough of the category's measured weight could be assessed. */
export function buildScorecard(assessments, {weights = {}, minCoverage = 0.5} = {}) {
  const byId = new Map(assessments.map(a => [a.criterion, a]));
  const categories = {};
  for (const [id, label] of Object.entries(CATEGORIES)) {
    const all = CRITERIA.filter(c => c.category === id).map(c => rowFor(c, byId.get(c.id), weights));
    const rows = all.filter(r => r.method === 'measured');
    const assessed = rows.filter(assessedRow);
    const totalWeight = rows.reduce((n, r) => n + r.weight, 0);
    const assessedWeight = assessed.reduce((n, r) => n + r.weight, 0);
    const earned = assessed.reduce((n, r) => n + r.earned, 0);
    const coverage = totalWeight ? assessedWeight / totalWeight : 0;
    const enough = coverage >= minCoverage && assessed.length >= MIN_ASSESSED;
    let reason = null;
    if (!enough) {
      if (!assessed.length) reason = 'No measured criterion could be assessed.';
      else if (assessed.length < MIN_ASSESSED) reason = 'Too few measured criteria could be assessed.';
      else reason = `Only ${Math.round(coverage * 100)}% of this category's measured weight was assessed. The minimum is ${Math.round(minCoverage * 100)}%.`;
    }
    const expertRows = all.filter(r => r.method === 'expert');
    const count = verdict => expertRows.filter(r => r.verdict === verdict).length;
    categories[id] = {
      label, score: enough ? Math.round(100 * earned / assessedWeight) : null, coverage: Number(coverage.toFixed(2)), reason, rows,
      calculation: {earned, assessedWeight, totalWeight},
      expert: {rows: expertRows, pass: count('pass'), concern: count('concern'), fail: count('fail'), notAssessed: count('not-assessed')},
    };
  }
  return categories;
}

/** Compares with the latest earlier run that used the same rubric on the same journeys. */
export function compareScores(categories, history, {rubric, journeySet, pages = []}) {
  const previous = [...history].reverse().find(h => h.rubric === rubric && h.journeySet === journeySet);
  const trend = {};
  for (const [id, c] of Object.entries(categories)) {
    const before = previous?.categories?.[id]?.score ?? null;
    trend[id] = {previousAt: previous?.at || null, score: c.score == null || before == null ? null : c.score - before, history: history.filter(h => h.rubric === rubric).slice(-12).map(h => ({at: h.at, score: h.categories?.[id]?.score ?? null}))};
  }
  const before = [...(previous?.pages || [])].sort().join('|');
  return {comparable: !!previous, samePages: !!previous && before === [...pages].sort().join('|'), categories: trend};
}
