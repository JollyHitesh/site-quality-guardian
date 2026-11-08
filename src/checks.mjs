// Measures usability signals in the page, then turns the raw numbers into findings.
// The two halves are separate so the rules can be unit-tested without a browser.

const MIN_TARGET = 24; // WCAG 2.2 AA, success criterion 2.5.8
const COMFORT_TARGET = 44; // Apple HIG and WCAG 2.5.5 AAA
const IOS_NO_ZOOM_FONT = 16;
const MIN_READABLE_FONT = 12;
const MAX_STICKY_SHARE = 0.3;
const MAX_STICKY_SHARE_LANDSCAPE = 0.5;

export function templateOf(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return `/${parts[0] || ''}`;
  return `/${parts[0]}/:slug`;
}

/* Runs inside the page, so it can only use its arguments and browser globals. */
function collectInPage({viewportWidth, primaryPattern}) {
  const primary = new RegExp(primaryPattern, 'i');
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const describe = el => {
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (classes ? `.${classes}` : '');
  };
  const docRect = r => ({x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height)});
  const labelOf = el => clean(el.getAttribute('aria-label') || el.innerText || el.title || el.placeholder).slice(0, 60);
  const clippedByAncestor = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };

  const all = [...document.querySelectorAll('body *')];
  const docWidth = document.documentElement.scrollWidth;

  let overflowOffenders = [];
  if (docWidth > viewportWidth + 2) {
    const found = all.filter(el => el.getBoundingClientRect().right > viewportWidth + 2 && visible(el) && !clippedByAncestor(el));
    overflowOffenders = found.filter(a => !found.some(b => b !== a && a.contains(b))).slice(0, 6)
      .map(el => ({element: describe(el), right: Math.round(el.getBoundingClientRect().right), rect: docRect(el.getBoundingClientRect())}));
  }

  const controls = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],summary,select,textarea,input:not([type=hidden])')]
    .filter(visible).filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < viewportWidth && r.right > 0 && !el.disabled;
    });
  const isInlineLink = el => el.tagName === 'A' && getComputedStyle(el).display === 'inline'
    && clean(el.parentElement?.innerText).length > clean(el.innerText).length + 15;
  const rects = controls.map(el => el.getBoundingClientRect());
  const crowded = (el, r) => {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, half = 12;
    return controls.some((other, i) => {
      if (other === el || other.contains(el) || el.contains(other)) return false;
      const o = rects[i];
      return o.left < cx + half && o.right > cx - half && o.top < cy + half && o.bottom > cy - half;
    });
  };
  const tapTargets = controls
    .filter(el => !isInlineLink(el))
    .map(el => ({el, r: el.getBoundingClientRect()}))
    .filter(({r}) => r.width < 44 || r.height < 44)
    .map(({el, r}) => ({
      label: labelOf(el),
      element: describe(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      rect: docRect(r),
      primary: primary.test(labelOf(el)),
      crowded: r.width < 24 || r.height < 24 ? crowded(el, r) : false,
    }));

  const textFields = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]),select,textarea')]
    .filter(visible)
    .map(el => ({label: labelOf(el), element: describe(el), fontSize: parseFloat(getComputedStyle(el).fontSize), rect: docRect(el.getBoundingClientRect())}));

  const smallText = [];
  let smallTextCount = 0;
  for (const el of all) {
    const own = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
    if (own.length < 3 || !visible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) {
      smallTextCount++;
      if (smallText.length < 6) smallText.push({text: own.slice(0, 50), fontSize: size, element: describe(el)});
    }
  }

  const images = [...document.images];
  const dpr = window.devicePixelRatio || 1;
  const anchors = [...document.querySelectorAll('a[href]')];
  const bookingLinks = anchors.filter(a => primary.test(clean(a.innerText) + ' ' + (a.getAttribute('aria-label') || '')));

  return {
    url: location.href,
    viewportWidth,
    docWidth,
    overflowOffenders,
    headings: [...document.querySelectorAll('h1,h2')].filter(visible).map(el => clean(el.innerText).slice(0, 80)).slice(0, 12),
    textLength: clean(document.body.innerText).length,
    bodyStart: clean(document.body.innerText).slice(0, 400),
    tapTargets,
    textFields,
    smallText,
    smallTextCount,
    brokenImages: images.filter(i => i.complete && i.naturalWidth === 0 && i.currentSrc).slice(0, 10)
      .map(i => ({alt: i.alt || '', url: i.currentSrc.slice(0, 180)})),
    oversizedImages: images.filter(i => {
      const shown = i.getBoundingClientRect().width;
      return i.complete && shown > 40 && i.naturalWidth > 600 && i.naturalWidth > shown * dpr * 2.5;
    }).slice(0, 8).map(i => ({url: (i.currentSrc || '').slice(0, 180), naturalWidth: i.naturalWidth, shownWidth: Math.round(i.getBoundingClientRect().width)})),
    bookingLinkCount: bookingLinks.length,
    invalidBookingLinks: bookingLinks.filter(a => {
      const raw = (a.getAttribute('href') || '').trim();
      return !raw || raw === '#' || !/^https?:/.test(a.href);
    }).slice(0, 10).map(a => ({text: clean(a.innerText).slice(0, 70), href: a.getAttribute('href')})),
  };
}

