import {robotsAllows} from './guard.mjs';

export const DENIED_LABEL = /(?:\bbuy\b|\btickets?\b|(?<![a-z])book(?:ing|ings|en)?\b|checkout|purchase|\bpay(?:ment)?\b|\border\b|donate|add to cart|reserv|subscribe|sign\s?up|regist|log\s?in|sign\s?in|submit|\bsend\b|contact|delete|remove|\bsave\b|report incorrect|accept|cookie settings|newsletter|watchlist|favou?rite|\bshare\b|logout|log\s?out|near me|use my location|kaufen|bestellen|buchen|kasse|bezahlen|\bkarten\b|abonnieren|anmelden|abmelden|einloggen|registrieren|absenden|senden|l(?:ö|oe)schen|speichern|merken|akzeptieren|zustimmen|teilen)/i;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const TEXT_ENTRY_TYPES = new Set(['text', 'search', '']);
const SEARCH_HINT = /search|suche|find|try\b/i;
const SENSITIVE_INPUT_HINT = /e-?mail|phone|telefon|password|passwort|card|iban|name|adresse|address/i;

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

const deny = reason => ({allowed: false, kind: null, reason});

/**
 * Decides whether the agent may touch a control it discovered. There is no list of
 * expected button names: anything is fair unless it could change data or leave the site.
 */
export function classifyControl(control, config) {
  if (!control || typeof control !== 'object') return deny('malformed');
  if (control.disabled) return deny('disabled');
  const label = [control.name, control.title, control.value].filter(Boolean).join(' ');
  const extraDeny = config.denyLabels?.length ? new RegExp(config.denyLabels.join('|'), 'i') : null;
  if (DENIED_LABEL.test(label) || extraDeny?.test(label)) return deny('denied-label');
  if (control.form?.sensitive) return deny('sensitive-form');
  if (control.form?.method === 'post') return deny('post-form');

  if (control.tag === 'a' || control.role === 'link') {
    if (!control.href) return deny('no-href');
    if (!isAllowedUrl(control.href, config)) return deny('external-link');
    const u = new URL(control.href, config.url);
    if (isExcludedPath(u.pathname, config)) return deny('excluded-path');
    if (config.robotsRules && !robotsAllows(config.robotsRules, u.pathname)) return deny('robots');
    if (DENIED_LABEL.test(decodeURIComponent(u.pathname).replace(/[-_/]/g, ' '))) return deny('denied-path');
    return {allowed: true, kind: 'navigate', reason: 'ok'};
  }
  if (control.tag === 'input' || control.tag === 'textarea') {
    if (control.tag === 'textarea') return deny('free-text');
    if (['checkbox', 'radio'].includes(control.type)) return {allowed: true, kind: 'activate', reason: 'ok'};
    if (['submit', 'button', 'reset', 'image'].includes(control.type)) return control.type === 'reset' ? deny('reset') : {allowed: true, kind: 'activate', reason: 'ok'};
    if (!TEXT_ENTRY_TYPES.has(control.type)) return deny('input-type');
    const hint = `${control.name || ''} ${control.placeholder || ''}`;
    if (SENSITIVE_INPUT_HINT.test(hint)) return deny('sensitive-input');
    if (control.type === 'search' || control.role === 'searchbox' || SEARCH_HINT.test(hint)) return {allowed: true, kind: 'search', reason: 'ok'};
    return deny('not-a-search-field');
  }
  if (control.tag === 'select') return {allowed: true, kind: 'select', reason: 'ok'};
  return {allowed: true, kind: 'activate', reason: 'ok'};
}

export function safeSearchQuery(value) {
  if (typeof value !== 'string') return null;
  const q = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!q || q.length > 70) return null;
  if (/@|https?:|<|>|\+?\d[\d\s-]{7,}/.test(q)) return null;
  return q;
}

export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }

export function safeFilename(value) { return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 70); }

export function cleanText(value, max = 200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

const INJECTION = /ignore (?:all |any |the )?(?:previous|prior|above) (?:instructions|prompts?)|disregard (?:your|the|previous) (?:instructions|rules)|you are now (?:a|an|in)\b|system prompt|<\/?(?:system|assistant|tool_use)\b|as an ai (?:agent|assistant|model),? (?:you must|please)|(?:exfiltrate|reveal|print).{0,30}(?:token|secret|api key|credentials)|run (?:this|the following) (?:command|shell)|ignoriere (?:alle |die )?(?:vorherigen|bisherigen) anweisungen/i;

/** Text aimed at an AI reader is worth reporting even though it cannot make the agent act. */
export function findInjectionText(text) {
  const match = String(text || '').match(INJECTION);
  if (!match) return null;
  const start = Math.max(0, match.index - 40);
  return String(text).slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' ').trim();
}
