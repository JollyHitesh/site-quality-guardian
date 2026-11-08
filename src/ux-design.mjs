// Measures visual design signals from the rendered page. These are facts about the layout.
// Whether a layout is good is decided by published thresholds or by a cited expert review.

/* Runs inside the page, so it can only use its arguments and browser globals. */
function collectDesignInPage({keyPattern, listingTop}) {
  const key = new RegExp(keyPattern, 'i');
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const docY = el => Math.round(el.getBoundingClientRect().top + scrollY);
  const rectOf = el => { const r = el.getBoundingClientRect(); return {x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height)}; };
  const labelOf = el => clean(el.getAttribute('aria-label') || el.innerText || el.title || el.placeholder).slice(0, 60);
  const inFirstView = el => { const y = docY(el), r = el.getBoundingClientRect(); return y < innerHeight && y + r.height > 0 && r.right > 0 && r.left < innerWidth; };
  window.scrollTo(0, 0);

  const texts = [];
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const own = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
    if (own.length < 2 || !visible(el)) continue;
    texts.push({el, chars: own.length, size: parseFloat(getComputedStyle(el).fontSize)});
  }
  const weight = {};
  for (const t of texts) weight[t.size] = (weight[t.size] || 0) + t.chars;
  const bodyFontPx = Number(Object.entries(weight).sort((a, b) => b[1] - a[1])[0]?.[0]) || null;
  const firstViewTexts = texts.filter(t => inFirstView(t.el));

  const h1s = [...document.querySelectorAll('h1')].filter(visible);
  const paragraphs = [...document.querySelectorAll('p,li')].filter(el => visible(el) && clean(el.innerText).length >= 120);
  const lengths = paragraphs.map(el => Math.round(el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).fontSize) * 0.5))).sort((a, b) => a - b);
  const firstParagraph = [...document.querySelectorAll('main p, main li, article p, p, li')].find(el => visible(el) && clean(el.innerText).length >= 80 && !el.closest('header,nav'));

  const interactive = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],select,input:not([type=hidden]),textarea,summary')].filter(visible);
  const buttons = [...document.querySelectorAll('button,[role=button]')].filter(visible);
  const styleOf = el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderRadius, s.fontSize, s.fontWeight, s.color].join('|'); };
  const styleCounts = {};
  for (const b of buttons) { const k = styleOf(b); styleCounts[k] = (styleCounts[k] || 0) + 1; }

  const transparent = c => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const lowAffordance = buttons.filter(el => {
    if (el.closest('nav,header,footer')) return false;
    const s = getComputedStyle(el);
    const noBorder = parseFloat(s.borderTopWidth) === 0 || transparent(s.borderTopColor);
    return transparent(s.backgroundColor) && noBorder && !s.textDecorationLine.includes('underline') && !el.querySelector('svg,img') && labelOf(el).length > 0;
  }).slice(0, 12).map(el => ({label: labelOf(el), rect: rectOf(el)}));

  const hoverReveals = [];
  const readRules = rules => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) { readRules(rule.cssRules); continue; }
      const selector = rule.selectorText;
      if (!selector || !selector.includes(':hover')) continue;
      for (const part of selector.split(',')) {
        if (!/:hover[^,]*[\s>+~]/.test(part.trim()) || selector.includes(':focus')) continue;
        const reveals = (rule.style.display && rule.style.display !== 'none') || rule.style.visibility === 'visible' || rule.style.opacity === '1';
        if (!reveals) continue;
        let target = null;
        try { target = document.querySelector(part.replace(/:hover/g, '').trim()); } catch { /* unusual selector */ }
        if (target && (target.matches('a,button') || target.querySelector('a,button')) && hoverReveals.length < 10) hoverReveals.push(part.trim().slice(0, 100));
      }
    }
  };
  for (const sheet of document.styleSheets) { try { readRules(sheet.cssRules); } catch { /* cross-origin sheet */ } }

  const destinations = new Map();
  const navPaths = new Set();
  for (const a of document.querySelectorAll('nav a[href], header a[href], [role=navigation] a[href]')) {
    if (!visible(a)) continue;
    let target;
    try { target = new URL(a.href); } catch { continue; }
    if (target.origin !== location.origin) continue;
    navPaths.add(target.pathname);
    const label = labelOf(a).toLowerCase();
    if (!label) continue;
    if (!destinations.has(label)) destinations.set(label, new Set());
    destinations.get(label).add(target.pathname);
  }

  const keyControls = interactive.filter(el => key.test(`${labelOf(el)} ${el.getAttribute('type') || ''}`)).slice(0, 12).map(el => ({label: labelOf(el), y: docY(el), inFirstView: inFirstView(el)}));
  const firstViewControls = interactive.filter(inFirstView).length;
  const firstViewNames = interactive.filter(inFirstView).map(el => labelOf(el).toLowerCase()).filter(n => n && !/\d/.test(n)).slice(0, 40).sort();
  const firstContentY = Number.isFinite(listingTop) ? listingTop : firstParagraph ? docY(firstParagraph) : null;

  return {
    url: location.href,
    viewport: {w: innerWidth, h: innerHeight},
    documentHeight: document.documentElement.scrollHeight,
    h1: h1s.length ? {count: h1s.length, fontSize: parseFloat(getComputedStyle(h1s[0]).fontSize), y: docY(h1s[0]), text: clean(h1s[0].innerText).slice(0, 80)} : {count: 0},
    bodyFontPx,
    maxFirstViewFontPx: Math.max(0, ...firstViewTexts.map(t => t.size)),
    lineLengthChars: lengths.length ? lengths[Math.floor(lengths.length / 2)] : null,
    firstView: {controls: firstViewControls, textChars: firstViewTexts.reduce((n, t) => n + t.chars, 0), fontSizes: new Set(firstViewTexts.map(t => t.size)).size},
    firstContentY,
    buttonStyles: Object.keys(styleCounts).length,
    lowAffordance,
    hoverReveals,
    keyControls,
    navConflicts: [...destinations.entries()].filter(([, set]) => set.size > 1).slice(0, 8).map(([label, set]) => ({label, destinations: [...set].slice(0, 4)})),
    navPaths: [...navPaths].slice(0, 40),
    signatureParts: {firstViewNames, h1Bucket: h1s.length ? Math.round(parseFloat(getComputedStyle(h1s[0]).fontSize) / 4) * 4 : 0, buttonStyles: Object.keys(styleCounts).length, nav: [...navPaths].sort().slice(0, 20)},
  };
}

export async function collectDesign(page, {keyPattern, listingTop = null}) {
  return page.evaluate(collectDesignInPage, {keyPattern, listingTop});
}
