// The site model and the choice of what to try next. Pure, so it can be tested and
// so the agent stays useful when Claude is unavailable.
import crypto from 'node:crypto';
import {templateOf} from './checks.mjs';

const hash = value => crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Identifies a control across snapshots. Repeated links collapse to their page type. */
export function controlKey(control) {
  if ((control.tag === 'a' || control.role === 'link') && control.href) {
    try {
      const template = templateOf(new URL(control.href).pathname);
      if (template.endsWith(':slug')) return `link|${template}`;
    } catch { /* fall through to a name key */ }
  }
  return `${control.role || control.tag}|${norm(control.name).slice(0, 70)}`;
}

const REVEALS_MORE = /filter|sort|menu|more\b|options|weitere|mehr\b/i;
const DATE_VALUE = /\d{4}-\d{2}-\d{2}/g;
const NOISE_PARAMS = /^(utm_|fbclid|gclid|_rsc|ref$|session|sid$|ts$|t$)/i;

/** A state is what the visitor has selected, not the data, so listings can change daily. */
export function stateKeyOf(observation) {
  const u = new URL(observation.url);
  const params = [...u.searchParams.entries()].filter(([k]) => !NOISE_PARAMS.test(k)).map(([k, v]) => `${k}=${v.slice(0, 30).replace(DATE_VALUE, 'DATE')}`).sort();
  // Drawers often have no ARIA state, so the set of fixed-name buttons also marks a new state.
  // Links and names with numbers are left out because they change with the listings.
  const buttons = [...new Set(observation.controls.filter(c => c.tag !== 'a' && c.role !== 'link' && !/\d/.test(c.name) && c.name).map(c => norm(c.name)))].sort();
  const parts = [templateOf(u.pathname), params.join('&'), observation.active.slice().sort().join(','), observation.expanded.slice().sort().join(','), observation.dialogOpen ? 'dialog' : '', buttons.join(',')];
  return `${templateOf(u.pathname)}#${hash(parts.join('|'))}`;
}

export function createGraph() {
  return {states: {}, edges: [], groupsTried: {}};
}

export function addState(graph, key, observation, path, limits) {
  if (graph.states[key]) return graph.states[key];
  if (Object.keys(graph.states).length >= limits.maxStates) return null;
  const controls = dedupeControls(observation.controls).filter(c => c.classification.allowed);
  const state = {key, template: templateOf(new URL(observation.url).pathname), url: observation.url, title: observation.title, path, depth: path.length, controls, tried: {}, itemCount: observation.listing.count, active: observation.active};
  graph.states[key] = state;
  return state;
}

export function dedupeControls(controls) {
  const seen = new Set();
  return controls.filter(c => {
    const key = controlKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scoreControl(control, state, {counts = {}, hints = [], hotTemplates = [], device = ''} = {}, tried = {}) {
  const key = controlKey(control);
  const past = counts[`${device}|${key}`] || 0;
  let score = 100 / (1 + past); // never-tested controls come first, then the least tested
  const name = norm(control.name);
  if (hints.some(h => norm(h) === name)) score += 60;
  if (REVEALS_MORE.test(name)) score += 30;
  score -= 90 * (tried[key] || 0); // breadth first: a new control beats repeating a known one elsewhere
  if (control.region === 'main' || control.region === 'dialog') score += 25;
  if (control.region === 'footer') score -= 30;
  if (control.region === 'nav' || control.region === 'header') score += 5;
  if (control.expanded !== null && control.expanded !== undefined) score += 30; // drawers reveal more of the site
  if (control.pressed !== null && control.pressed !== undefined) score += 20;
  if (control.classification.kind === 'navigate' && control.href) {
    try { if (hotTemplates.includes(templateOf(new URL(control.href).pathname))) score += 40; } catch { /* ignore */ }
  }
  if (control.classification.kind === 'search') score += 15;
  return score - state.depth * 8;
}

/** Best untried control in any reachable state, limiting repeats of the same link type. */
export function nextCandidate(graph, context, limits) {
  let best = null;
  for (const state of Object.values(graph.states)) {
    if (state.depth > limits.maxDepth) continue;
    for (const control of state.controls) {
      const key = controlKey(control);
      if (state.tried[key]) continue;
      if ((graph.groupsTried[key] || 0) >= limits.maxPerGroup) continue;
      const score = scoreControl(control, state, context, graph.groupsTried);
      if (!best || score > best.score) best = {state, control, key, score};
    }
  }
  return best;
}

export function markTried(graph, state, key) {
  state.tried[key] = true;
  graph.groupsTried[key] = (graph.groupsTried[key] || 0) + 1;
}

export function untestedControls(graph) {
  const open = new Set();
  for (const state of Object.values(graph.states)) {
    for (const control of state.controls) {
      const key = controlKey(control);
      if (!state.tried[key] && !graph.groupsTried[key]) open.add(key);
    }
  }
  return [...open];
}

export function graphSummary(graph) {
  const states = Object.values(graph.states);
  return {
    states: states.length,
    transitions: graph.edges.length,
    templates: [...new Set(states.map(s => s.template))],
    controlsDiscovered: new Set(states.flatMap(s => s.controls.map(controlKey))).size,
    controlsTried: Object.keys(graph.groupsTried).length,
    untested: untestedControls(graph).slice(0, 40),
    edges: graph.edges.slice(0, 120),
  };
}
