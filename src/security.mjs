export const DENIED_LABEL = /(?:\bbuy\b|\bticket(?:s)?\b|book(?:ing)?|checkout|purchase|\bpay(?:ment)?\b|\border\b|donate|add to cart|reserv|subscribe|sign\s?up|regist|log\s?in|sign\s?in|submit|\bsend\b|contact|delete|remove|save|report incorrect|accept|cookie settings|newsletter|watchlist|favou?rite|share|logout|kaufen|bestellen|buchen|kasse|bezahlen|karten|abonnieren|anmelden|abmelden|einloggen|registrieren|absenden|senden|l(?:ö|oe)schen|speichern|merken|akzeptieren|zustimmen)/i;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isAllowedUrl(raw, config) {
  try {
    const u = new URL(raw, config.url);
    const secure = u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
    return secure && config.allowedHosts.includes(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

export function isExcludedPath(pathname, config) {
  return (config.excludePaths || []).some(p => pathname === p || pathname.startsWith(`${p.replace(/\/$/, '')}/`));
}

/** Label and allowlist rules that do not depend on what is currently on the page. */
export function policyAllows(action, config) {
  if (!action || typeof action !== 'object') return false;
  if (!['click', 'search', 'view', 'open_detail', 'back'].includes(action.type)) return false;
  if (typeof action.target !== 'string' || action.target.length > 160) return false;
  if (DENIED_LABEL.test(action.target)) return false;
  if (action.type === 'search') return action.target.length > 0 && action.target.length <= 70;
  if (action.type === 'click') return [...(config.filters || []), ...(config.safeButtons || [])].includes(action.target);
  if (action.type === 'view') return (config.views || []).includes(action.target);
  return true;
}

export function safeAction(action, inventory, config) {
  if (!policyAllows(action, config)) return false;
  if (action.type === 'click' || action.type === 'view') return inventory.buttons.includes(action.target);
  if (action.type === 'open_detail') {
    return inventory.internalLinks.some(x => x.text === action.target
      && isAllowedUrl(x.href, config)
      && !isExcludedPath(new URL(x.href).pathname, config)
      && (config.detailPathPrefixes || []).some(p => new URL(x.href).pathname.startsWith(p)));
  }
  return true;
}

export function safeFilename(value) { return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 70); }

export function cleanText(value, max = 200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
