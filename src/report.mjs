import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {safeFilename, cleanText, escapeHtml as esc} from './security.mjs';
import {writeUxReport} from './ux-report.mjs';
import {redactDeep} from './redact.mjs';
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
  'showtime-source-mismatch': "Compare the listing with the cinema's page in the evidence, then check that cinema's importer.",
  'source-link-broken': "Update this cinema's website address in the listing data.",
  'showtime-data-mismatch': 'Check the timezone conversion between stored screening times and the rendered page.',
  'past-screening-published': 'Exclude finished screenings from the page and from its structured data.',
  'filter-semantics': 'Check the filter logic against the listed offenders in the evidence.',
  'filter-order-dependent': 'Apply filters as a set, so the order chosen by the visitor cannot change the outcome.',
  'filter-empty-unexplained': 'Show a message and a way to relax the filters when nothing matches.',
  'state-lost-on-reload': 'Keep filters in the URL so reloading and sharing restore the same results.',
  'goal-failed': 'Follow the recorded steps by hand. An AI visitor reported this with evidence from the page, so confirm it before acting.',
  'booking-destination-missing': 'Publish a ticket destination in each screening\'s offers data.',
  'booking-destination-invalid': 'Use a complete https address for this screening\'s ticket destination.',
  'sponsored-link-rel-missing': 'Mark every sponsored redirect with rel="sponsored".',
  'ai-directed-text': 'Check whether this text is meant to be on the page. It may be an injection attempt against AI tools.',
  'anomaly-itemCount': 'Compare with the previous run. A sharp change usually means a broken feed or import.',
  'anomaly-textLength': 'Compare with the previous run to see which content appeared or disappeared.',
  'anomaly-controlCount': 'Compare with the previous run to see which controls appeared or disappeared.',
  'anomaly-structure': 'If this redesign was intended, the baseline updates itself over the next runs.',
};

export function fixHint(kind) {
  if (kind.startsWith('accessibility-')) return 'See the rule link in the evidence for how to fix each listed element.';
  return FIX_HINTS[kind] || '';
}

