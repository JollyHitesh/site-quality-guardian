import { isAllowedUrl, safeAction, cleanText, safeFilename } from './security.mjs';

export async function inventoryPage(page, config) {
  const raw = await page.evaluate(() => {
    const visible = el => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
    const text = x => (x || '').replace(/\s+/g,' ').trim().slice(0,100);
    return {
      title:document.title,
      heading: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0,12).map(x=>text(x.innerText)),
      buttons:[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(x=>text(x.getAttribute('aria-label')||x.innerText||x.title)).filter(Boolean).slice(0,100),
      internalLinks:[...document.querySelectorAll('a[href]')].filter(visible).map(x=>({text:text(x.getAttribute('aria-label')||x.innerText||x.title),href:x.href})).filter(x=>x.text).slice(0,100),
      inputs:[...document.querySelectorAll('input')].filter(visible).map(x=>({placeholder:text(x.placeholder),type:x.type,ariaLabel:text(x.getAttribute('aria-label'))})).slice(0,30),
      bodyText:text(document.body.innerText || '').slice(0,3800),
      dimensions:{width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}
    };
  });
  raw.buttons=[...new Set(raw.buttons)];
  raw.internalLinks=raw.internalLinks.filter(x=>isAllowedUrl(x.href, config));
  raw.url=page.url();
  return raw;
}

export async function runAction(page, action, inventory, config) {
  if (!safeAction(action,inventory,config)) return {ok:false,reason:'Action rejected by safety policy'};
  const before=page.url();
  try {
    if (action.type === 'back') await page.goBack({waitUntil:'domcontentloaded',timeout:15000});
    if (action.type === 'search') {
      let input=page.getByPlaceholder(/Try|Search movies|Search films|Search by/i).first();
      if (await input.count()===0) input=page.locator('input[type="search"]').first();
      if (await input.count()===0) return {ok:false,reason:'No safe movie-search input found'};
      await input.fill(action.target,{timeout:7000});
      await input.press('Enter',{timeout:7000}).catch(()=>{});
    }
    if (action.type === 'click' || action.type === 'view') {
      const button=page.getByRole('button',{name:action.target,exact:true}).first();
      if (await button.count()===0) return {ok:false,reason:'Button no longer visible'};
      await button.click({timeout:8000});
    }
    if (action.type === 'open_detail') {
      const candidate=inventory.internalLinks.find(x=>x.text===action.target && isAllowedUrl(x.href, config));
      if (!candidate) return {ok:false,reason:'Link no longer allowed'};
      await page.goto(candidate.href,{waitUntil:'domcontentloaded',timeout:25000});
    }
    await page.waitForTimeout(config.rateLimitMs || 600);
    if (!isAllowedUrl(page.url(),config)) { await page.goto(config.url);return {ok:false,reason:'Unexpected external navigation blocked'}; }
    const after=await inventoryPage(page,config);
    return {ok:true,before,after:{url:after.url,title:after.title,headings:after.heading.slice(0,4),bodyText:after.bodyText.slice(0,350),buttons:after.buttons.slice(0,18)}};
  } catch (e) {return {ok:false,before,reason:cleanText(e.message,180)};}
}

export async function basicSignals(page) {
  return await page.evaluate(() => {
    const overflow=document.documentElement.scrollWidth > window.innerWidth+3;
    const images=[...document.images].filter(i=>i.complete && i.naturalWidth===0).slice(0,8).map(i=>({alt:i.alt||'',url:(i.currentSrc||i.src||'').slice(0,180)}));
    const links=[...document.querySelectorAll('a[href]')];
    const booking=links.filter(a=>/tickets|book|buchen|reserv/i.test((a.innerText||'')+' '+(a.getAttribute('aria-label')||''))).slice(0,10).map(a=>({text:(a.innerText||'').trim().slice(0,70),href:a.href}));
    return {overflow,width:window.innerWidth,documentWidth:document.documentElement.scrollWidth,brokenImages:images,bookingLinks:booking};
  });
}
