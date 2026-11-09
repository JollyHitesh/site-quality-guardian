// What the UX auditor carries between runs. Repetition is not evidence: an expert hypothesis does
// not gain confidence by being suggested again, and a resolved one needs something new to return.
import crypto from 'node:crypto';
import {cleanText} from './security.mjs';
import {EXPERT_BATCHES, CRITERIA} from './ux-framework.mjs';

const LIMITS = {issues: 300, journeys: 40, scores: 40, path: 12, runsPerJourney: 12, proposed: 6, signatures: 60};
const RESOLVE_AFTER_MISSES = 2;

export function emptyUxMemory() {
  return {issues: {}, journeys: {}, proposed: [], scoreHistory: [], signatures: {}, stablePages: [], coverage: {templates: {}, criteria: {}, keyboard: {}}};
}

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const count = v => (Number.isFinite(v) && v >= 0 ? Math.min(v, 1e6) : 0);
const texts = (v, n, max) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, n).map(x => cleanText(x, max)) : []);
const counts = v => Object.fromEntries(Object.entries(isObject(v) ? v : {}).slice(0, 400).map(([k, n]) => [k.slice(0, 120), count(n)]));
const score = v => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

function sanitizeIssue(i) {
  if (!isObject(i)) return null;
  return {
    title: cleanText(i.title, 160), criterion: cleanText(i.criterion, 24), provenance: i.provenance === 'expert' ? 'expert' : 'measured', class: cleanText(i.class, 24), kind: cleanText(i.kind, 40),
    state: ['open', 'resolved'].includes(i.state) ? i.state : 'open', resolution: cleanText(i.resolution, 40), firstSeen: cleanText(i.firstSeen, 30), lastSeen: cleanText(i.lastSeen, 30), resolvedAt: i.resolvedAt ? cleanText(i.resolvedAt, 30) : null,
    seenRuns: count(i.seenRuns), misses: count(i.misses), regressions: count(i.regressions), templates: texts(i.templates, 8, 80), devices: texts(i.devices, 8, 30), signature: cleanText(i.signature, 16),
  };
}

function sanitizeCheck(c) {
  if (!isObject(c)) return null;
  return {kind: cleanText(c.kind, 40), value: cleanText(c.value, 100), alsoRequire: cleanText(c.alsoRequire, 30) || 'none'};
}

export function sanitizeUxMemory(raw) {
  const memory = emptyUxMemory();
  if (!isObject(raw)) return memory;
  for (const [key, value] of Object.entries(isObject(raw.issues) ? raw.issues : {}).slice(-LIMITS.issues)) {
    const clean = sanitizeIssue(value);
    if (clean) memory.issues[key.slice(0, 60)] = clean;
  }
  for (const [key, j] of Object.entries(isObject(raw.journeys) ? raw.journeys : {}).slice(-LIMITS.journeys)) {
    if (!isObject(j)) continue;
    memory.journeys[key.slice(0, 80)] = {title: cleanText(j.title, 140), path: texts(j.path, LIMITS.path, 100), runs: (Array.isArray(j.runs) ? j.runs : []).filter(isObject).slice(-LIMITS.runsPerJourney).map(r => ({at: cleanText(r.at, 30), outcome: cleanText(r.outcome, 12), actions: count(r.actions), backtracks: count(r.backtracks), automationElapsedMs: count(r.automationElapsedMs)}))};
  }
  memory.proposed = (Array.isArray(raw.proposed) ? raw.proposed : []).filter(isObject).slice(0, LIMITS.proposed).map(p => ({id: cleanText(p.id, 40), title: cleanText(p.title, 140), why: cleanText(p.why, 240), persona: cleanText(p.persona, 120), estimatedTurns: count(p.estimatedTurns), coreTask: !!p.coreTask, targetActions: count(p.targetActions), successCheck: sanitizeCheck(p.successCheck)}));
  memory.scoreHistory = (Array.isArray(raw.scoreHistory) ? raw.scoreHistory : []).filter(isObject).slice(-LIMITS.scores).map(h => ({at: cleanText(h.at, 30), rubric: cleanText(h.rubric, 16), journeySet: cleanText(h.journeySet, 16), pages: texts(h.pages, 12, 80), categories: Object.fromEntries(Object.entries(isObject(h.categories) ? h.categories : {}).slice(0, 8).map(([k, c]) => [k.slice(0, 30), {score: score(c?.score), coverage: Number(c?.coverage) || 0}]))}));
  for (const [key, value] of Object.entries(isObject(raw.signatures) ? raw.signatures : {}).slice(-LIMITS.signatures)) memory.signatures[key.slice(0, 80)] = cleanText(value, 16);
  memory.stablePages = texts(raw.stablePages, 12, 80);
  memory.coverage = {templates: counts(raw.coverage?.templates), criteria: counts(raw.coverage?.criteria), keyboard: counts(raw.coverage?.keyboard)};
  return memory;
}