/** Long numbers and ids change between runs, so they must not change a finding's identity. */
export function stableTitle(title) {
  return String(title).replace(/\b(?=[0-9a-f]*\d[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '#').replace(/\b\d{4,}\b/g, '#');
}

export function fingerprintOf(kind, title, mergeKey = '') {
  const hash = crypto.createHash('sha1').update(`${kind}|${stableTitle(title)}|${mergeKey}`).digest('hex').slice(0, 8);
  return `${safeFilename(kind).slice(0, 50)}-${hash}`;
}

/** One issue on many pages or devices is one fix, so repeats merge into a single finding. */
export function upsertFinding(findings, {kind, title, severity = 'P2', status = 'CONFIRMED', device, page, stepId, evidence = {}, mergeKey = '', scope = ''}) {
  const fingerprint = fingerprintOf(kind, title, mergeKey);
  let f = findings.find(x => x.fingerprint === fingerprint);
  if (!f) {
    f = {id: fingerprint, fingerprint, kind, title, severity, status, devices: [], pages: [], stepId: stepId || null, fix: fixHint(kind), scope, instances: []};
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
  const rank = f => (f.status === 'TRANSIENT' ? 100 : 0) + SEVERITIES.indexOf(f.severity) * 10 + (f.devices.includes(primaryDevice) ? 0 : 1);
  return [...findings].sort((a, b) => rank(a) - rank(b));
}

const confirmedOrLikely = report => report.findings.filter(f => f.status !== 'TRANSIENT');

function writeMarkdown(report, out) {
  const active = confirmedOrLikely(report);
  const count = s => active.filter(f => f.severity === s).length;
  const lines = [
    `# ${report.config.name} — Site Quality Guardian`, '',
    `**Finished:** ${report.finishedAt}  `, `**Mode:** ${report.mode}  `, `**Status:** ${report.status}  `,
    `**Findings:** ${SEVERITIES.map(s => `${s}: ${count(s)}`).join(', ')}  `,
    `**Showtime verification:** ${report.showtimes?.summary?.verdict || 'NOT_VERIFIED'}  `,
    `**Steps executed:** ${report.actions.length}`, '',
    ...(report.access?.blocked ? [`> **This audit was blocked by the site's protection (${report.access.denied} of ${report.access.attempted} requests refused) and is not valid evidence.**`, ''] : []),
  ];
  for (const f of active) {
    lines.push(`## ${f.severity}: ${f.title}`, `- Status: ${f.status}, ${f.trend || 'NEW'}`, `- Devices: ${f.devices.join(', ') || 'all'}`, `- Pages: ${f.pages.join(', ') || 'n/a'}`);
    if (f.fix) lines.push(`- Fix: ${f.fix}`);
    lines.push(`- Evidence: \`${JSON.stringify(f.instances[0]?.evidence ?? {}).slice(0, 600)}\``, '');
  }
  if (report.suggestions?.length) {
    lines.push('## AI suggestions (not confirmed defects)', '');
    for (const s of report.suggestions) lines.push(`- **${cleanText(s.title)}** (${cleanText(s.device, 30)}, evidence: ${cleanText(s.evidenceStep, 80)}). ${cleanText(s.suggestedFix, 300)}`);
  }
  if (report.goals?.length) {
    lines.push('', '## AI visitor journeys', '', `Success: ${report.goalsSummary.SUCCESS}, Failure: ${report.goalsSummary.FAILURE}, Incomplete: ${report.goalsSummary.INCOMPLETE}`, '');
    for (const g of report.goals) lines.push(`- **${g.outcome}** (${g.reason}): ${cleanText(g.title, 140)}`);
  }
  if (report.errors?.length) lines.push('', '## Execution limitations', ...report.errors.map(x => `- ${cleanText(x, 500)}`));
  fs.writeFileSync(path.join(out, 'report.md'), `${lines.join('\n')}\n`);
}

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1c1b1a;--muted:#6b6862;--line:#e4e1db;--p0:#a31d1d;--p1:#c2410c;--p2:#a16207;--p3:#57606a;--good:#15803d;--code:#f2f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--panel:#1b1b1b;--ink:#ece9e4;--muted:#a09c95;--line:#312f2c;--p0:#f87171;--p1:#fb923c;--p2:#facc15;--p3:#a8b3bf;--good:#4ade80;--code:#262524}}
*{box-sizing:border-box}body{margin:0 auto;max-width:1040px;padding:20px 16px 60px;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-text-size-adjust:100%}
h1{font-size:1.6rem;margin:0}h2{font-size:1.2rem;margin:36px 0 10px;scroll-margin-top:64px}a{color:inherit}.sub{color:var(--muted);font-size:.875rem;margin:4px 0}
nav.jump{position:sticky;top:0;background:var(--bg);display:flex;gap:6px;overflow-x:auto;padding:8px 0;border-bottom:1px solid var(--line);z-index:5}nav.jump a{white-space:nowrap;padding:10px 12px;min-height:44px;border-radius:8px;text-decoration:none;font-size:.875rem;background:var(--panel);border:1px solid var(--line)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:18px 0}.metric,.issue{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.metric b{display:block;font-size:1.7rem;line-height:1.2;font-variant-numeric:tabular-nums}.issue{margin:10px 0}.issue h3{font-size:1rem;margin:6px 0 4px}
.sev{font-weight:700;font-size:.75rem;letter-spacing:.03em}.P0{color:var(--p0)}.P1{color:var(--p1)}.P2{color:var(--p2)}.P3{color:var(--p3)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:0 8px;font-size:.75rem;color:var(--muted);margin:2px 4px 2px 0}.chip.REGRESSED,.chip.outcome-FAILURE{color:var(--p0);font-weight:700}.chip.outcome-SUCCESS{color:var(--good);font-weight:700}.chip.outcome-INCOMPLETE{color:var(--p2);font-weight:700}.chip.NEW{color:var(--p1)}
.fix{margin:8px 0}details{margin-top:8px}summary{cursor:pointer;min-height:44px;line-height:44px;color:var(--muted);font-size:.875rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code);padding:10px;border-radius:7px;font-size:.8rem}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums}td,th{border-bottom:1px solid var(--line);text-align:left;padding:8px;white-space:nowrap}td.wrap{white-space:normal;min-width:180px}
.good,.MATCH,.LIKELY_MATCH{color:var(--good)}.needs-improvement{color:var(--p2)}.poor,.MISMATCH{color:var(--p1);font-weight:600}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.pics img{width:100%;border-radius:7px;border:1px solid var(--line)}.pics small{display:block;overflow-wrap:anywhere;color:var(--muted)}.shot{max-width:240px;display:block;margin-top:8px}.shot img{width:100%;border-radius:7px;border:1px solid var(--line)}
`;

function pageShell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

const STATUS_NOTE = {CONFIRMED: '', LIKELY: 'Likely, check by hand', TRANSIENT: 'Seen once, did not come back on re-test'};

function renderFinding(f) {
  const shot = f.instances.map(i => i.evidence?.screenshot).find(Boolean);
  const seen = f.occurrences > 1 ? ` · seen in ${f.occurrences} runs` : '';
  const note = STATUS_NOTE[f.status];
  const step = f.stepId ? `<span class="chip">Step ${esc(f.stepId)}</span>` : '';
  return `<article class="issue"><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span> ${f.devices.map(d => `<span class="chip">${esc(d)}</span>`).join('')}<span class="chip ${esc(f.trend || 'NEW')}">${esc(f.trend || 'NEW')}${esc(seen)}</span>${note ? `<span class="chip">${esc(note)}</span>` : ''}${step}
<h3>${esc(f.title)}</h3>${f.fix ? `<p class="fix">${esc(f.fix)}</p>` : ''}<p class="sub">Pages: ${esc(f.pages.slice(0, 8).join(', ') || 'n/a')}</p>
${shot ? `<a class="shot" href="${esc(shot)}"><img loading="lazy" src="${esc(shot)}" alt="Screenshot with the affected elements outlined in red"></a>` : ''}
<details><summary>Evidence</summary><pre>${esc(JSON.stringify(f.instances, null, 2))}</pre></details></article>`;
}

function renderPerformance(rows) {
  if (!rows?.length) return '<p>No performance measurements in this run.</p>';
  const metrics = Object.keys(THRESHOLDS);
  const cell = (metric, value) => `<td class="${esc(rate(metric, value))}">${value == null ? 'n/a' : esc(value)}</td>`;
  return `<div class="scroll"><table><thead><tr><th>Page</th>${metrics.map(m => `<th>${esc(THRESHOLDS[m].label)}</th>`).join('')}<th>Transfer KB</th><th>Requests</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.path)}</td>${metrics.map(m => cell(m, r.metrics[m])).join('')}<td>${esc(r.metrics.transferKb)}</td><td>${esc(r.metrics.requests)}</td></tr>`).join('')}</tbody></table></div><p class="sub">Times in milliseconds, Slow 4G and 4x CPU slowdown. Lab numbers show direction, and real visitors will differ.</p>`;
}