export async function collectSignals(page, {primaryPattern}) {
  const viewportWidth = page.viewportSize().width;
  return page.evaluate(collectInPage, {viewportWidth, primaryPattern});
}

/** Scrolls through the page so lazy images load before they are inspected. */
export async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, window.innerHeight);
    for (let i = 0, y = 0; i < 30 && y < document.documentElement.scrollHeight; i++, y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 70));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

/** Measures how much of the screen stays covered by fixed and sticky bars once scrolled. */
export async function measureSticky(page) {
  return page.evaluate(async () => {
    window.scrollTo(0, Math.min(800, document.documentElement.scrollHeight - window.innerHeight));
    await new Promise(r => setTimeout(r, 300));
    const vh = window.innerHeight;
    const bars = [...document.querySelectorAll('body *')].flatMap(el => {
      const s = getComputedStyle(el);
      if (!['fixed', 'sticky'].includes(s.position) || s.visibility === 'hidden' || s.display === 'none') return [];
      const r = el.getBoundingClientRect();
      const top = Math.max(0, r.top), bottom = Math.min(vh, r.bottom);
      if (bottom - top < 8 || bottom - top > vh * 0.9 || r.width < window.innerWidth * 0.5) return [];
      return [{top, bottom, element: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '')}];
    });
    let covered = 0, edge = 0;
    for (const b of [...bars].sort((x, y) => x.top - y.top)) {
      covered += Math.max(0, b.bottom - Math.max(b.top, edge));
      edge = Math.max(edge, b.bottom);
    }
    window.scrollTo(0, 0);
    return {coveredPx: Math.round(covered), viewportHeight: vh, share: Number((covered / vh).toFixed(2)), bars: bars.slice(0, 6).map(b => ({element: b.element, height: Math.round(b.bottom - b.top)}))};
  });
}

function groupTargets(targets) {
  const groups = new Map();
  for (const t of targets) {
    const key = `${t.label}|${t.w}x${t.h}`;
    if (!groups.has(key)) groups.set(key, {label: t.label || '(no label)', size: `${t.w}×${t.h}`, count: 0, element: t.element});
    groups.get(key).count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 12);
}

const rectsOf = items => items.slice(0, 15).map(x => x.rect);

export function analyzeTapTargets(tapTargets) {
  const findings = [];
  const tooSmall = tapTargets.filter(t => (t.w < MIN_TARGET || t.h < MIN_TARGET) && t.crowded);
  const smallPrimary = tapTargets.filter(t => t.primary && !tooSmall.includes(t) && (t.w < COMFORT_TARGET || t.h < COMFORT_TARGET));
  const comfort = tapTargets.filter(t => !t.primary && !tooSmall.includes(t) && t.h < COMFORT_TARGET && t.h >= MIN_TARGET);
  if (tooSmall.length) {
    findings.push({kind: 'tap-target-too-small', title: `Touch targets below the ${MIN_TARGET}px minimum and crowded by neighbours`, severity: 'P2', evidence: {total: tooSmall.length, targets: groupTargets(tooSmall)}, highlight: rectsOf(tooSmall)});
  }
  if (smallPrimary.length) {
    findings.push({kind: 'primary-tap-target-small', title: `Main call-to-action links are under ${COMFORT_TARGET}px tall on phones`, severity: 'P2', evidence: {total: smallPrimary.length, targets: groupTargets(smallPrimary)}, highlight: rectsOf(smallPrimary)});
  }
  if (comfort.length) {
    findings.push({kind: 'tap-target-comfort', title: `Touch targets under the recommended ${COMFORT_TARGET}px height`, severity: 'P3', evidence: {total: comfort.length, targets: groupTargets(comfort)}, highlight: rectsOf(comfort)});
  }
  return findings;
}