/** A fingerprint of a page's structure, ignoring its changing content. */
export function designSignature(parts) {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
}

const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 3));

function similar(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(w => y.has(w)).length;
  return shared / new Set([...x, ...y]).size >= 0.5;
}

function matchKnown(issue, memory) {
  if (memory.issues[issue.id]) return issue.id;
  if (issue.provenance !== 'expert') return null;
  if (issue.priorId && memory.issues[issue.priorId]?.provenance === 'expert' && memory.issues[issue.priorId].criterion === issue.criterion) return issue.priorId;
  return Object.entries(memory.issues).find(([, k]) => k.provenance === 'expert' && k.criterion === issue.criterion && k.templates.some(t => issue.templates.includes(t)) && similar(k.title, issue.title))?.[0] || null;
}

const SUPPRESSING = {rejected: 'rejected-by-owner', 'accepted-risk': 'accepted-by-owner', fixed: 'marked-fixed-by-owner'};

/**
 * Labels this run's issues using their history and decides which may be shown. A measurement is
 * always shown. An expert claim that was resolved returns only with new evidence: a changed
 * design, or a failing measurement behind the same criterion.
 */
export function reconcileIssues(issues, memory, {signatures = {}, decisions = {}, failingCriteria = new Set()} = {}) {
  const kept = [], suppressed = [];
  for (const issue of issues) {
    const knownId = matchKnown(issue, memory);
    if (knownId) issue.id = knownId;
    const known = knownId ? memory.issues[knownId] : null;
    const decision = decisions[issue.id]?.decision;
    const signature = signatures[issue.templates[0]] || '';
    issue.signature = signature;
    const designChanged = !!(known?.signature && signature && known.signature !== signature);
    const corroborated = failingCriteria.has(issue.criterion);
    if (SUPPRESSING[decision] && !designChanged) { suppressed.push({id: issue.id, title: issue.title, reason: SUPPRESSING[decision]}); continue; }
    if (issue.provenance === 'expert' && known?.state === 'resolved' && !designChanged && !corroborated) { suppressed.push({id: issue.id, title: issue.title, reason: 'resolved-with-no-new-evidence'}); continue; }
    issue.trend = !known ? 'NEW' : known.state === 'resolved' ? 'REGRESSED' : 'RECURRING';
    issue.firstSeen = known?.firstSeen || null;
    issue.occurrences = (known?.seenRuns || 0) + 1;
    if (decision === 'validated') { issue.validated = true; issue.confidence = 'high'; issue.validationNote = cleanText(decisions[issue.id].note, 200); }
    if (decision === 'needs-research') issue.class = 'research-needed';
    kept.push(issue);
  }
  return {kept, suppressed};
}

/** A prior list for de-duplication only. The prompt states that it is not evidence. */
export function priorHypotheses(memory, limit = 12) {
  return Object.entries(memory.issues).filter(([, k]) => k.provenance === 'expert' && k.state === 'open').slice(-limit).map(([id, k]) => ({id, criterion: k.criterion, title: k.title}));
}

/**
 * Earlier runs' pages are kept so scores stay comparable, leaving one slot to rotate. That slot
 * goes to pages never reviewed first, then pages with open problems, then the least reviewed.
 */
export function chooseUxPages(candidates, memory, limit) {
  const open = new Set(Object.values(memory.issues).filter(i => i.state === 'open').flatMap(i => i.templates));
  const rank = c => (memory.coverage.templates[c.template] ? 0 : 1000) + (open.has(c.template) ? 100 : 0) - (memory.coverage.templates[c.template] || 0);
  const stable = memory.stablePages.flatMap(t => candidates.filter(c => c.template === t)).slice(0, Math.max(0, limit - 1));
  const rest = candidates.filter(c => !stable.includes(c)).sort((a, b) => rank(b) - rank(a));
  return [...stable, ...rest].slice(0, limit);
}

