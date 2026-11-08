import fs from 'node:fs';
import path from 'node:path';
import {chromium,devices} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {isAllowedUrl,cleanText,safeFilename} from './security.mjs';
import {loadMemory,nextPriority,saveMemory} from './memory.mjs';
import {inventoryPage,runAction,basicSignals} from './browser.mjs';
import {finding,saveReport} from './report.mjs';
import {planExploration,evaluateEvidence} from './claude.mjs';
import {nextScreeningPlausibility} from './showtimes.mjs';

const argv=process.argv.slice(2);
function flag(name, fallback) {const i=argv.indexOf(name);return i<0?fallback:argv[i+1]||fallback;}
const configFile=flag('--config','sites/ov-berlin.json');
const mode=flag('--mode','smoke');
if(!['smoke','intelligent'].includes(mode))throw new Error('Mode must be smoke or intelligent');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(!isAllowedUrl(config.url,config))throw new Error('Invalid target website URL/allowlist');
const out=flag('--out','out');
fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
const memory=loadMemory();
const startedAt=new Date().toISOString();
const report={config:{name:config.name,url:config.url,timezone:config.timezone},mode,startedAt,finishedAt:null,status:'RUNNING',actions:[],findings:[],screenshots:[],visitedPaths:[],suggestions:[],errors:[],sourceAccuracy:'NOT_VERIFIED'};
let actionId=0;
let remaining=Math.max(1,Math.min(config.maxActions||18,50));
let browser;
let shotCounter=0;
const timeout=setTimeout(()=>{console.error('Audit exceeded maximum runtime');process.exitCode=2;browser?.close().catch(()=>{});},(config.maxRunMinutes||15)*60000);

function record(device,type,target,result) {
  const id=`A${String(++actionId).padStart(3,'0')}`;
  report.actions.push({id,device,type,target,outcome:result.ok?'PASS':`SKIPPED/ERROR: ${cleanText(result.reason,110)}`,after:result.after||null});
  if (result.after?.url) {
    try {const p=new URL(result.after.url).pathname;if(!report.visitedPaths.includes(p))report.visitedPaths.push(p);} catch {}
  }
  return id;
}
function addFinding(args){ const f=finding(args); if(!report.findings.some(x=>x.fingerprint===f.fingerprint))report.findings.push(f); }
async function screenshot(page,device,stage) {
  if(shotCounter >= (config.screenshotLimit||12)) return;
  const file=`screenshots/${String(++shotCounter).padStart(2,'0')}-${safeFilename(device)}-${safeFilename(stage)}.png`;
  try {await page.screenshot({path:path.join(out,file),fullPage:false,animations:'disabled',timeout:10000});report.screenshots.push(file);} catch(e){report.errors.push(`Screenshot failed: ${cleanText(e.message)}`);}
}
async function signals(page,device,step) {
  const observed=await basicSignals(page);
  if (observed.overflow) addFinding({kind:'layout-overflow',title:'Page content overflows viewport horizontally',severity:'P2',device,stepId:step,evidence:{url:page.url(),width:observed.width,documentWidth:observed.documentWidth}});
  if (observed.brokenImages.length) addFinding({kind:'broken-image',title:'One or more images failed to load',severity:'P2',device,stepId:step,evidence:{url:page.url(),images:observed.brokenImages}});
  if (observed.bookingLinks.length) {
    report.bookingLinksObserved=(report.bookingLinksObserved||0)+observed.bookingLinks.length;
    const invalid=observed.bookingLinks.filter(x=>!/^https?:\/\//.test(x.href));
    if(invalid.length)addFinding({kind:'invalid-booking-url',title:'Booking link has no valid HTTP(S) destination',severity:'P1',device,stepId:step,evidence:{url:page.url(),invalid}});
  }
  if(/\/movies\//.test(new URL(page.url()).pathname)){
    const shown=await page.locator('body').innerText({timeout:4000});
    const plausibility=nextScreeningPlausibility(shown,new Date(),config.timezone);
    if(plausibility.status==='PAST_NEXT_SHOWTIME')addFinding({kind:'past-next-screening',title:'Movie page labels a past screening as next',severity:'P1',device,stepId:step,evidence:{url:page.url(),...plausibility,note:'UI clock plausibility; NOT independent cinema-source verification'}});
  }
}
async function runNamed(page,device,action) {
  if (remaining <= 0) return;
  const inv=await inventoryPage(page,config);
  const result=await runAction(page,action,inv,config);
  const id=record(device,action.type,action.target,result);
  remaining--;
  if (result.ok) await signals(page,device,id);
  return result;
}
async function auditDevice(deviceName) {
  const device = deviceName==='mobile' ? {...devices['iPhone 13'],isMobile:true} : {viewport:{width:1440,height:900},deviceScaleFactor:1};
  const context=await browser.newContext({...device,locale:'en-GB',timezoneId:config.timezone,acceptDownloads:false,permissions:[]});
  const page=await context.newPage();
  const jsErrors=[];const failedRequests=[];
  page.on('pageerror',e=>{if(jsErrors.length<12)jsErrors.push(cleanText(e.message,250));});
  page.on('requestfailed',req=>{if(failedRequests.length<12)failedRequests.push({url:req.url().slice(0,130),reason:req.failure()?.errorText});});
  await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  try {
    const response=await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1600);
    record(deviceName,'navigate',config.url,{ok:!!response?.ok(),after:{url:page.url(),title:await page.title()}});
    if (!response?.ok()) addFinding({kind:'page-http',title:`Landing page returned HTTP ${response?.status()||'unknown'}`,severity:'P1',device:deviceName,evidence:{url:config.url,status:response?.status()}});
    await signals(page,deviceName,'initial');
    await screenshot(page,deviceName,'home');
    const inv=await inventoryPage(page,config);
    if(!inv.heading.length) addFinding({kind:'document-heading',title:'No visible page heading found',severity:'P2',device:deviceName,evidence:{url:page.url()}});
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze().catch(e=>({violations:[],error:e.message}));
    if(axe.error) report.errors.push(`Accessibility scan failed on ${deviceName}: ${axe.error}`);
    for(const v of (axe.violations||[]).slice(0,12)) {
      addFinding({kind:`accessibility-${v.id}`,title:`Accessibility: ${v.help}`,severity:(v.impact==='critical'||v.impact==='serious')?'P1':'P2',device:deviceName,evidence:{url:page.url(),impact:v.impact,rule:v.id,description:v.description,selectors:v.nodes.slice(0,4).map(x=>x.target)}});
    }
    // Deterministic high-value journeys. No booking clicks or state-altering actions.
    const planned=nextPriority(memory,[...(config.filters||[]).map(target=>({type:'click',target})),...(config.views||[]).map(target=>({type:'view',target}))].map(a=>`${deviceName}:${a.type}:${a.target}`));
    for (const key of planned.slice(0,deviceName==='mobile'?4:7)) {
      const parts=key.split(':');
      await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:25000});
      await page.waitForTimeout(450);
      await runNamed(page,deviceName,{type:parts[1],target:parts.slice(2).join(':')});
    }
    if(deviceName==='desktop'){
      for(const query of (config.searchQueries||[]).slice(0,2)){
        await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:25000});
        await runNamed(page,deviceName,{type:'search',target:query});
      }
      await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:25000});
      const details=(await inventoryPage(page,config)).internalLinks.filter(x=>/\/movies\//.test(x.href));
      if(details.length) {await runNamed(page,deviceName,{type:'open_detail',target:details[0].text});await screenshot(page,deviceName,'movie-details');}
    }
    await screenshot(page,deviceName,'after-journeys');
    if(mode==='intelligent' && deviceName==='desktop') {
      // Two bounded AI planning rounds; the planner sees data, not browser or shell tools.
      for(let round=0;round<Math.min(2,config.maxAiRounds||2)&&remaining>0;round++){
        const inventory=await inventoryPage(page,config);
        try {
          const plan=await planExploration({config,memory,inventory,pastActions:report.actions,remaining});
          let executed=0;
          for(const action of (plan.actions||[]).slice(0,Math.min(6,remaining))){
            const r=await runNamed(page,deviceName,action);
            if(r?.ok) executed++;
          }
          if(!executed){report.errors.push(`AI round ${round+1}: no executable safe actions; stopped`);break;}
          await screenshot(page,deviceName,`ai-round-${round+1}`);
        } catch(e){report.errors.push(`Claude exploration unavailable: ${cleanText(e.message,250)}`);break;}
      }
    }
    if(jsErrors.length) addFinding({kind:'javascript-error',title:'Uncaught JavaScript errors during user journeys',severity:'P1',device:deviceName,evidence:{url:page.url(),errors:jsErrors}});
    if(failedRequests.length) report.networkSignals=(report.networkSignals||[]).concat([{device:deviceName,failedRequests}]); // signals need investigation, not all are defects
  } catch(e){report.errors.push(`${deviceName} browser test failed: ${cleanText(e.message,350)}`);}
  finally{
    try{await context.tracing.stop({path:path.join(out,`trace-${deviceName}.zip`)});}catch{}
    await context.close();
  }
}

