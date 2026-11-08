import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {safeFilename, cleanText} from './security.mjs';
import {THRESHOLDS, rate} from './perf.mjs';

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const SEVERITY_MEANING = {P0: 'Site is down or blank', P1: 'Blocks a core task', P2: 'Hurts usability', P3: 'Polish'};
const MAX_INSTANCES = 6;

const FIX_HINTS = {
  'site-unreachable': 'Check hosting, DNS and CDN status first.',
  'page-http': 'Check server logs for this route.',
  'page-http-error': 'Fix or redirect the route, and remove links pointing at it.',
  'resource-http-error': 'Find the code requesting this URL. Fix the endpoint or stop calling it.',
  'request-failed': 'Check whether the endpoint is reachable and whether it times out.',
  'csp-blocked': 'Either add this host to the Content-Security-Policy or remove the script that loads it.',
  'blank-page': 'Check for a render crash or a data fetch that failed without a fallback.',
  'soft-error-page': 'Return a proper error status, and make sure the page renders its real content.',
  'layout-overflow': 'Fix the listed elements: use max-width: 100%, allow long text to wrap, and let wide rows scroll inside their own container.',
  'broken-image': 'Fix the image URLs and add a fallback for missing posters.',
  'invalid-booking-url': 'Give every call-to-action a real destination, or hide it when none exists.',
  'document-heading': 'Give every page one visible h1 that says what the page is.',
  'tap-target-too-small': 'Give these controls at least 24×24px, ideally 44×44px. Padding or a larger hit area works without changing the visual size.',
  'primary-tap-target-small': 'Make these at least 44px tall, since they are what visitors came to tap. Add vertical padding and keep 8px between stacked links.',
  'tap-target-comfort': 'Raise to 44px tall where layout allows, starting with the controls used most.',
  'input-zoom-ios': 'Set font-size: 16px on form fields at phone widths (for example Tailwind text-base with md:text-sm).',
  'small-text': 'Raise body and label text to at least 12px, preferably 14px.',
  'oversized-image': 'Serve responsive sizes with srcset and sizes, or ask the image CDN for a smaller width.',
  'sticky-coverage': 'Keep only the essentials sticky. Collapse filters into one compact bar, or hide them while scrolling down.',
  'sticky-coverage-landscape': 'Turn off sticky filters at short viewport heights, for example with @media (max-height: 500px).',
  'control-no-effect': 'Open the page and tap this control. If it is really dead, check its handler. If it was already selected, mark it with aria-pressed so this check can tell.',
  'control-obscured': 'Find the overlay covering this control and move it, or add safe spacing so the control stays tappable.',
  'search-no-results': 'Check search parsing for this query, or offer a helpful fallback instead of an empty result.',
  'javascript-error': 'Reproduce from the trace file and fix the throwing code.',
  'console-error': 'Check whether this affects visitors. Fix it if so, otherwise silence the source.',
  'broken-internal-link': 'Fix or redirect the destination and update the source link.',
  'past-next-screening': 'Filter out screenings that have already started when choosing the next one.',
  'performance-lcpMs': 'Prioritise the main content: preload the hero image and reduce render-blocking resources.',
  'performance-fcpMs': 'Reduce render-blocking CSS, fonts and JavaScript in the first response.',
  'performance-ttfbMs': 'Cache the HTML at the CDN and reduce server-side data fetching.',
  'performance-tbtMs': 'Split up long JavaScript tasks and defer code that is not needed at first.',
  'performance-cls': 'Reserve space for images and late-loading content so the layout does not jump.',
  'lazy-lcp-image': 'Remove loading="lazy" from the first visible image and add fetchpriority="high".',
};

export function fixHint(kind) {
  if (kind.startsWith('accessibility-')) return 'See the rule link in the evidence for how to fix each listed element.';
  return FIX_HINTS[kind] || '';
}

export function fingerprintOf(kind, title, mergeKey = '') {
  const hash = crypto.createHash('sha1').update(`${kind}|${title}|${mergeKey}`).digest('hex').slice(0, 8);
  return `${safeFilename(kind).slice(0, 50)}-${hash}`;
}

/** One issue on many pages or devices is one fix, so repeats merge into a single finding. */
export function upsertFinding(findings, {kind, title, severity = 'P2', status = 'CONFIRMED', device, page, stepId, evidence = {}, mergeKey = ''}) {
  const fingerprint = fingerprintOf(kind, title, mergeKey);
  let f = findings.find(x => x.fingerprint === fingerprint);
  if (!f) {
    f = {id: fingerprint, fingerprint, kind, title, severity, status, devices: [], pages: [], stepId: stepId || null, fix: fixHint(kind), instances: []};
    findings.push(f);
  }
  if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(f.severity)) f.severity = severity;
  if (status === 'CONFIRMED') f.status = 'CONFIRMED';
  if (device && !f.devices.includes(device)) f.devices.push(device);
  if (page && !f.pages.includes(page)) f.pages.push(page);
  const seen = f.instances.some(i => i.device === device && i.page === page);
  if (!seen && f.instances.length < MAX_INSTANCES) f.instances.push({device: device || null, page: page || null, stepId: stepId || null, evidence});
  return f;
}

