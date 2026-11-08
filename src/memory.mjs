// What the agent carries between runs. The file comes from a shared branch and holds text
// that originated on the audited website, so it is validated and bounded on every load.
import fs from 'node:fs';
import path from 'node:path';
import {cleanText} from './security.mjs';
import {redactDeep} from './redact.mjs';

export const SCHEMA_VERSION = 2;
const LIMITS = {history: 60, controls: 1500, paths: 800, findings: 500, baselines: 250, lessons: 30, bits: 20};
const RESOLVE_AFTER_MISSES = 2;

export function emptyMemory(site = '') {
  return {schemaVersion: SCHEMA_VERSION, site, runs: 0, lastRun: null, history: [], coverage: {controls: {}, paths: {}}, states: {}, baselines: {}, findings: {}, lessons: [], sources: {}};
}

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const count = v => (Number.isFinite(v) && v >= 0 ? Math.min(v, 1e7) : 0);
const numberMap = v => Object.fromEntries(Object.entries(isObject(v) ? v : {}).map(([k, n]) => [k.slice(0, 180), count(n)]));
const take = (entries, n) => Object.fromEntries(entries.slice(-n));

function sanitizeFinding(f) {
  if (!isObject(f)) return null;
  return {
    title: cleanText(f.title, 160), kind: cleanText(f.kind, 60), severity: /^P[0-3]$/.test(f.severity) ? f.severity : 'P3',
    firstSeen: cleanText(f.firstSeen, 30), lastSeen: cleanText(f.lastSeen, 30), resolvedAt: f.resolvedAt ? cleanText(f.resolvedAt, 30) : null,
    state: ['open', 'resolved'].includes(f.state) ? f.state : 'open', scope: cleanText(f.scope, 180),
    seenRuns: count(f.seenRuns), misses: count(f.misses), regressions: count(f.regressions), transients: count(f.transients),
    bits: typeof f.bits === 'string' ? f.bits.replace(/[^01]/g, '').slice(-LIMITS.bits) : '',
    pages: Array.isArray(f.pages) ? f.pages.slice(0, 12).map(p => cleanText(p, 80)) : [],
    devices: Array.isArray(f.devices) ? f.devices.slice(0, 8).map(d => cleanText(d, 30)) : [],
  };
}

function sanitizeBaseline(b) {
  if (!isObject(b)) return null;
  const nums = v => (Array.isArray(v) ? v.filter(Number.isFinite).slice(-12) : []);
  return {itemCount: nums(b.itemCount), textLength: nums(b.textLength), controlCount: nums(b.controlCount), headings: numberMap(b.headings)};
}

export function sanitizeMemory(raw, site = '') {
  const memory = emptyMemory(site);
  if (!isObject(raw)) return memory;
  memory.runs = count(raw.runs);
  memory.lastRun = raw.lastRun ? cleanText(raw.lastRun, 30) : null;
  memory.history = (Array.isArray(raw.history) ? raw.history : []).filter(isObject).slice(-LIMITS.history).map(r => ({
    at: cleanText(r.at, 30), mode: cleanText(r.mode, 15), status: cleanText(r.status, 30), actions: count(r.actions), states: count(r.states),
    open: isObject(r.open) ? numberMap(r.open) : {}, newFindings: count(r.newFindings), regressions: count(r.regressions),
    transient: count(r.transient), showtimes: cleanText(r.showtimes, 30), aiCalls: count(r.aiCalls), lcpMs: count(r.lcpMs), goals: isObject(r.goals) ? numberMap(r.goals) : {},
  }));
  if (raw.schemaVersion === 1 || raw.actionCounts) {
    memory.coverage.controls = Object.fromEntries(Object.entries(numberMap(raw.actionCounts)).map(([k, v]) => [k.replace(/^([^:]+):(click|view|search|open_detail):/, '$1|button|'), v]));
    memory.coverage.paths = numberMap(raw.visitedPaths);
    return memory; // The old format's findings cannot support regression tracking, so they restart.
  }
  memory.coverage.controls = numberMap(raw.coverage?.controls);
  memory.coverage.paths = numberMap(raw.coverage?.paths);
  memory.states = numberMap(raw.states);
  for (const [key, b] of Object.entries(isObject(raw.baselines) ? raw.baselines : {})) {
    const clean = sanitizeBaseline(b);
    if (clean) memory.baselines[key.slice(0, 120)] = clean;
  }
  for (const [key, f] of Object.entries(isObject(raw.findings) ? raw.findings : {})) {
    const clean = sanitizeFinding(f);
    if (clean) memory.findings[key.slice(0, 80)] = clean;
  }
  for (const [host, stat] of Object.entries(isObject(raw.sources) ? raw.sources : {})) {
    if (isObject(stat)) memory.sources[host.slice(0, 120)] = {attempts: count(stat.attempts), useful: count(stat.useful)};
  }
  memory.lessons = (Array.isArray(raw.lessons) ? raw.lessons : []).filter(isObject).slice(-LIMITS.lessons).map(l => ({text: cleanText(l.text, 200), at: cleanText(l.at, 30)}));
  return memory;
}

