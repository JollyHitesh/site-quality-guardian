import fs from 'node:fs';
import path from 'node:path';
import {safeFilename,cleanText} from './security.mjs';

export function finding({kind, title, severity='P2', status='CONFIRMED', evidence={}, device, stepId}) {
  const fingerprint=safeFilename(`${kind}-${device||'all'}-${title.toLowerCase()}`);
  return {id:fingerprint,fingerprint,kind,title,severity,status,device:device||null,stepId:stepId||null,evidence};
}

function esc(str) {return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

export function saveReport(report,out='out') {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  const lines=[`# ${report.config.name} — Quality Guardian audit`, '', `**Finished:** ${report.finishedAt}`,`**Mode:** ${report.mode}`,`**Status:** ${report.status}`,'',`**Steps executed:** ${report.actions.length}` ,`**Confirmed findings:** ${report.findings.filter(f=>f.status==='CONFIRMED').length}`,''];
  for (const f of report.findings) lines.push(`## ${f.severity}: ${f.title}`,`- Status: ${f.status}`,`- Device: ${f.device||'all'}`,`- Evidence: \`${JSON.stringify(f.evidence).slice(0,600)}\``,'');
  if (report.suggestions?.length) {
    lines.push('## AI suggestions (not confirmed defects)','');
    for (const s of report.suggestions) lines.push(`- **${cleanText(s.title)}** — evidence: ${s.evidenceStep}; ${cleanText(s.validationNeeded)}`);
  }
  if(report.errors?.length)lines.push('', '## Execution limitations', ...report.errors.map(x=>`- ${cleanText(x,500)}`));
  fs.writeFileSync(path.join(out,'report.md'),lines.join('\n')+'\n');

  const states=report.findings.filter(x=>x.status==='CONFIRMED');
  const actionTable=report.actions.slice(-100).map(a=>`<tr><td>${esc(a.id)}</td><td>${esc(a.device)}</td><td>${esc(a.type)}</td><td>${esc(a.target)}</td><td>${esc(a.outcome)}</td></tr>`).join('');
  const fItems=states.map(f=>`<article class="issue"><div><span class="sev">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong></div><p class="sub">${esc(f.device)} · ${esc(f.kind)} · ${esc(f.id)}</p><details><summary>Evidence and next steps</summary><pre>${esc(JSON.stringify(f.evidence,null,2))}</pre></details></article>`).join('') || '<p>No confirmed defects were recorded in this run. This is not a guarantee of zero defects.</p>';
  const suggestionItems=(report.suggestions||[]).map(s=>`<article class="issue"><strong>${esc(s.title)}</strong><p>${esc(s.userImpact)}</p><p class="sub">Evidence action: ${esc(s.evidenceStep)} · Needs validation: ${esc(s.validationNeeded)}</p></article>`).join('') || '<p>No AI usability hypotheses available for this run.</p>';
  const pictures=report.screenshots.map(file=>`<a href="${esc(file)}" rel="noopener"><img loading="lazy" src="${esc(file)}" alt="Audit evidence: ${esc(file)}"><small>${esc(file)}</small></a>`).join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.config.name)} QA report</title><style>
  :root{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color-scheme:light dark}body{max-width:1100px;margin:0 auto;padding:24px;line-height:1.5}header{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:center}h1{font-size:1.75rem;margin:0}.sub{color:gray;font-size:.86rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0}.metric,.issue{border:1px solid #92929260;border-radius:12px;padding:16px}.metric b{font-size:1.9rem;display:block}.issue{margin:10px 0}.sev{display:inline-block;background:#d8a443;color:#161616;padding:2px 6px;border-radius:5px;font-size:.75rem;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#8882;padding:12px;border-radius:7px}table{width:100%;border-collapse:collapse;font-size:.9rem}td,th{border-bottom:1px solid #8884;text-align:left;padding:9px}.pics{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.pics img{width:100%;border-radius:8px;border:1px solid #8885}.pics small{display:block}section{margin-top:32px}a{color:inherit}h2{font-size:1.2rem}</style></head><body>
  <header><div><h1>Site Quality Guardian</h1><p class="sub">${esc(report.config.name)} · ${esc(report.config.url)}</p></div><p>${esc(report.finishedAt)}</p></header>
  <div class="grid"><div class="metric"><b>${states.length}</b><small>Confirmed findings</small></div><div class="metric"><b>${report.actions.length}</b><small>Executed browser actions</small></div><div class="metric"><b>${report.visitedPaths.length}</b><small>Visited routes</small></div><div class="metric"><b>${esc(report.mode)}</b><small>Run mode</small></div></div>
  <p class="sub">${esc(report.status)}. Only observed or repeatable errors are called confirmed. AI ideas are hypotheses, not verified defects. This dashboard is public.</p>
  <section><h2>Confirmed findings</h2>${fItems}</section><section><h2>AI usability hypotheses</h2>${suggestionItems}</section>
  <section><h2>Interaction log</h2><div style="overflow:auto"><table><thead><tr><th>ID</th><th>Device</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>${actionTable}</tbody></table></div></section>
  <section><h2>Screenshot evidence</h2><div class="pics">${pictures||'No screenshots were captured.'}</div></section>
  <section><h2>Limitations</h2><ul>${(report.errors||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>All configured execution stages completed.</li>'}</ul></section>
  <p class="sub">Generated by an independent, read-only browser agent. Showtime accuracy requires comparison with independently verified official cinema records; the agent does not treat UI/API agreement as proof.</p></body></html>`;
  fs.mkdirSync(path.join(out,'site'),{recursive:true});
  fs.writeFileSync(path.join(out,'site','index.html'),html);
  for(const s of report.screenshots){
    const from=path.join(out,s), to=path.join(out,'site',s);if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
  }
}