try {
  console.log(`Starting ${mode} audit of ${config.url}`);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const device of config.devices||['desktop','mobile']) await auditDevice(device);
  if(mode==='intelligent' && report.actions.length) {
    try {
      const evaluation=await evaluateEvidence({config,results:report});
      report.aiSummary=cleanText(evaluation.summary,600);
      const validIds=new Set(report.actions.map(x=>x.id));
      report.suggestions=(evaluation.suggestions||[]).filter(x=>validIds.has(x.evidenceStep)).slice(0,5);
    } catch(e) {report.errors.push(`Claude UX evaluation unavailable: ${cleanText(e.message,250)}`);}
  }
  const previous=new Set((memory.lastFindings||[]).map(x=>x.fingerprint));
  for (const f of report.findings) f.trend=previous.has(f.fingerprint)?'REPEATED':'NEW';
  report.priorIssuesNotObserved=(memory.lastFindings||[]).filter(x=>!report.findings.some(y=>y.fingerprint===x.fingerprint)).map(x=>x.title).slice(0,20);
  report.status=!report.actions.length ? 'NO_ACTIONS' : report.errors.length ? 'COMPLETED_WITH_LIMITATIONS' : 'COMPLETED';
} catch(e) {report.status='FAILED';report.errors.push(cleanText(e.message,400));process.exitCode=1;}
finally {
  clearTimeout(timeout);
  if(browser)await browser.close().catch(()=>{});
  report.finishedAt=new Date().toISOString();
  saveReport(report,out);
  saveMemory(memory,report);
  console.log(`Audit finished: ${report.actions.length} actions, ${report.findings.length} confirmed findings, ${report.errors.length} limitations. Report: ${out}/site/index.html`);
}