const VERDICT_TEXT = {
  NOT_VERIFIED: 'Not compared with any cinema source in this run.',
  INCONCLUSIVE: 'Sources were reached, but none could confirm or contradict a showtime.',
  PARTIALLY_VERIFIED: 'Some showtimes were confirmed on the cinema sites. This is a sample, not full coverage.',
  MISMATCHES_FOUND: 'At least one showtime differs from the cinema site. Check the rows marked MISMATCH by hand.',
};

function renderShowtimes(showtimes = {}) {
  const verdict = showtimes.summary?.verdict || 'NOT_VERIFIED';
  const rows = (showtimes.results || []).map(r => `<tr><td class="wrap">${esc(r.film)}</td><td class="wrap">${esc(r.venue)}</td><td>${esc(r.listed)}</td><td class="${esc(r.status)}">${esc(r.status)}</td><td class="wrap">${esc(r.detail)}</td></tr>`).join('');
  return `<p><strong>${esc(verdict)}.</strong> ${esc(VERDICT_TEXT[verdict] || '')}</p><p class="sub">${esc(showtimes.extracted || 0)} screenings read from the site's structured data. ${esc(showtimes.renderIssues || 0)} differences from the rendered pages.</p>${rows ? `<div class="scroll"><table><thead><tr><th>Film</th><th>Cinema</th><th>Listed</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
}

