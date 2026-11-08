// Everything leaving the agent passes through here: text sent to Claude, and all published output.
const SENSITIVE_PARAM = /([?&](?:token|access_token|auth|session|sessionid|sid|key|api_key|apikey|password|passwd|pwd|email|mail|signature|sig|code)=)[^&\s"'<>]+/gi;

const PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted-token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted-jwt]'],
  [/\b(?:authorization|bearer)[:\s]+[A-Za-z0-9._~+/=-]{12,}/gi, '[redacted-auth]'],
  [/\b(?:set-cookie|cookie)\s*:\s*[^\n"]+/gi, '[redacted-cookie]'],
  [/\b(?:cf_clearance|__cf_bm|sessionid|PHPSESSID|connect\.sid)=[^;\s"']+/g, '[redacted-cookie]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/g, '[redacted-iban]'],
];

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redactText(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  text = text.replace(SENSITIVE_PARAM, '$1[redacted]');
  return text.replace(/\b(?:\d[ -]?){13,19}\b/g, match => (luhn(match.replace(/\D/g, '')) ? '[redacted-card]' : match));
}

export function redactDeep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  return value;
}

/** Rules for the final scan of files about to be published. Exact secret values are checked too. */
export const SECRET_RULES = [
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{8,}/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ['cookie-header', /\bset-cookie\s*:/i],
  ['session-cookie', /\b(?:cf_clearance|__cf_bm|PHPSESSID|connect\.sid)=[A-Za-z0-9]/],
  ['auth-header', /\bauthorization\s*:\s*\S{12,}/i],
];
