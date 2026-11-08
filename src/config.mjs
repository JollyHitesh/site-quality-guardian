import fs from 'node:fs';

// Device order in a site config decides priority: the first device gets the
// largest share of the action budget, AI exploration and the performance pass.
export const DEVICE_PROFILES = {
  mobile: {family: 'mobile', engine: 'chromium', descriptor: 'iPhone 13'},
  'mobile-small': {family: 'mobile', engine: 'chromium', descriptor: 'iPhone SE'},
  'mobile-android': {family: 'mobile', engine: 'chromium', descriptor: 'Pixel 7'},
  'mobile-webkit': {family: 'mobile', engine: 'webkit', descriptor: 'iPhone 13'},
  desktop: {family: 'desktop', engine: 'chromium', viewport: {width: 1440, height: 900}},
};

const DEFAULTS = {
  maxActions: 40,
  maxPages: 8,
  maxAiRounds: 2,
  maxRunMinutes: 20,
  rateLimitMs: 800,
  screenshotLimit: 30,
  linkCheckLimit: 30,
  devices: ['mobile', 'desktop'],
  allowedHosts: [],
  detailPathPrefixes: [],
  excludePaths: [],
  filters: [],
  views: [],
  safeButtons: [],
  revealButtons: [],
  revealCloseButtons: [],
  searchQueries: [],
  primaryActionPattern: 'tickets?|book|buchen|reserv',
  // Only ever refuse optional consent: the audit must not opt in to tracking.
  consentButtons: ['Reject', 'Reject all', 'Decline', 'Only necessary', 'Ablehnen', 'Alle ablehnen', 'Nur notwendige'],
  checks: {},
  deviceOverrides: {},
};

export function normalizeConfig(raw) {
  const config = {...DEFAULTS, ...raw};
  if (typeof config.url !== 'string' || !config.url) throw new Error('Config needs a "url"');
  if (!Array.isArray(config.allowedHosts) || !config.allowedHosts.length) throw new Error('Config needs a non-empty "allowedHosts" list');
  const unknown = config.devices.filter(d => !DEVICE_PROFILES[d]);
  if (unknown.length) throw new Error(`Unknown device(s) ${unknown.join(', ')}. Known: ${Object.keys(DEVICE_PROFILES).join(', ')}`);
  if (!config.devices.length) throw new Error('Config needs at least one device');
  config.maxActions = Math.max(1, Math.min(Number(config.maxActions) || DEFAULTS.maxActions, 120));
  return config;
}

export function loadConfig(file) {
  return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
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