const REASON_TEXT = {
  'success-condition-verified': 'The success condition, set before the journey began, was true on the final page.',
  'visitor-blocked-with-evidence': 'The AI visitor got stuck, and the page supports what it reported.',
  'criterion-already-met-before-journey': 'The success condition was already true before any step, so this proves nothing.',
  'no-steps-executed': 'No step was performed.',
  'blocked-claim-without-evidence': 'The AI visitor reported being stuck, but the page did not support it.',
  'success-claim-not-verified': 'The AI visitor claimed success, but the success condition was not true.',
  'stalled': 'Consecutive turns changed nothing on the page.',
  'turn-budget-exhausted': 'It ran out of turns before the success condition became true.',
  'ai-call-budget': 'The run reached its Claude call limit.',
  'action-budget': 'The run reached its browser action limit.',
};

function renderGoals(goals = [], summary) {
  if (!goals.length) return '<p>No AI visitor journeys in this run.</p>';
  const cards = goals.map(g => `<article class="issue"><span class="chip outcome-${esc(g.outcome)}">${esc(g.outcome)}</span><span class="chip">${esc(g.device)}</span><h3>${esc(g.title)}</h3><p>${esc(REASON_TEXT[g.reason] || g.reason)}</p><p class="sub">${esc(g.why)}</p><p class="sub">Success condition: ${esc(g.successCheck?.kind)} ${esc(g.successCheck?.value)}${g.successCheck?.alsoRequire && g.successCheck.alsoRequire !== 'none' ? `, plus ${esc(g.successCheck.alsoRequire)}` : ''}</p>${g.problem ? `<p>${esc(g.problem)}</p>` : ''}<details><summary>${esc(g.steps.length)} steps</summary><pre>${esc(JSON.stringify(g.steps, null, 2))}</pre></details></article>`).join('');
  return `<p>${esc(summary?.SUCCESS ?? 0)} succeeded, ${esc(summary?.FAILURE ?? 0)} failed, ${esc(summary?.INCOMPLETE ?? 0)} incomplete. A journey only succeeds when its success condition is verified on the page.</p>${cards}`;
}

