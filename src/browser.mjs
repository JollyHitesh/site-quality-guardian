// Sees the page the way a visitor's browser does, and acts only on controls classified as safe.
import {classifyControl, isAllowedUrl, cleanText} from './security.mjs';

export const EMPTY_RESULTS = /\b(no (results|movies|films|screenings|showtimes|matches|events)|nothing found|keine (ergebnisse|treffer|filme|vorstellungen))\b/i;

/** Waits for hydration and data fetches, so clicks reach a page that can respond. */
export async function settle(page, timeout = 4000) {
  await page.waitForLoadState('networkidle', {timeout}).catch(() => {});
}

/* Runs inside the page, so it can only use browser globals. */
function collectObservation() {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const IMPLICIT = {A: 'link', BUTTON: 'button', SELECT: 'combobox', SUMMARY: 'button', TEXTAREA: 'textbox'};
  const roleOf = el => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.tagName === 'INPUT') return {checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', button: 'button'}[el.type] || 'textbox';
    return IMPLICIT[el.tagName] || el.tagName.toLowerCase();
  };
  const nameOf = el => {
    const labelled = el.getAttribute('aria-labelledby');
    const fromIds = labelled ? labelled.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ') : '';
    const forLabel = el.labels?.[0]?.innerText;
    return clean(el.getAttribute('aria-label') || fromIds || forLabel || el.innerText || el.querySelector?.('img[alt]')?.alt || el.title || el.placeholder || (el.type === 'submit' ? el.value : '')).slice(0, 90);
  };
  const regionOf = el => {
    if (el.closest('dialog,[role=dialog],[aria-modal=true]')) return 'dialog';
    if (el.closest('nav,[role=navigation]')) return 'nav';
    if (el.closest('header,[role=banner]')) return 'header';
    if (el.closest('footer,[role=contentinfo]')) return 'footer';
    if (el.closest('aside,[role=complementary]')) return 'aside';
    return 'main';
  };
  const cssPath = el => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let index = 1;
      for (let s = node.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === node.tagName) index++;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    }
    return parts.join(' > ');
  };
  const formOf = el => {
    const form = el.form || el.closest('form');
    if (!form) return null;
    const fields = [...form.querySelectorAll('input,textarea')];
    const sensitive = fields.some(f => ['email', 'password', 'tel', 'file', 'url'].includes(f.type) || /e-?mail|password|passwort|credit|card/i.test(`${f.name} ${f.placeholder} ${f.autocomplete}`));
    return {method: (form.getAttribute('method') || 'get').toLowerCase(), sensitive};
  };
  const covered = el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y < 0 || y >= innerHeight || x < 0 || x >= innerWidth) return false; // off screen: nothing to compare yet
    const top = document.elementFromPoint(x, y);
    return !!top && top !== el && !el.contains(top) && !top.contains(el);
  };
  const bool = (el, attr) => { const v = el.getAttribute(attr); return v === null ? null : v === 'true'; };
  const selector = 'a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=menuitem],[role=link],[role=option],select,input:not([type=hidden]),textarea,summary';
  const elements = [...document.querySelectorAll(selector)].filter(visible);
  const controls = elements.slice(0, 500).map((el, i) => {
    const r = el.getBoundingClientRect();
    return {
      ref: `c${i}`, tag: el.tagName.toLowerCase(), role: roleOf(el), type: el.type || '', name: nameOf(el), title: clean(el.title), placeholder: clean(el.placeholder), value: el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type) ? clean(el.value) : '',
      href: el.href && el.tagName === 'A' ? el.href : '', target: el.getAttribute('target') || '', region: regionOf(el), form: formOf(el),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', expanded: bool(el, 'aria-expanded'), pressed: bool(el, 'aria-pressed') ?? bool(el, 'aria-selected') ?? bool(el, 'aria-checked'),
      covered: covered(el), css: cssPath(el), w: Math.round(r.width), h: Math.round(r.height), options: el.tagName === 'SELECT' ? [...el.options].slice(0, 25).map(o => clean(o.text).slice(0, 40)) : undefined,
    };
  });

  // Finds the page's main repeated collection without being told what it looks like.
  const signature = el => `${el.tagName}.${(typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 2).join('.')}`;
  let best = null;
  for (const parent of document.querySelectorAll('main *, body > div *, ul, ol')) {
    if (parent.children.length < 3 || parent.closest('nav,footer,header')) continue;
    const groups = new Map();
    for (const child of parent.children) {
      if (!visible(child)) continue;
      const key = signature(child);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const list of groups.values()) {
      if (list.length < 3) continue;
      const length = list.reduce((n, c) => n + clean(c.innerText).length, 0);
      if (length / list.length < 15) continue;
      if (!best || length > best.length) best = {list, length};
    }
  }
  const items = best ? best.list.slice(0, 40).map(el => clean(el.innerText).slice(0, 180)) : [];
  const text = clean(document.body.innerText);
  const countMatch = text.match(/\b(\d{1,5})\s+(?:results?|movies?|films?|screenings?|showtimes?|events?|Filme|Vorstellungen|Ergebnisse)\b/i);
  const activeControls = elements.filter(el => ['aria-pressed', 'aria-selected', 'aria-checked'].some(a => el.getAttribute(a) === 'true') || (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false'));
  const expandedControls = elements.filter(el => el.getAttribute('aria-expanded') === 'true');
  return {
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0, 12).map(x => clean(x.innerText).slice(0, 100)),
    controls,
    text: text.slice(0, 4000),
    textLength: text.length,
    active: activeControls.map(nameOf).filter(Boolean).slice(0, 25),
    expanded: expandedControls.map(nameOf).filter(Boolean).slice(0, 12),
    dialogOpen: !!document.querySelector('dialog[open],[role=dialog]:not([hidden]),[aria-modal=true]'),
    listing: {count: best ? best.list.length : 0, items, statedCount: countMatch ? Number(countMatch[1]) : null},
  };
}