/** Controls that failed before are re-tested first, then custom controls, then the untested. */
export function orderKeyboardControls(controls, keyOf, memory, limit, taskControls = new Set()) {
  const failedBefore = new Set(Object.values(memory.issues).filter(i => i.state === 'open' && i.kind?.startsWith('kb-')).map(i => i.title));
  const rank = c => {
    const name = String(c.name);
    let score = 0;
    if ([...failedBefore].some(t => name && t.includes(name))) score += 1000;
    if (!['button', 'input', 'select', 'summary'].includes(c.tag)) score += 200;
    if (taskControls.has(keyOf(c))) score += 150; // visitors depend on these for the main tasks
    if (c.expanded !== null && c.expanded !== undefined) score += 100;
    if (c.pressed !== null && c.pressed !== undefined) score += 60;
    if (c.region === 'main') score += 30;
    if (c.region === 'footer') score -= 100;
    return score - (memory.coverage.keyboard[keyOf(c)] || 0) * 5;
  };
  return [...controls].sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

/** With fewer calls than batches, the least-assessed criteria are reviewed first. */
export function orderBatches(memory, available) {
  const covered = batch => {
    const list = CRITERIA.filter(c => c.batch === batch);
    return list.reduce((n, c) => n + (memory.coverage.criteria[c.id] || 0), 0) / list.length;
  };
  return [...EXPERT_BATCHES].sort((a, b) => covered(a) - covered(b)).slice(0, available);
}

/**
 * Records a completed run. An open problem counts as absent only if this run actually assessed
 * the same criterion on the same kind of page and device.
 */
export function learnUx(memory, ux, at) {
  const present = new Set();
  const assessed = new Set(ux.assessments.filter(a => a.verdict !== 'not-assessed').map(a => a.criterion));
  for (const issue of ux.issues) {
    present.add(issue.id);
    const known = memory.issues[issue.id];
    memory.issues[issue.id] = {
      title: cleanText(issue.title, 160), criterion: issue.criterion, provenance: issue.provenance, class: issue.class, kind: issue.kind, state: 'open', resolution: '',
      firstSeen: known?.firstSeen || at, lastSeen: at, resolvedAt: null, seenRuns: (known?.seenRuns || 0) + 1, misses: 0, regressions: (known?.regressions || 0) + (issue.trend === 'REGRESSED' ? 1 : 0),
      templates: issue.templates.slice(0, 8), devices: issue.devices.slice(0, 8), signature: issue.signature || known?.signature || '',
    };
  }
  for (const issue of ux.suppressed.filter(s => memory.issues[s.id])) memory.issues[issue.id].lastSeen = at;
  const resolved = [];
  for (const [id, known] of Object.entries(memory.issues)) {
    if (present.has(id) || known.state !== 'open' || !assessed.has(known.criterion)) continue;
    if (known.templates.length && !known.templates.some(t => ux.coverage.templates.includes(t) || t.startsWith('('))) continue;
    if (known.devices.length && !known.devices.some(d => ux.coverage.devices.includes(d))) continue;
    known.misses++;
    if (known.misses >= RESOLVE_AFTER_MISSES) {
      known.state = 'resolved';
      known.resolvedAt = at;
      known.resolution = known.provenance === 'expert' ? 'not-raised-again' : 'measurement-passed';
      resolved.push(known.title);
    }
  }
  for (const [template, signature] of Object.entries(ux.signatures)) memory.signatures[template.slice(0, 80)] = signature;
  for (const template of ux.coverage.templates) memory.coverage.templates[template] = (memory.coverage.templates[template] || 0) + 1;
  for (const criterion of assessed) memory.coverage.criteria[criterion] = (memory.coverage.criteria[criterion] || 0) + 1;
  for (const key of ux.coverage.keyboardControls) memory.coverage.keyboard[key.slice(0, 120)] = (memory.coverage.keyboard[key.slice(0, 120)] || 0) + 1;
  for (const j of ux.journeys) {
    const entry = memory.journeys[j.key] || {title: j.title, path: [], runs: []};
    entry.title = j.title;
    if (j.outcome === 'SUCCESS' && j.path?.length) entry.path = j.path.slice(0, LIMITS.path);
    if (j.replayFailed) entry.path = j.outcome === 'SUCCESS' ? j.path.slice(0, LIMITS.path) : [];
    entry.runs = [...entry.runs, {at, outcome: j.outcome, actions: j.metrics.actionCount, backtracks: j.metrics.backtracks, automationElapsedMs: j.metrics.automationElapsedMs}].slice(-LIMITS.runsPerJourney);
    memory.journeys[j.key] = entry;
  }
  if (!memory.stablePages.length) memory.stablePages = (ux.pagePicks || []).slice(0, Math.max(1, (ux.pagePicks || []).length - 1));
  if (ux.proposedJourneys?.length) memory.proposed = ux.proposedJourneys.slice(0, LIMITS.proposed);
  memory.scoreHistory = [...memory.scoreHistory, {at, rubric: ux.rubricVersion, journeySet: ux.journeySet, pages: ux.coverage.templates.slice(0, 12), categories: Object.fromEntries(Object.entries(ux.scorecard).map(([id, c]) => [id, {score: c.score, coverage: c.coverage}]))}].slice(-LIMITS.scores);
  const entries = Object.entries(memory.issues).sort(([, a], [, b]) => (a.state === b.state ? a.lastSeen.localeCompare(b.lastSeen) : a.state === 'resolved' ? -1 : 1));
  memory.issues = Object.fromEntries(entries.slice(-LIMITS.issues));
  return resolved;
}
