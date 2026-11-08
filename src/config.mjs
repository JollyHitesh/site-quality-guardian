import fs from 'node:fs';
import path from 'node:path';

// Device order in a site config decides priority: the first device gets the
// largest share of the action budget, AI exploration and the performance pass.
export const DEVICE_PROFILES = {
  mobile: {family: 'mobile', engine: 'chromium', descriptor: 'iPhone 13'},
  'mobile-small': {family: 'mobile', engine: 'chromium', descriptor: 'iPhone SE'},
  'mobile-android': {family: 'mobile', engine: 'chromium', descriptor: 'Pixel 7'},
  'mobile-webkit': {family: 'mobile', engine: 'webkit', descriptor: 'iPhone 13'},
  tablet: {family: 'tablet', engine: 'webkit', descriptor: 'iPad (gen 7)'},
  desktop: {family: 'desktop', engine: 'chromium', viewport: {width: 1440, height: 900}},
};

const DEFAULTS = {
  purpose: '',
  priorities: [],
  timezone: 'UTC',
  maxActions: 40,
  maxPages: 8,
  maxRunMinutes: 20,
  rateLimitMs: 800,
  screenshotLimit: 30,
  linkCheckLimit: 30,
  devices: ['mobile', 'desktop'],
  allowedHosts: [],
  detailPathPrefixes: [],
  excludePaths: [],
  denyLabels: [],
  filters: [],
  views: [],
  safeButtons: [],
  searchQueries: [],
  filterSemantics: [],
  audiences: [],
  primaryActionPattern: 'tickets?|book|buchen|reserv',
  // Only ever refuse optional consent: the audit must not opt in to tracking.
  consentButtons: ['Reject', 'Reject all', 'Decline', 'Only necessary', 'Ablehnen', 'Alle ablehnen', 'Nur notwendige'],
  userAgentSuffix: 'SiteQualityGuardian',
  respectRobots: true,
  checks: {},
  deviceOverrides: {},
};

const SECTION_DEFAULTS = {
  readOnly: {allowPostPaths: ['/cdn-cgi/challenge-platform/'], allowPostBodies: [], blockHosts: []},
  explore: {maxStates: 40, maxDepth: 3, maxPerGroup: 2, maxCombos: 3},
  ai: {models: ['sonnet', 'haiku'], maxCalls: 12, maxGoals: 2, maxStepsPerGoal: 4, timeoutMs: 150000, reviewScreenshots: 8},
  showtimes: {enabled: false, sampleSize: 6, maxRenderChecks: 20, expandPattern: 'show \\d+ more|more showtimes|mehr anzeigen|alle anzeigen'},
};

const STRING_LISTS = ['allowedHosts', 'detailPathPrefixes', 'excludePaths', 'denyLabels', 'filters', 'views', 'safeButtons', 'searchQueries', 'audiences', 'priorities', 'consentButtons'];
const LOCAL = new Set(['localhost', '127.0.0.1']);

function assertRegex(value, label) {
  try { new RegExp(value); } catch { throw new Error(`Config "${label}" is not a valid regular expression`); }
}