/** A damaged file is kept for inspection rather than quietly losing the agent's history. */
export function loadMemory(file, site = '') {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {memory: emptyMemory(site), warning: null}; }
  try {
    return {memory: sanitizeMemory(JSON.parse(text), site), warning: null};
  } catch (e) {
    const backup = `${file}.corrupt`;
    try { fs.copyFileSync(file, backup); } catch { /* the warning below still reports it */ }
    return {memory: emptyMemory(site), warning: `Memory file was unreadable and restarted empty; saved a copy as ${path.basename(backup)}`};
  }
}

export function saveMemoryFile(memory, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(redactDeep(memory), null, 1)}\n`);
  fs.renameSync(temporary, file);
}

const bump = (map, key, by = 1) => { map[key.slice(0, 180)] = (map[key.slice(0, 180)] || 0) + by; };

export function hotTemplates(memory) {
  return [...new Set(Object.values(memory.findings).filter(f => f.state === 'open').flatMap(f => f.pages))];
}

/**
 * Labels this run's findings using their history. The label separates what is new from
 * what returned after a fix and from what comes and goes.
 */
export function annotateFindings(findings, memory) {
  for (const f of findings) {
    const known = memory.findings[f.fingerprint];
    f.occurrences = (known?.seenRuns || 0) + 1;
    f.firstSeen = known?.firstSeen || null;
    if (f.status === 'TRANSIENT') { f.trend = 'TRANSIENT'; continue; }
    if (!known) { f.trend = 'NEW'; continue; }
    const recent = `${known.bits}1`.slice(-10);
    const flips = [...recent].filter((bit, i) => i > 0 && bit !== recent[i - 1]).length;
    if (known.state === 'resolved') f.trend = 'REGRESSED';
    else if (flips >= 3) f.trend = 'FLAKY';
    else f.trend = 'RECURRING';
  }
}

const NEVER_RESOLVED_BY_ABSENCE = new Set(['goal-failed', 'goal-blocked', 'search-no-results', 'filter-empty-unexplained']);
const NEEDS_CHECK_RUN = new Set(['state-lost-on-reload', 'filter-order-dependent', 'filter-semantics']);
const NEEDS_SAME_TARGET = {'control-no-effect': 'controlKeys', 'control-obscured': 'controlKeys', 'source-link-broken': 'sources', 'showtime-source-mismatch': 'sources'};

/**
 * A finding can only be "gone" if this run repeated the check that found it. Sampling and
 * exploration vary, so simply not seeing a finding again proves nothing.
 */
export function wasCovered(known, coverage) {
  if (coverage.partial) return false;
  if (known.devices.length && !known.devices.some(d => coverage.devices.includes(d))) return false;
  if (NEVER_RESOLVED_BY_ABSENCE.has(known.kind)) return false;
  if (NEEDS_CHECK_RUN.has(known.kind)) return coverage.checksRun.includes(known.kind);
  if (NEEDS_SAME_TARGET[known.kind]) return coverage[NEEDS_SAME_TARGET[known.kind]].includes(known.scope);
  const checked = known.kind.startsWith('accessibility-') ? coverage.a11yTemplates : coverage.inspectedTemplates;
  return !known.pages.length || known.pages.some(p => checked.includes(p));
}

export function learnFromRun(memory, report, {stateMetrics = {}, lessons = []} = {}) {
  const at = report.finishedAt;
  const seen = new Set();
  const coverage = {
    inspectedTemplates: report.coverage.inspectedTemplates || [], a11yTemplates: report.coverage.a11yTemplates || [], checksRun: report.coverage.checksRun || [],
    controlKeys: report.coverage.controlKeys || [], sources: report.coverage.sources || [], devices: report.config.devices,
    partial: report.status !== 'COMPLETED' && report.status !== 'COMPLETED_WITH_LIMITATIONS',
  };
  const opened = {P0: 0, P1: 0, P2: 0, P3: 0};
  let regressions = 0, newFindings = 0, transient = 0;

  for (const f of report.findings) {
    if (f.status === 'TRANSIENT') {
      transient++;
      if (memory.findings[f.fingerprint]) memory.findings[f.fingerprint].transients++;
      continue;
    }
    seen.add(f.fingerprint);
    opened[f.severity]++;
    if (f.trend === 'REGRESSED') regressions++;
    if (f.trend === 'NEW') newFindings++;
    const known = memory.findings[f.fingerprint] || {firstSeen: at, seenRuns: 0, misses: 0, regressions: 0, transients: 0, bits: '', state: 'open', resolvedAt: null};
    memory.findings[f.fingerprint] = {
      ...known, title: cleanText(f.title, 160), kind: f.kind, severity: f.severity, lastSeen: at, seenRuns: known.seenRuns + 1, misses: 0,
      regressions: known.regressions + (f.trend === 'REGRESSED' ? 1 : 0), state: 'open', resolvedAt: null,
      bits: `${known.bits}1`.slice(-LIMITS.bits), pages: f.pages.slice(0, 12), devices: f.devices.slice(0, 8), scope: cleanText(f.scope, 180),
    };
  }
  report.resolvedThisRun = [];
  for (const [fingerprint, known] of Object.entries(memory.findings)) {
    if (seen.has(fingerprint) || known.state !== 'open' || !wasCovered(known, coverage)) continue;
    known.misses++;
    known.bits = `${known.bits}0`.slice(-LIMITS.bits);
    if (known.misses >= RESOLVE_AFTER_MISSES) {
      known.state = 'resolved';
      known.resolvedAt = at;
      report.resolvedThisRun.push(known.title);
    }
  }

  for (const action of report.actions) {
    if (action.outcome !== 'PASS') continue;
    if (action.controlKey) bump(memory.coverage.controls, `${action.device}|${action.controlKey}`);
  }
  for (const p of report.visitedPaths) bump(memory.coverage.paths, p);
  for (const key of report.coverage.states || []) bump(memory.states, key);
  for (const [key, baseline] of Object.entries(stateMetrics)) memory.baselines[key.slice(0, 120)] = baseline;
  for (const text of lessons) memory.lessons.push({text: cleanText(text, 200), at});
  for (const result of report.showtimes?.results || []) {
    let host;
    try { host = new URL(result.source).hostname; } catch { continue; }
    const stat = memory.sources[host] || {attempts: 0, useful: 0};
    stat.attempts++;
    if (['MATCH', 'LIKELY_MATCH', 'MISMATCH'].includes(result.status)) stat.useful++;
    memory.sources[host] = stat;
  }

  memory.runs++;
  memory.lastRun = at;
  memory.history.push({
    at, mode: report.mode, status: report.status, actions: report.actions.length, states: report.coverage.stateCount || 0, open: opened, newFindings, regressions, transient,
    showtimes: report.showtimes?.summary?.verdict || 'NOT_VERIFIED', aiCalls: report.ai?.calls || 0, lcpMs: report.performance?.[0]?.metrics?.lcpMs || 0, goals: report.goalsSummary || {},
  });
  prune(memory);
}

/** A run that stopped early cannot say what is normal. It only leaves a history line. */
export function recordIncompleteRun(memory, report) {
  memory.history.push({at: report.finishedAt, mode: report.mode, status: report.status, actions: report.actions.length, states: 0, open: {}, newFindings: 0, regressions: 0, transient: 0, showtimes: 'NOT_VERIFIED', aiCalls: report.ai?.calls || 0, lcpMs: 0});
  memory.history = memory.history.slice(-LIMITS.history);
}

function prune(memory) {
  memory.history = memory.history.slice(-LIMITS.history);
  memory.coverage.controls = take(Object.entries(memory.coverage.controls).sort((a, b) => a[1] - b[1]), LIMITS.controls);
  memory.coverage.paths = take(Object.entries(memory.coverage.paths), LIMITS.paths);
  memory.baselines = take(Object.entries(memory.baselines), LIMITS.baselines);
  memory.states = take(Object.entries(memory.states), LIMITS.baselines);
  const byAge = Object.entries(memory.findings).sort(([, a], [, b]) => (a.state === b.state ? a.lastSeen.localeCompare(b.lastSeen) : a.state === 'resolved' ? -1 : 1));
  memory.findings = take(byAge, LIMITS.findings);
  memory.lessons = memory.lessons.slice(-LIMITS.lessons);
}
