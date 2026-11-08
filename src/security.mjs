export const DENIED_LABEL = /(?:\bbuy\b|\bticket(?:s)?\b|book(?:ing)?|checkout|purchase|pay(?:ment)?|subscribe|sign\s?up|log\s?in|sign\s?in|submit|contact|delete|remove|save|report incorrect|accept all|cookie settings|newsletter|watchlist|favorite|share|logout)/i;

export function isAllowedUrl(raw, config) {
  try {
    const u = new URL(raw, config.url);
    return u.protocol === 'https:' && config.allowedHosts.includes(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

export function safeAction(action, inventory, config) {
  if (!action || typeof action !== 'object') return false;
  if (!['click', 'search', 'view', 'open_detail', 'back'].includes(action.type)) return false;
  if (typeof action.target !== 'string' || action.target.length > 160) return false;
  if (DENIED_LABEL.test(action.target)) return false;
  if (action.type === 'search') return action.target.length > 0 && action.target.length <= 70;
  if (action.type === 'back') return true;
  if (action.type === 'click') return inventory.buttons.includes(action.target) && [...(config.filters||[]), ...(config.safeButtons||[])].includes(action.target);
  if (action.type === 'view') return inventory.buttons.includes(action.target) && (config.views||[]).includes(action.target);
  if (action.type === 'open_detail') return inventory.internalLinks.some(x => x.text === action.target && isAllowedUrl(x.href, config) && (config.detailPathPrefixes||['/movies/']).some(p => new URL(x.href).pathname.startsWith(p)));
  return false;
}

export function safeFilename(value) { return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 70); }

export function cleanText(value, max = 200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
