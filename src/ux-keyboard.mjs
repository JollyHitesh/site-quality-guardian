// Keyboard-only and assistive-technology checks in a real browser. A passing result here means
// these specific behaviours worked, and never that the site conforms to WCAG.

/* Reads the focused element, and how the previously focused one looks now that focus has left. */
function readFocusInPage() {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const signatureOf = el => {
    const read = (node, pseudo) => { const s = getComputedStyle(node, pseudo); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderBottomColor, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine, s.content].join('~'); };
    const child = el.firstElementChild;
    return [read(el), read(el, '::before'), read(el, '::after'), child ? read(child) : ''].join('#');
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
  const previous = window.__guardianFocus;
  const previousLooksDifferent = previous && previous.el.isConnected ? previous.signature !== signatureOf(previous.el) : null;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    window.__guardianFocus = null;
    return {atBody: true, previousLooksDifferent};
  }
  window.__guardianFocus = {el, signature: signatureOf(el)};
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let covered = false;
  if (y >= 0 && y < innerHeight && x >= 0 && x < innerWidth) {
    const top = document.elementFromPoint(x, y);
    // Only a fixed or sticky bar hides focus. A card's own overlay layers are not obstructions.
    const pinned = node => { for (let n = node; n && n !== document.body; n = n.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(n).position)) return true; return false; };
    covered = !!top && top !== el && !el.contains(top) && !top.contains(el) && pinned(top) && !pinned(el);
  }
  const region = el.closest('dialog,[role=dialog],[aria-modal=true]') ? 'dialog' : el.closest('nav,[role=navigation]') ? 'nav' : el.closest('header,[role=banner]') ? 'header' : el.closest('footer,[role=contentinfo]') ? 'footer' : el.closest('aside') ? 'aside' : 'main';
  return {
    atBody: false, previousLooksDifferent,
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', name: clean(el.getAttribute('aria-label') || el.innerText || el.title || el.placeholder).slice(0, 70),
    css: cssPath(el), region, tabindex: el.getAttribute('tabindex'), href: el.getAttribute('href') || '', covered,
    rect: {x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height)},
  };
}

/** Presses Tab through the page and records every stop, as a keyboard user would meet them. */
export async function tabWalk(page, {maxTabs = 60, settleMs = 100} = {}) {
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); window.__guardianFocus = null; });
  const stops = [];
  let ended = false, trap = null, revisits = 0;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(settleMs);
    const stop = await page.evaluate(readFocusInPage);
    if (stops.length && stop.previousLooksDifferent !== null && stops.at(-1).focusVisible === undefined) stops.at(-1).focusVisible = stop.previousLooksDifferent;
    if (stop.atBody) { ended = true; break; }
    // A real wrap passes through the document first (handled above), so a revisit here is a cycle.
    const seen = stops.findIndex(s => s.css === stop.css);
    if (seen >= 0) {
      if (stops[seen].tag === 'iframe') continue; // focus moving inside an embedded frame
      if (++revisits >= 4) { trap = {at: stops[seen].name || stops[seen].css, cycle: stops.length - seen}; break; }
      continue;
    }
    revisits = 0;
    stops.push(stop);
  }
  return {stops, ended, trap, maxTabs};
}

export function analyzeTabWalk(walk, {viewportHeight}) {
  const {stops} = walk;
  const jumps = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (a.region === b.region && b.rect.y < a.rect.y - Math.max(120, viewportHeight * 0.5) && b.rect.x <= a.rect.x + 40) jumps.push({from: a.name, to: b.name, up: a.rect.y - b.rect.y});
  }
  const firstMain = stops.findIndex(s => s.region === 'main' && !/^#/.test(s.href));
  return {
    stops: stops.length, completed: walk.ended, trap: walk.trap,
    notVisible: stops.filter(s => s.focusVisible === false).map(s => ({name: s.name || s.css, rect: s.rect})).slice(0, 12), notVisibleCount: stops.filter(s => s.focusVisible === false).length,
    obscured: stops.filter(s => s.covered).map(s => s.name || s.css).slice(0, 8),
    positiveTabindex: stops.filter(s => Number(s.tabindex) > 0).map(s => s.name || s.css).slice(0, 8),
    orderJumps: jumps.slice(0, 8),
    tabsToMain: firstMain < 0 ? null : firstMain + 1,
    skipLink: stops.slice(0, 3).some(s => /^#/.test(s.href) && /skip|springe|zum inhalt|to (main|content)/i.test(s.name)),
    sample: stops.slice(0, 20).map(s => s.name || s.tag),
  };
}

/** Finds things that look clickable to a mouse but that the keyboard cannot reach. */
export async function pointerOnlyControls(page) {
  return page.evaluate(() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const interactive = 'a[href],button,input,select,textarea,summary,label,[tabindex],[contenteditable]';
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.matches(interactive) || el.closest(interactive) || el.querySelector(interactive)) continue;
      if (getComputedStyle(el.parentElement).cursor === 'pointer') continue;
      const name = clean(el.innerText || el.getAttribute('aria-label')).slice(0, 60);
      if (name) found.push({name, rect: {x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height)}});
      if (found.length >= 12) break;
    }
    return found;
  });
}