export async function observe(page, config) {
  const raw = await page.evaluate(collectObservation);
  // A control behind an open drawer is not something a visitor could tap right now.
  raw.controls = raw.controls.map(c => ({...c, classification: c.covered ? {allowed: false, kind: null, reason: 'covered'} : classifyControl(c, config)}));
  raw.emptyMessage = EMPTY_RESULTS.test(raw.text);
  return raw;
}

/** A cheap signature of what the visitor sees, to detect whether a control did anything. */
function stateSignature(page) {
  return page.evaluate(() => {
    const states = [...document.querySelectorAll('[aria-pressed],[aria-selected],[aria-checked],[aria-expanded],[aria-current],[data-state]')]
      .map(el => ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-expanded', 'aria-current', 'data-state'].map(a => el.getAttribute(a)).join())
      .join('|');
    return [location.href, document.body.innerText, document.querySelectorAll('*').length, states].join('\n');
  });
}

async function waitForChange(page, before, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await stateSignature(page).catch(() => '') !== before) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Client-side data can arrive well after the URL changes, so judge results once quiet. */
async function waitForStable(page, timeout = 6000) {
  let last = null, quiet = 0;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await page.evaluate(() => `${document.body.innerText.length}:${document.querySelectorAll('*').length}`).catch(() => null);
    if (value !== null && value === last) {
      if (++quiet >= 3) return true;
    } else {
      quiet = 0;
      last = value;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

function classifyFailure(message) {
  if (/intercepts pointer events/.test(message)) return 'obscured';
  if (/outside of the viewport|not visible|Timeout .* exceeded/.test(message)) return 'unreachable';
  return 'error';
}

/* Re-reads the element at click time: the page may have swapped it since the snapshot. */
function liveDescription(el) {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const form = el.form || el.closest('form');
  return {
    name: clean(el.getAttribute('aria-label') || el.innerText || el.title || el.placeholder).slice(0, 90),
    href: el.tagName === 'A' ? el.href : '',
    tag: el.tagName.toLowerCase(),
    type: el.type || '',
    role: el.getAttribute('role') || (el.tagName === 'A' ? 'link' : ''),
    placeholder: clean(el.placeholder),
    disabled: !!el.disabled,
    form: form ? {method: (form.getAttribute('method') || 'get').toLowerCase(), sensitive: !!form.querySelector('input[type=email],input[type=password],input[type=tel],input[type=file]')} : null,
  };
}

/**
 * Performs one action on a discovered control. `code` separates site problems from audit
 * problems: rejected (safety), missing, obscured, unreachable, error.
 */
export async function act(page, control, config, {value, changeTimeout = 3000} = {}) {
  const classification = classifyControl(control, config);
  if (!classification.allowed) return {ok: false, code: 'rejected', reason: `Blocked by safety policy: ${classification.reason}`};
  const before = page.url();
  const startedAt = Date.now();
  try {
    const locator = page.locator(`css=${control.css}`).first();
    if (await locator.count() === 0) return {ok: false, code: 'missing', reason: 'Control is no longer on the page'};
    const live = await locator.evaluate(liveDescription);
    const liveCheck = classifyControl({...control, ...live}, config);
    if (!liveCheck.allowed) return {ok: false, code: 'rejected', reason: `Blocked at click time: ${liveCheck.reason}`};

    const signature = await stateSignature(page);
    let wasActive = false;
    if (classification.kind === 'search') {
      if (!value) return {ok: false, code: 'rejected', reason: 'Search needs a query'};
      await locator.fill(value, {timeout: 7000});
      await locator.press('Enter', {timeout: 7000}).catch(() => {});
    } else if (classification.kind === 'select') {
      const options = control.options || [];
      const choice = value && options.includes(value) ? value : options.find((o, i) => i > 0);
      if (!choice) return {ok: false, code: 'missing', reason: 'Select has no options to choose'};
      await locator.selectOption({label: choice}, {timeout: 7000});
    } else {
      wasActive = await locator.evaluate(el => ['aria-pressed', 'aria-selected', 'aria-checked'].some(a => el.getAttribute(a) === 'true') || el.hasAttribute('aria-current'));
      await locator.click({timeout: 8000});
    }
    const changed = wasActive ? null : await waitForChange(page, signature, changeTimeout);
    if (page.url() !== before) await settle(page);
    if (changed !== false) await waitForStable(page);
    await page.waitForTimeout(config.rateLimitMs || 0);

    // A blocked navigation leaves the tab on the browser's own error page, which says nothing about the site.
    if (!isAllowedUrl(page.url(), config)) {
      await page.goto(config.url, {waitUntil: 'domcontentloaded'}).catch(() => {});
      await settle(page);
      return {ok: false, code: 'rejected', reason: 'Navigation blocked by the read-only guard'};
    }
    return {ok: true, changed, navigated: page.url() !== before, ms: Date.now() - startedAt};
  } catch (e) {
    const blocker = e.message.match(/.{0,120}intercepts pointer events/)?.[0];
    return {ok: false, code: classifyFailure(e.message), reason: cleanText(blocker || e.message, 200)};
  }
}

/** Finds the live version of a control from an earlier snapshot. */
export function locateControl(observation, key, keyOf) {
  return observation.controls.find(c => keyOf(c) === key && c.classification.allowed) || null;
}