/** Most severe first; within a severity, issues affecting the priority device come first. */
export function sortFindings(findings, primaryDevice) {
  const rank = f => SEVERITIES.indexOf(f.severity) * 10 + (f.devices.includes(primaryDevice) ? 0 : 1);
  return [...findings].sort((a, b) => rank(a) - rank(b));
}

function esc(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }

function writeMarkdown(report, out) {
  const count = s => report.findings.filter(f => f.severity === s).length;
  const lines = [
    `# ${report.config.name} — Site Quality Guardian`, '',
    `**Finished:** ${report.finishedAt}  `, `**Mode:** ${report.mode}  `, `**Status:** ${report.status}  `,
    `**Findings:** ${SEVERITIES.map(s => `${s}: ${count(s)}`).join(', ')}  `, `**Steps executed:** ${report.actions.length}`, '',
  ];
  for (const f of report.findings) {
    lines.push(`## ${f.severity}: ${f.title}`, `- Status: ${f.status}, ${f.trend || 'NEW'}`, `- Devices: ${f.devices.join(', ') || 'all'}`, `- Pages: ${f.pages.join(', ') || 'n/a'}`);
    if (f.fix) lines.push(`- Fix: ${f.fix}`);
    lines.push(`- Evidence: \`${JSON.stringify(f.instances[0]?.evidence ?? {}).slice(0, 600)}\``, '');
  }
  if (report.suggestions?.length) {
    lines.push('## AI suggestions (not confirmed defects)', '');
    for (const s of report.suggestions) lines.push(`- **${cleanText(s.title)}** (${cleanText(s.device, 30)}, evidence: ${cleanText(s.evidenceStep, 80)}). ${cleanText(s.suggestedFix, 300)}`);
  }
  if (report.errors?.length) lines.push('', '## Execution limitations', ...report.errors.map(x => `- ${cleanText(x, 500)}`));
  fs.writeFileSync(path.join(out, 'report.md'), `${lines.join('\n')}\n`);
}

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1c1b1a;--muted:#6b6862;--line:#e4e1db;--p0:#a31d1d;--p1:#c2410c;--p2:#a16207;--p3:#57606a;--good:#15803d;--code:#f2f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--panel:#1b1b1b;--ink:#ece9e4;--muted:#a09c95;--line:#312f2c;--p0:#f87171;--p1:#fb923c;--p2:#facc15;--p3:#a8b3bf;--good:#4ade80;--code:#262524}}
*{box-sizing:border-box}body{margin:0 auto;max-width:980px;padding:20px 16px 60px;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}
h1{font-size:1.6rem;margin:0}h2{font-size:1.2rem;margin:36px 0 10px}a{color:inherit}.sub{color:var(--muted);font-size:.875rem;margin:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:18px 0}.metric,.issue{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.metric b{display:block;font-size:1.7rem;line-height:1.2;font-variant-numeric:tabular-nums}.issue{margin:10px 0}.issue h3{font-size:1rem;margin:6px 0 4px}
.sev{font-weight:700;font-size:.75rem;letter-spacing:.03em}.P0{color:var(--p0)}.P1{color:var(--p1)}.P2{color:var(--p2)}.P3{color:var(--p3)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:0 8px;font-size:.75rem;color:var(--muted);margin:2px 4px 2px 0}
.fix{margin:8px 0}details{margin-top:8px}summary{cursor:pointer;min-height:32px;color:var(--muted);font-size:.875rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code);padding:10px;border-radius:7px;font-size:.8rem}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.875rem}td,th{border-bottom:1px solid var(--line);text-align:left;padding:8px;white-space:nowrap}td.wrap{white-space:normal;min-width:180px}
.good{color:var(--good)}.needs-improvement{color:var(--p2)}.poor{color:var(--p1);font-weight:600}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.pics img{width:100%;border-radius:7px;border:1px solid var(--line)}.pics small{display:block;overflow-wrap:anywhere;color:var(--muted)}.shot{max-width:240px;display:block;margin-top:8px}.shot img{width:100%;border-radius:7px;border:1px solid var(--line)}
`;

function renderFinding(f) {
  const shot = f.instances.map(i => i.evidence?.screenshot).find(Boolean);
  const seen = f.occurrences > 1 ? ` · seen in ${f.occurrences} runs` : '';
  const likely = f.status === 'CONFIRMED' ? '' : '<span class="chip">Likely, check by hand</span>';
  return `<article class="issue"><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span> ${f.devices.map(d => `<span class="chip">${esc(d)}</span>`).join('')}<span class="chip">${esc(f.trend || 'NEW')}${esc(seen)}</span>${likely}