/** Describes an overlay that has opened, whether or not it is marked up as a dialog. */
export async function findOverlay(page) {
  return page.evaluate(() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const shown = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 50 && r.height > 50 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const semantic = [...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]')].find(shown);
    let el = semantic;
    if (!el) {
      el = [...document.querySelectorAll('body *')].find(node => {
        if (getComputedStyle(node).position !== 'fixed' || !shown(node) || window.__guardianFixedBefore?.has(node)) return false;
        const r = node.getBoundingClientRect();
        return r.width * r.height >= innerWidth * innerHeight * 0.25 && (node.innerText || '').trim().length > 0;
      });
    }
    if (!el) return null;
    window.__guardianOverlay = el;
    const labelled = el.getAttribute('aria-labelledby');
    return {semantic: !!semantic, modal: el.tagName === 'DIALOG' ? el.matches(':modal') : el.getAttribute('aria-modal') === 'true', name: clean(el.getAttribute('aria-label') || (labelled && document.getElementById(labelled)?.innerText)).slice(0, 60), focusInside: el.contains(document.activeElement)};
  });
}

/** Remembers which fixed elements are already showing, so a new overlay stands out. */
export async function rememberFixedElements(page) {
  await page.evaluate(() => {
    const shown = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    window.__guardianFixedBefore = new Set([...document.querySelectorAll('body *')].filter(n => getComputedStyle(n).position === 'fixed' && shown(n)));
  });
}

/** Tabs inside an open overlay, then tests Escape and where focus lands afterwards. */
export async function testDialog(page, triggerCss, {tabs = 12, settleMs = 120} = {}) {
  await page.waitForTimeout(500);
  const result = {focusMoved: await page.evaluate(() => !!window.__guardianOverlay?.contains(document.activeElement)), escapedFocus: 0, tabsTried: 0, escapeCloses: null, focusRestored: null};
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(settleMs);
    result.tabsTried++;
    // Focus briefly on the document itself is the browser's own edge of a focus cycle, not an escape.
    if (await page.evaluate(() => document.activeElement !== document.body && !window.__guardianOverlay?.contains(document.activeElement))) result.escapedFocus++;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  result.escapeCloses = await page.evaluate(() => {
    const el = window.__guardianOverlay;
    if (!el || !el.isConnected) return true;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0 || r.left >= innerWidth || r.right <= 0;
  });
  if (result.escapeCloses) result.focusRestored = await page.evaluate(css => { const t = document.querySelector(css); return !!t && (t === document.activeElement || t.contains(document.activeElement)); }, triggerCss);
  return result;
}

/** How a control looks, to tell whether activating it changed its appearance. */
export function controlAppearance(page, css) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {look: [s.backgroundColor, s.color, s.borderTopColor, s.fontWeight].join('~'), pressed: ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-expanded', 'aria-current'].some(a => el.hasAttribute(a))};
  }, css).catch(() => null);
}

export async function focusIsLost(page) {
  return page.evaluate(() => document.activeElement === document.body || document.activeElement === null || !document.activeElement.isConnected);
}

/** Reads the browser's accessibility tree, which is what assistive technology is given. */
export async function readAccessibilityTree(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');
    return summarizeAxTree(nodes);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

const LANDMARKS = ['main', 'navigation', 'banner', 'contentinfo', 'search', 'complementary'];

export function summarizeAxTree(nodes) {
  const live = nodes.filter(n => !n.ignored);
  const roleOf = n => n.role?.value;
  const property = (n, name) => n.properties?.find(p => p.name === name)?.value?.value;
  const landmarks = Object.fromEntries(LANDMARKS.map(role => [role, live.filter(n => roleOf(n) === role).length]));
  const headings = live.filter(n => roleOf(n) === 'heading').map(n => ({level: Number(property(n, 'level')) || 0, name: String(n.name?.value || '').slice(0, 60)}));
  const skips = [];
  for (let i = 1; i < headings.length; i++) if (headings[i].level > headings[i - 1].level + 1) skips.push({from: headings[i - 1].level, to: headings[i].level, at: headings[i].name});
  return {nodes: live.length, landmarks, headingCount: headings.length, h1Count: headings.filter(h => h.level === 1).length, headingSkips: skips.slice(0, 6), liveRegions: live.filter(n => ['status', 'alert', 'log'].includes(roleOf(n)) || ['polite', 'assertive'].includes(property(n, 'live'))).length};
}
