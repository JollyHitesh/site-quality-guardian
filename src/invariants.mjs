// Checks that need no scripted expected values: they compare the site with itself
// and with its own history.

export const MIN_BASELINE_SAMPLES = 3;
const MAX_SAMPLES = 12;

const median = list => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function listingFingerprint(listing) {
  return {count: listing.count, items: listing.items.slice(0, 30).map(x => x.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)).sort()};
}

export function sameListing(a, b, tolerance = 0) {
  if (Math.abs(a.count - b.count) > tolerance) return false;
  if (!a.items.length || !b.items.length) return a.count === b.count;
  const other = new Set(b.items);
  const overlap = a.items.filter(x => other.has(x)).length / Math.max(a.items.length, b.items.length);
  return overlap >= 0.8;
}

/** Filtering in a different order must give the same results. */
export function checkCommutative(names, ab, ba) {
  if (sameListing(ab, ba)) return [];
  return [{kind: 'filter-order-dependent', title: `Results depend on the order of "${names[0]}" and "${names[1]}"`, severity: 'P2', status: 'LIKELY', evidence: {orderAB: {count: ab.count, sample: ab.items.slice(0, 5)}, orderBA: {count: ba.count, sample: ba.items.slice(0, 5)}}}];
}

export function checkEmptyResult(name, before, after, hasEmptyMessage) {
  if (before.count >= 3 && after.count === 0 && !hasEmptyMessage) {
    return [{kind: 'filter-empty-unexplained', title: `"${name}" leaves an empty list with no explanation`, severity: 'P2', status: 'LIKELY', evidence: {before: before.count, after: 0}}];
  }
  return [];
}

export function checkFilterSemantics(rule, name, listing) {
  if (listing.items.length < 3) return [];
  // Layouts that do not show this attribute cannot confirm or contradict the filter.
  if (rule.applicableIf) {
    const shows = new RegExp(rule.applicableIf, 'i');
    if (listing.items.filter(x => shows.test(x)).length / listing.items.length < 0.5) return [];
  }
  const pattern = new RegExp(rule.itemsMustMatch, 'i');
  const matching = listing.items.filter(x => pattern.test(x)).length;
  const share = matching / listing.items.length;
  const minimum = rule.minShare ?? 0.9;
  if (share >= minimum) return [];
  return [{kind: 'filter-semantics', title: `"${name}" shows results that do not match the filter`, severity: rule.severity || 'P1', status: 'LIKELY', evidence: {expected: rule.itemsMustMatch, matchingShare: Number(share.toFixed(2)), inspected: listing.items.length, offenders: listing.items.filter(x => !pattern.test(x)).slice(0, 5)}}];
}

const METRICS = {
  itemCount: {label: 'listed items', dropBelow: 0.5, riseAbove: 2.5, minAbsolute: 8, severity: 'P1'},
  textLength: {label: 'visible text', dropBelow: 0.5, riseAbove: 3, minAbsolute: 400, severity: 'P2'},
  controlCount: {label: 'interactive controls', dropBelow: 0.5, riseAbove: 3, minAbsolute: 10, severity: 'P2'},
};

/** Flags a state that has moved far from its own recent history. */
export function detectAnomalies(current, baseline, label) {
  if (!baseline) return [];
  const findings = [];
  for (const [metric, rule] of Object.entries(METRICS)) {
    const samples = baseline[metric] || [];
    const value = current[metric];
    if (samples.length < MIN_BASELINE_SAMPLES || value == null) continue;
    const typical = median(samples);
    const low = value < typical * rule.dropBelow;
    const high = value > typical * rule.riseAbove;
    if ((low || high) && Math.abs(value - typical) >= rule.minAbsolute) {
      findings.push({kind: `anomaly-${metric}`, title: `Unusual number of ${rule.label} on ${label}`, severity: rule.severity, status: 'LIKELY', evidence: {current: value, typical, samples: samples.length, direction: low ? 'drop' : 'spike'}});
    }
  }
  const known = baseline.headings || {};
  const seen = Object.entries(known).filter(([, n]) => n >= MIN_BASELINE_SAMPLES).map(([h]) => h);
  const missing = seen.filter(h => !current.headings.includes(h));
  if (seen.length >= 2 && missing.length / seen.length >= 0.6) {
    findings.push({kind: 'anomaly-structure', title: `Page structure changed on ${label}`, severity: 'P2', status: 'LIKELY', evidence: {missingHeadings: missing.slice(0, 6), currentHeadings: current.headings.slice(0, 6)}});
  }
  return findings;
}

export function updateBaseline(baseline = {}, current) {
  const next = {...baseline};
  for (const metric of Object.keys(METRICS)) {
    if (current[metric] == null) continue;
    next[metric] = [...(baseline[metric] || []), current[metric]].slice(-MAX_SAMPLES);
  }
  const headings = {...(baseline.headings || {})};
  for (const h of current.headings || []) headings[h] = (headings[h] || 0) + 1;
  next.headings = Object.fromEntries(Object.entries(headings).sort((a, b) => b[1] - a[1]).slice(0, 25));
  return next;
}
