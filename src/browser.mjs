import {isAllowedUrl, safeAction, policyAllows, cleanText, DENIED_LABEL} from './security.mjs';

const EMPTY_RESULTS = /\b(no (results|movies|films|screenings|showtimes|matches)|nothing found|keine (ergebnisse|treffer|filme|vorstellungen))\b/i;

/** Waits for hydration and data fetches, so clicks reach a page that can respond. */
export async function settle(page, timeout = 4000) {
  await page.waitForLoadState('networkidle', {timeout}).catch(() => {});
}

export async function inventoryPage(page, config) {
  const raw = await page.evaluate(() => {
    const visible = el => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
    const text = x => (x || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return {
      title: document.title,
      heading: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0, 12).map(x => text(x.innerText)),
      buttons: [...document.querySelectorAll('button,[role="button"]')].filter(visible).map(x => text(x.getAttribute('aria-label') || x.innerText || x.title)).filter(Boolean),
      internalLinks: [...document.querySelectorAll('a[href]')].filter(visible).map(x => ({text: text(x.getAttribute('aria-label') || x.innerText || x.title), href: x.href})).filter(x => x.text),
      inputs: [...document.querySelectorAll('input')].filter(visible).map(x => ({placeholder: text(x.placeholder), type: x.type, ariaLabel: text(x.getAttribute('aria-label'))})).slice(0, 30),
      bodyText: text(document.body.innerText || '').slice(0, 3800),
      dimensions: {width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth},
    };
  });
  raw.buttons = [...new Set(raw.buttons)].slice(0, 200);
  raw.internalLinks = raw.internalLinks.filter(x => isAllowedUrl(x.href, config)).slice(0, 400);
  raw.url = page.url();
  return raw;
}

function visibleButton(page, name) {
  return page.getByRole('button', {name, exact: true}).filter({visible: true}).first();
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

async function waitForChange(page, before, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await stateSignature(page) !== before) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Tries each configured drawer or menu button until the target control appears. */
async function revealControl(page, target, inventory, config) {
  for (const label of config.revealButtons || []) {
    if (DENIED_LABEL.test(label) || !inventory.buttons.includes(label)) continue;
    const opened = await visibleButton(page, label).click({timeout: 5000}).then(() => true, () => false);
    if (opened) {
      await page.waitForTimeout(400);
      const revealed = await inventoryPage(page, config);
      if (revealed.buttons.includes(target)) return {via: label, inventory: revealed};
    }
    await page.reload({waitUntil: 'domcontentloaded', timeout: 20000});
    await settle(page);
  }
  return null;
}

async function closeRevealed(page, config) {
  for (const label of config.revealCloseButtons || []) {
    const button = visibleButton(page, label);
    if (await button.count()) {
      await button.click({timeout: 4000}).catch(() => {});
      await page.waitForTimeout(250);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
}

async function openLink(page, target, candidate) {
  const link = page.getByRole('link', {name: target, exact: true}).filter({visible: true}).first();
  if (await link.count()) {
    const tapped = await link.click({timeout: 8000}).then(() => true, () => false);
    if (tapped) { await settle(page); return 'tap'; }
  }
  await page.goto(candidate.href, {waitUntil: 'domcontentloaded', timeout: 25000});
  await settle(page);
  return 'goto';
}

async function runSearch(page, query, config) {
  const pattern = new RegExp(config.searchPlaceholderPattern || 'Try|Search|Suche', 'i');
  let input = page.getByPlaceholder(pattern).filter({visible: true}).first();
  if (await input.count() === 0) input = page.locator('input[type="search"]').filter({visible: true}).first();
  if (await input.count() === 0) return false;
  await input.fill(query, {timeout: 7000});
  await input.press('Enter', {timeout: 7000}).catch(() => {});
  return true;
}

function classifyFailure(message) {
  return /intercepts pointer events/.test(message) ? 'obscured' : 'error';
}

/**
 * Executes one allowlisted action. `code` separates site problems from audit problems:
 * rejected (policy), missing (control absent), obscured (an overlay blocked it), error (anything else).
 * A successful click carries `changed: false` when nothing on the page responded.
 */
export async function runAction(page, action, inventory, config) {
  if (!policyAllows(action, config)) return {ok: false, code: 'rejected', reason: 'Action rejected by safety policy'};
  const before = page.url();
  let current = inventory;
  let via = null;
  const isButton = action.type === 'click' || action.type === 'view';
  try {
    if (isButton && !current.buttons.includes(action.target)) {
      const revealed = await revealControl(page, action.target, current, config);
      if (!revealed) return {ok: false, code: 'missing', reason: 'Control not found on this device'};
      current = revealed.inventory;
      via = revealed.via;
    }
    if (!safeAction(action, current, config)) {
      const code = action.type === 'open_detail' ? 'missing' : 'rejected';
      return {ok: false, code, reason: code === 'missing' ? 'Link not available' : 'Action rejected by safety policy'};
    }

    const signature = await stateSignature(page);
    let changed = null;
    if (action.type === 'back') {
      await page.goBack({waitUntil: 'domcontentloaded', timeout: 15000});
    }
    if (action.type === 'search') {
      if (!await runSearch(page, action.target, config)) return {ok: false, code: 'missing', reason: 'No search input found'};
      changed = await waitForChange(page, signature);
    }
    if (isButton) {
      const button = visibleButton(page, action.target);
      if (await button.count() === 0) return {ok: false, code: 'missing', reason: 'Button no longer visible'};
      const wasActive = await button.evaluate(el => ['aria-pressed', 'aria-selected', 'aria-checked'].some(a => el.getAttribute(a) === 'true') || el.hasAttribute('aria-current'));
      await button.click({timeout: 8000});
      changed = wasActive ? null : await waitForChange(page, signature);
      if (via) await closeRevealed(page, config);
    }
    let method = null;
    if (action.type === 'open_detail') {
      const candidate = current.internalLinks.find(x => x.text === action.target && isAllowedUrl(x.href, config));
      method = await openLink(page, action.target, candidate);
    }

    await page.waitForTimeout(config.rateLimitMs || 600);
    if (!isAllowedUrl(page.url(), config)) {
      await page.goto(config.url);
      return {ok: false, code: 'rejected', reason: 'Unexpected external navigation blocked'};
    }
    const after = await inventoryPage(page, config);
    return {
      ok: true,
      before,
      via,
      method,
      changed,
      emptyResults: EMPTY_RESULTS.test(after.bodyText),
      after: {url: after.url, title: after.title, headings: after.heading.slice(0, 4), bodyText: after.bodyText.slice(0, 350), buttons: after.buttons.slice(0, 18)},
    };
  } catch (e) {
    return {ok: false, code: classifyFailure(e.message), before, reason: cleanText(e.message, 180)};
  }
}