export function analyzeSticky(sticky, {landscape = false} = {}) {
  if (!sticky) return [];
  const limit = landscape ? MAX_STICKY_SHARE_LANDSCAPE : MAX_STICKY_SHARE;
  if (sticky.share <= limit) return [];
  const where = landscape ? 'in landscape' : 'on phones';
  return [{kind: landscape ? 'sticky-coverage-landscape' : 'sticky-coverage', title: `Sticky bars cover more than ${Math.round(limit * 100)}% of the screen ${where}`, severity: 'P2', evidence: sticky}];
}

export function analyzeSignals(raw, {family, isLanding = false}) {
  const findings = [];
  const mobile = family === 'mobile';

  if (raw.textLength < 40) {
    findings.push({kind: 'blank-page', title: 'Page rendered with almost no content', severity: isLanding ? 'P0' : 'P1', evidence: {url: raw.url, textLength: raw.textLength}});
    return findings;
  }
  if (raw.textLength < 600 && /application error|something went wrong|page not found|seite nicht gefunden|internal server error/i.test(raw.bodyStart)) {
    findings.push({kind: 'soft-error-page', title: 'Page shows an error message while returning HTTP success', severity: 'P1', evidence: {url: raw.url, text: raw.bodyStart.slice(0, 200)}});
  }
  if (raw.docWidth > raw.viewportWidth + 2) {
    findings.push({kind: 'layout-overflow', title: 'Content is wider than the screen, causing sideways scrolling', severity: mobile ? 'P1' : 'P2', evidence: {viewportWidth: raw.viewportWidth, documentWidth: raw.docWidth, offenders: raw.overflowOffenders.map(({rect, ...o}) => o)}, highlight: raw.overflowOffenders.map(o => o.rect)});
  }
  if (!raw.headings.length) {
    findings.push({kind: 'document-heading', title: 'No visible page heading found', severity: 'P2', evidence: {url: raw.url}});
  }
  if (raw.brokenImages.length) {
    findings.push({kind: 'broken-image', title: 'One or more images failed to load', severity: 'P2', evidence: {images: raw.brokenImages}});
  }
  if (raw.invalidBookingLinks.length) {
    findings.push({kind: 'invalid-booking-url', title: 'Call-to-action link has no valid destination', severity: 'P1', evidence: {invalid: raw.invalidBookingLinks}});
  }
  if (mobile) {
    findings.push(...analyzeTapTargets(raw.tapTargets));
    const zooming = raw.textFields.filter(f => f.fontSize < IOS_NO_ZOOM_FONT);
    if (zooming.length) {
      findings.push({kind: 'input-zoom-ios', title: `Form fields under ${IOS_NO_ZOOM_FONT}px make iPhones zoom in on focus`, severity: 'P2', evidence: {fields: zooming.slice(0, 6).map(({rect, ...f}) => f)}, highlight: rectsOf(zooming)});
    }
    if (raw.smallTextCount) {
      findings.push({kind: 'small-text', title: `Text smaller than ${MIN_READABLE_FONT}px is hard to read on phones`, severity: 'P3', evidence: {total: raw.smallTextCount, samples: raw.smallText}});
    }
    if (raw.oversizedImages.length) {
      findings.push({kind: 'oversized-image', title: 'Images are far larger than their on-screen size', severity: 'P3', evidence: {images: raw.oversizedImages}});
    }
  }
  return findings;
}