export function normalizeConfig(raw, {slug} = {}) {
  const config = {...DEFAULTS, ...raw};
  for (const [name, defaults] of Object.entries(SECTION_DEFAULTS)) config[name] = {...defaults, ...(raw[name] || {})};
  if (typeof config.url !== 'string' || !config.url) throw new Error('Config needs a "url"');
  let target;
  try { target = new URL(config.url); } catch { throw new Error(`Config "url" is not a valid URL: ${config.url}`); }
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && LOCAL.has(target.hostname))) throw new Error('Config "url" must use https');
  if (!Array.isArray(config.allowedHosts) || !config.allowedHosts.length) throw new Error('Config needs a non-empty "allowedHosts" list');
  if (!config.allowedHosts.includes(target.hostname)) throw new Error(`Config "allowedHosts" must include ${target.hostname}`);
  if (!Array.isArray(config.devices) || !config.devices.length) throw new Error('Config needs at least one device');
  const unknown = config.devices.filter(d => !DEVICE_PROFILES[d]);
  if (unknown.length) throw new Error(`Unknown device(s) ${unknown.join(', ')}. Known: ${Object.keys(DEVICE_PROFILES).join(', ')}`);
  for (const key of STRING_LISTS) {
    if (!Array.isArray(config[key]) || config[key].some(v => typeof v !== 'string')) throw new Error(`Config "${key}" must be a list of strings`);
  }
  try { new Intl.DateTimeFormat('en', {timeZone: config.timezone}); } catch { throw new Error(`Config "timezone" is not valid: ${config.timezone}`); }
  assertRegex(config.primaryActionPattern, 'primaryActionPattern');
  config.denyLabels.forEach(v => assertRegex(v, 'denyLabels'));
  for (const rule of config.readOnly.allowPostBodies) {
    if (!rule.bodyMustMatch) throw new Error('Each "allowPostBodies" rule needs "bodyMustMatch"');
    assertRegex(rule.bodyMustMatch, 'readOnly.allowPostBodies.bodyMustMatch');
    if (!rule.bodyMustMatch.startsWith('^') || !rule.bodyMustMatch.endsWith('$')) throw new Error('"bodyMustMatch" must be anchored with ^ and $, so it cannot match a write by accident');
  }
  for (const rule of config.filterSemantics) {
    if (!rule.control || !rule.itemsMustMatch) throw new Error('Each "filterSemantics" rule needs "control" and "itemsMustMatch"');
    assertRegex(rule.control, 'filterSemantics.control');
    assertRegex(rule.itemsMustMatch, 'filterSemantics.itemsMustMatch');
    if (rule.applicableIf) assertRegex(rule.applicableIf, 'filterSemantics.applicableIf');
  }
  config.maxActions = Math.max(1, Math.min(Number(config.maxActions) || DEFAULTS.maxActions, 120));
  config.maxRunMinutes = Math.max(1, Math.min(Number(config.maxRunMinutes) || DEFAULTS.maxRunMinutes, 45));
  // A polite floor for real sites. Local fixtures may go faster.
  config.rateLimitMs = LOCAL.has(target.hostname) ? Number(config.rateLimitMs) || 0 : Math.max(300, Number(config.rateLimitMs) || DEFAULTS.rateLimitMs);
  config.ai.maxCalls = Math.max(0, Math.min(Number(config.ai.maxCalls) || 0, 30));
  config.slug = slug || config.slug || target.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(config.slug)) throw new Error(`Site slug must use lowercase letters, numbers and hyphens: ${config.slug}`);
  return config;
}

export function loadConfig(file) {
  return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')), {slug: path.basename(file, '.json')});
}

/** Lets anyone audit a public URL with no site file at all. */
export function configFromUrl(url) {
  const u = new URL(url);
  const bare = u.hostname.replace(/^www\./, '');
  const hosts = LOCAL.has(u.hostname) ? [u.hostname] : [...new Set([u.hostname, bare, `www.${bare}`])];
  return normalizeConfig({name: u.hostname, url: u.href, allowedHosts: hosts, devices: ['mobile', 'desktop']});
}

export function listSites(dir = 'sites') {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f));
}

/** A site can label controls differently per device; an exact device override beats a family one. */
export function forDevice(config, deviceName) {
  const family = DEVICE_PROFILES[deviceName].family;
  return {...config, ...config.deviceOverrides[family], ...config.deviceOverrides[deviceName]};
}

/** The first device gets 60% of a budget, the others split what is left. */
export function deviceShare(total, deviceCount, isPrimary) {
  if (deviceCount <= 1) return total;
  const primary = Math.ceil(total * 0.6);
  return isPrimary ? primary : Math.max(1, Math.floor((total - primary) / (deviceCount - 1)));
}
