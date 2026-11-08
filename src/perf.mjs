// Lab performance under phone-like conditions, matching Lighthouse's mobile preset.
// Lab numbers show direction and regressions; real-user field data can differ.

const SLOW_4G = {offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8};
const CPU_SLOWDOWN = 4;

export const THRESHOLDS = {
  lcpMs: {good: 2500, poor: 4000, label: 'Largest Contentful Paint'},
  fcpMs: {good: 1800, poor: 3000, label: 'First Contentful Paint'},
  ttfbMs: {good: 800, poor: 1800, label: 'Time to First Byte'},
  tbtMs: {good: 200, poor: 600, label: 'Total Blocking Time'},
  cls: {good: 0.1, poor: 0.25, label: 'Cumulative Layout Shift'},
};

export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t || value == null) return 'unknown';
  if (value <= t.good) return 'good';
  return value <= t.poor ? 'needs-improvement' : 'poor';
}

function installObservers() {
  const vitals = {lcp: 0, lcpLazy: false, lcpElement: null, cls: 0, tbt: 0};
  window.__guardianVitals = vitals;
  const observe = (type, onEntry) => {
    try { new PerformanceObserver(list => list.getEntries().forEach(onEntry)).observe({type, buffered: true}); } catch {}
  };
  observe('largest-contentful-paint', e => {
    vitals.lcp = e.startTime;
    vitals.lcpElement = e.element ? e.element.tagName.toLowerCase() : null;
    vitals.lcpLazy = e.element?.tagName === 'IMG' && e.element.loading === 'lazy';
  });
  observe('layout-shift', e => { if (!e.hadRecentInput) vitals.cls += e.value; });
  observe('longtask', e => { vitals.tbt += Math.max(0, e.duration - 50); });
}

function readMetrics() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const resources = performance.getEntriesByType('resource');
  const scripts = resources.filter(r => r.initiatorType === 'script');
  const sum = list => list.reduce((total, r) => total + (r.transferSize || 0), 0);
  const v = window.__guardianVitals;
  return {
    ttfbMs: nav ? Math.round(nav.responseStart) : null,
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    lcpMs: Math.round(v.lcp) || null,
    cls: Number(v.cls.toFixed(3)),
    tbtMs: Math.round(v.tbt),
    lcpElement: v.lcpElement,
    lcpLazy: v.lcpLazy,
    requests: resources.length,
    transferKb: Math.round((sum(resources) + (nav?.transferSize || 0)) / 1024),
    scriptKb: Math.round(sum(scripts) / 1024),
  };
}

/** Loads one URL with an empty cache on a throttled connection and slowed CPU. */
export async function measurePage(browser, url, contextOptions) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.addInitScript(installObservers);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: CPU_SLOWDOWN});
    await page.goto(url, {waitUntil: 'load', timeout: 60000});
    await page.waitForTimeout(3000);
    return await page.evaluate(readMetrics);
  } finally {
    await context.close().catch(() => {});
  }
}

export function analyzePerformance(metrics, path) {
  const findings = [];
  for (const [metric, {label}] of Object.entries(THRESHOLDS)) {
    const rating = rate(metric, metrics[metric]);
    if (rating !== 'poor' && rating !== 'needs-improvement') continue;
    findings.push({
      kind: `performance-${metric}`,
      title: `${label} is ${rating === 'poor' ? 'poor' : 'worse than recommended'} on a throttled phone`,
      severity: rating === 'poor' ? 'P2' : 'P3',
      evidence: {path, value: metrics[metric], goodAtMost: THRESHOLDS[metric].good, poorAbove: THRESHOLDS[metric].poor, conditions: 'Slow 4G, 4x CPU slowdown (lab)'},
    });
  }
  if (metrics.lcpLazy) {
    findings.push({kind: 'lazy-lcp-image', title: 'The largest visible image is lazy-loaded, delaying first view', severity: 'P2', evidence: {path, lcpMs: metrics.lcpMs}});
  }
  return findings;
}