<h3>${esc(f.title)}</h3>${f.fix ? `<p class="fix">${esc(f.fix)}</p>` : ''}<p class="sub">Pages: ${esc(f.pages.slice(0, 8).join(', ') || 'n/a')}</p>
${shot ? `<a class="shot" href="${esc(shot)}"><img loading="lazy" src="${esc(shot)}" alt="Screenshot with the affected elements outlined in red"></a>` : ''}
<details><summary>Evidence</summary><pre>${esc(JSON.stringify(f.instances, null, 2))}</pre></details></article>`;
}

function renderPerformance(rows) {
  if (!rows?.length) return '<p>No performance measurements in this run.</p>';
  const metrics = Object.keys(THRESHOLDS);
  const cell = (metric, value) => `<td class="${esc(rate(metric, value))}">${value == null ? 'n/a' : esc(value)}</td>`;
  return `<div class="scroll"><table><thead><tr><th>Page</th>${metrics.map(m => `<th>${esc(THRESHOLDS[m].label)}</th>`).join('')}<th>Transfer KB</th><th>Requests</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.path)}</td>${metrics.map(m => cell(m, r.metrics[m])).join('')}<td>${esc(r.metrics.transferKb)}</td><td>${esc(r.metrics.requests)}</td></tr>`).join('')}</tbody></table></div><p class="sub">Times in milliseconds. Lab run with an empty cache on Slow 4G and a 4x CPU slowdown. Real visitors will differ.</p>`;
}

function writeHtml(report, out) {
  const count = s => report.findings.filter(f => f.severity === s).length;
  const metric = (value, label, cls = '') => `<div class="metric"><b class="${cls}">${esc(value)}</b><small>${esc(label)}</small></div>`;
  const findings = report.findings.map(renderFinding).join('') || '<p>No defects were recorded in this run. That does not guarantee there are none.</p>';
  const suggestions = (report.suggestions || []).map(s => `<article class="issue"><span class="sev ${esc(s.severity)}">${esc(s.severity)}</span> <span class="chip">${esc(s.device)}</span><h3>${esc(s.title)}</h3><p>${esc(s.userImpact)}</p><p class="fix"><strong>Try:</strong> ${esc(s.suggestedFix)}</p><p class="sub">Evidence: ${esc(s.evidenceStep)} · Check first: ${esc(s.validationNeeded)}</p></article>`).join('') || `<p>${report.mode === 'intelligent' ? 'No AI hypotheses in this run.' : 'Run in intelligent mode for an AI review of the screenshots.'}</p>`;
  const pictures = report.screenshots.map(file => `<a href="${esc(file)}"><img loading="lazy" src="${esc(file)}" alt="Audit screenshot ${esc(file)}"><small>${esc(path.basename(file))}</small></a>`).join('') || 'No screenshots were captured.';
  const actions = report.actions.map(a => `<tr><td>${esc(a.id)}</td><td>${esc(a.device)}</td><td>${esc(a.type)}</td><td class="wrap">${esc(a.target)}</td><td class="wrap">${esc(a.outcome)}</td></tr>`).join('');
  const missing = Object.entries(report.coverage.missingControls || {}).map(([device, list]) => `<li><strong>${esc(device)}:</strong> ${esc(list.join(', '))}</li>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.config.name)} quality report</title><style>${CSS}</style></head><body>
<header><h1>${esc(report.config.name)} quality report</h1><p class="sub">${esc(report.config.url)} · ${esc(report.finishedAt)} · ${esc(report.mode)} · ${esc(report.status)}</p></header>
<div class="grid">${SEVERITIES.map(s => metric(count(s), `${s}: ${SEVERITY_MEANING[s]}`, s)).join('')}${metric(report.visitedPaths.length, 'Pages visited')}${metric(report.actions.length, 'Browser actions')}</div>
<section><h2>Findings, most urgent first</h2>${findings}</section>
<section><h2>Phone performance</h2>${renderPerformance(report.performance)}</section>
<section><h2>AI usability review</h2><p class="sub">Hypotheses from the screenshots, not confirmed defects.</p>${suggestions}</section>
<section><h2>Coverage</h2><p>${esc(report.coverage.linksChecked || 0)} internal links checked. Pages visited: ${esc(report.visitedPaths.join(', ') || 'none')}</p>${missing ? `<p>These configured controls were not found, so they were not tested. Update the site config if they were renamed:</p><ul>${missing}</ul>` : ''}${report.priorIssuesNotObserved?.length ? `<p>Seen last run but not this one, possibly fixed:</p><ul>${report.priorIssuesNotObserved.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>
<section><h2>Screenshots</h2><div class="pics">${pictures}</div></section>
<section><h2>Interaction log</h2><details><summary>${report.actions.length} actions</summary><div class="scroll"><table><thead><tr><th>ID</th><th>Device</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>${actions}</tbody></table></div></details></section>
<section><h2>Limitations</h2><ul>${(report.errors || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>All stages completed.</li>'}</ul><p class="sub">Generated by an independent browser agent that never books, buys or submits forms. Showtime accuracy is not verified against cinema sources. This dashboard may be public.</p></section>
</body></html>`;
  fs.mkdirSync(path.join(out, 'site'), {recursive: true});
  fs.writeFileSync(path.join(out, 'site', 'index.html'), html);
  for (const s of report.screenshots) {
    const from = path.join(out, s), to = path.join(out, 'site', s);
    if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); }
  }
}

export function saveReport(report, out = 'out') {
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdown(report, out);
  writeHtml(report, out);
}