function renderHistory(history = []) {
  if (!history.length) return '<p>This is the first recorded run.</p>';
  const rows = [...history].reverse().slice(0, 20).map(h => `<tr><td>${esc(h.at)}</td><td>${esc(h.mode)}</td><td>${esc(h.status)}</td><td>${esc(h.open?.P0 ?? 0)}</td><td>${esc(h.open?.P1 ?? 0)}</td><td>${esc(h.open?.P2 ?? 0)}</td><td>${esc(h.newFindings)}</td><td>${esc(h.regressions)}</td><td>${esc(h.transient)}</td><td>${esc(h.showtimes)}</td><td>${esc(h.goals?.total ? `${h.goals.SUCCESS ?? 0}/${h.goals.total}` : '-')}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>Run</th><th>Mode</th><th>Status</th><th>P0</th><th>P1</th><th>P2</th><th>New</th><th>Regressed</th><th>Transient</th><th>Showtimes</th><th>Journeys succeeded</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderAccessBanner(report) {
  if (!report.access?.blocked) return '';
  return `<div class="issue" role="alert"><h3 class="P0">This audit was blocked and is not valid evidence</h3><p>The site's protection refused ${esc(report.access.denied)} of ${esc(report.access.attempted)} requests from this network. Failures caused by the block are withheld, and this run taught the agent nothing. Allow the agent through the site's protection, then run it again.</p></div>`;
}

function writeHtml(report, out) {
  const active = confirmedOrLikely(report);
  const transient = report.findings.filter(f => f.status === 'TRANSIENT');
  const count = s => active.filter(f => f.severity === s).length;
  const metric = (value, label, cls = '') => `<div class="metric"><b class="${cls}">${esc(value)}</b><small>${esc(label)}</small></div>`;
  const findings = active.map(renderFinding).join('') || '<p>No defects were recorded in this run. That does not guarantee there are none.</p>';
  const suggestions = (report.suggestions || []).map(s => `<article class="issue"><span class="sev ${esc(s.severity)}">${esc(s.severity)}</span> <span class="chip">${esc(s.device)}</span><h3>${esc(s.title)}</h3><p>${esc(s.userImpact)}</p><p class="fix"><strong>Try:</strong> ${esc(s.suggestedFix)}</p><p class="sub">Evidence: ${esc(s.evidenceStep)} · Check first: ${esc(s.validationNeeded)}</p></article>`).join('') || `<p>${report.mode === 'intelligent' ? 'No AI suggestions were produced in this run.' : 'AI review runs in intelligent mode.'}</p>`;
  const pictures = report.screenshots.map(file => `<a href="${esc(file)}"><img loading="lazy" src="${esc(file)}" alt="Audit screenshot ${esc(file)}"><small>${esc(path.basename(file))}</small></a>`).join('') || 'No screenshots were captured.';
  const actions = report.actions.map(a => `<tr><td>${esc(a.id)}</td><td>${esc(a.at)}</td><td>${esc(a.device)}</td><td>${esc(a.source || '')}</td><td>${esc(a.type)}</td><td class="wrap">${esc(a.target)}</td><td class="wrap">${esc(a.outcome === 'PASS' ? 'Executed' : a.outcome)}</td></tr>`).join('');
  const missing = Object.entries(report.coverage.missingHints || {}).filter(([, list]) => list.length).map(([device, list]) => `<li><strong>${esc(device)}:</strong> ${esc(list.join(', '))}</li>`).join('');
  const blocked = Object.entries(report.safety?.blockedRequests || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
  const model = report.model || {};
  const body = `<header><h1>${esc(report.config.name)} quality report</h1><p class="sub">${esc(report.config.url)} · ${esc(report.finishedAt)} · ${esc(report.mode)} · ${esc(report.status)}</p></header>
${renderAccessBanner(report)}${report.ux?.valid ? '<p><a href="ux/index.html"><strong>Open the expert UX report</strong></a></p>' : ''}<nav class="jump"><a href="#findings">Findings</a><a href="#showtimes">Showtimes</a><a href="#goals">AI goals</a><a href="#perf">Performance</a><a href="#coverage">Coverage</a><a href="#history">History</a><a href="#shots">Screenshots</a><a href="#safety">Safety</a></nav>
<div class="grid">${SEVERITIES.map(s => metric(count(s), `${s}: ${SEVERITY_MEANING[s]}`, s)).join('')}${metric(transient.length, 'Transient, not counted')}${metric(model.states ?? 0, 'States discovered')}${metric(report.actions.length, 'Browser actions')}</div>
<section id="findings"><h2>Findings, most urgent first</h2>${findings}${transient.length ? `<details><summary>${transient.length} transient, not counted</summary>${transient.map(renderFinding).join('')}</details>` : ''}${report.resolvedThisRun?.length ? `<p>Resolved in this run: ${esc(report.resolvedThisRun.join('; '))}</p>` : ''}</section>
<section id="showtimes"><h2>Showtime accuracy</h2>${renderShowtimes(report.showtimes)}</section>
<section id="goals"><h2>AI visitor journeys</h2>${renderGoals(report.goals, report.goalsSummary)}</section>
<section><h2>AI usability review</h2><p class="sub">Hypotheses from the screenshots, not confirmed defects.</p>${report.aiSummary ? `<p>${esc(report.aiSummary)}</p>` : ''}${suggestions}</section>
<section id="perf"><h2>Phone performance</h2>${renderPerformance(report.performance)}</section>
<section id="coverage"><h2>Coverage</h2><p>${esc(model.controlsTried ?? 0)} of ${esc(model.controlsDiscovered ?? 0)} discovered control types exercised across ${esc(model.states ?? 0)} states and ${esc(model.transitions ?? 0)} transitions. ${esc(report.coverage.linksChecked || 0)} internal links checked. ${esc(report.coverage.a11yPagesScanned || 0)} pages scanned for accessibility. Pages visited: ${esc(report.visitedPaths.join(', ') || 'none')}</p>${missing ? `<p>These configured names were not found, so please check the site config:</p><ul>${missing}</ul>` : ''}</section>
<section id="history"><h2>Run history</h2>${renderHistory(report.history)}</section>
<section id="shots"><h2>Screenshots</h2><div class="pics">${pictures}</div></section>
<section><h2>Interaction log</h2><p class="sub">"Executed" means the browser performed the step. It does not mean a visitor journey succeeded.</p><details><summary>${report.actions.length} actions</summary><div class="scroll"><table><thead><tr><th>ID</th><th>Time</th><th>Device</th><th>Source</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>${actions}</tbody></table></div></details></section>
<section id="safety"><h2>Safety and limitations</h2><p>${esc(report.safety?.statement || '')} Blocked requests: ${esc(blocked)}.</p><p>Booking links: ${esc(report.booking?.note || '')} ${esc(report.booking?.withDestination ?? 0)} of ${esc(report.booking?.eventsChecked ?? 0)} upcoming screenings publish a valid destination.</p><ul>${(report.errors || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>All stages completed.</li>'}</ul><p class="sub">Generated by an independent browser agent that never books, buys or submits forms. <a href="manifest.json">Evidence hashes</a>. This dashboard may be public.</p></section>`;
  fs.mkdirSync(path.join(out, 'site'), {recursive: true});
  fs.writeFileSync(path.join(out, 'site', 'index.html'), pageShell(`${report.config.name} quality report`, body));
  for (const s of report.screenshots) {
    const from = path.join(out, s), to = path.join(out, 'site', s);
    if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); }
  }
}

/** Lets a reader confirm that published evidence is what the run produced. */
function writeManifest(report, out) {
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const files = {};
  const add = name => { const full = path.join(out, name); if (fs.existsSync(full)) files[name] = hash(full); };
  add('report.json');
  add('ux-report.md');
  report.screenshots.forEach(add);
  for (const name of fs.readdirSync(out)) if (name.startsWith('trace-')) add(name);
  const manifest = {site: report.config.url, startedAt: report.startedAt, finishedAt: report.finishedAt, status: report.status, algorithm: 'sha256', files};
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.copyFileSync(path.join(out, 'manifest.json'), path.join(out, 'site', 'manifest.json'));
}

export function saveReport(rawReport, out = 'out') {
  const report = redactDeep(rawReport); // the one exit for everything published
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdown(report, out);
  writeHtml(report, out);
  if (report.ux?.valid) writeUxReport(report, out);
  writeManifest(report, out);
}

/** The one page the iPad opens: the health of every audited site at a glance. */
export function writeDashboardIndex(entries, out = 'out') {
  fs.mkdirSync(path.join(out, 'site'), {recursive: true});
  const cards = entries.map(({slug, name, url, report}) => {
    const active = confirmedOrLikely(report);
    const count = s => active.filter(f => f.severity === s).length;
    fs.cpSync(path.join(out, slug, 'site'), path.join(out, 'site', slug), {recursive: true});
    // A later non-UX run keeps the most recent UX report on the dashboard.
    const carried = process.env.GUARDIAN_PREVIOUS_UX && path.join(process.env.GUARDIAN_PREVIOUS_UX, slug);
    if (carried && !report.ux?.valid && fs.existsSync(path.join(carried, 'index.html'))) fs.cpSync(carried, path.join(out, 'site', slug, 'ux'), {recursive: true});
    const hasUx = fs.existsSync(path.join(out, 'site', slug, 'ux', 'index.html'));
    return `<article class="issue"><h3><a href="${esc(slug)}/index.html">${esc(name)}</a></h3><p class="sub">${esc(url)}</p>${hasUx ? `<p><a href="${esc(slug)}/ux/index.html">Expert UX report</a></p>` : ''}<p class="sub">${esc(report.finishedAt)} · ${esc(report.mode)} · ${esc(report.status)}</p><div class="grid">${SEVERITIES.map(s => `<div class="metric"><b class="${s}">${count(s)}</b><small>${s}</small></div>`).join('')}<div class="metric"><b>${esc(report.showtimes?.summary?.confirmed ?? 0)}/${esc(report.showtimes?.summary?.checked ?? 0)}</b><small>Showtimes confirmed</small></div></div></article>`;
  }).join('');
  fs.writeFileSync(path.join(out, 'site', 'index.html'), pageShell('Site Quality Guardian', `<header><h1>Site Quality Guardian</h1><p class="sub">Independent, read-only website audits</p></header>${cards}`));
}
