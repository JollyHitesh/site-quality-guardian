// The report a website owner reads. It always separates what was measured from what an expert
// judged, and says plainly what could not be assessed.
import fs from 'node:fs';
import path from 'node:path';
import {escapeHtml as esc, cleanText} from './security.mjs';

const CLASS_LABEL = {'detected-defect': 'Detected by measurement', 'expert-judgment': 'Expert judgement', 'research-needed': 'Needs user research'};
const CLASS_INTRO = {
  'detected-defect': 'A rule measured these in the browser. The result is reproducible.',
  'expert-judgment': 'A reviewer judged these from cited screenshots and actions, and a second reading checked each claim. Treat them as well-supported hypotheses.',
  'research-needed': 'These are ideas worth testing with real visitors. Do not act on them without that research.',
};
const introFor = (cls, ux) => (cls === 'expert-judgment' && ux.expert.verification !== 'complete' ? 'A reviewer judged these from cited screenshots and actions. The second reading did not run, so their confidence has been lowered.' : CLASS_INTRO[cls]);
const SEVERITY_MEANING = {P0: 'Core task impossible on every device checked', P1: 'Blocks a task, or badly hinders a core one', P2: 'Substantial difficulty', P3: 'Friction or polish'};
const VERDICT_LABEL = {pass: 'Pass', concern: 'Concern', fail: 'Fail', 'not-assessed': 'Not assessed'};
const STAGE_LABEL = {'journey-start': 'Start', 'journey-step': 'After step', landing: 'Landing', page: 'Page', 'empty-state': 'Empty state', 'error-page': 'Error page', keyboard: 'Keyboard', finding: 'Detail', 'server-error': 'Intermittent server error'};
const OUTCOME_TEXT = {SUCCESS: 'Reached', FAILURE: 'Blocked', INCOMPLETE: 'Inconclusive'};
const ms = v => (v == null ? 'n/a' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
const CONFIDENCE_RANK = {high: 0, medium: 1, low: 2};

const CSS = `
:root{--bg:#f7f5f1;--panel:#fffefb;--ink:#1d1b18;--muted:#6a655c;--line:#e2ddd3;--accent:#20506b;--p0:#9b1c1c;--p1:#b4400b;--p2:#8a5a00;--p3:#55606c;--good:#1f7a43;--warn:#946200;--bad:#b02a2a;--wash:#efebe3}
@media (prefers-color-scheme:dark){:root{--bg:#141310;--panel:#1d1b18;--ink:#ece8e0;--muted:#a59f94;--line:#35312b;--accent:#8cc0dc;--p0:#f58a8a;--p1:#f7a56c;--p2:#e6c15a;--p3:#a7b3bf;--good:#6dcc93;--warn:#e6c15a;--bad:#f58a8a;--wash:#26231f}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 16px 72px}h1{font-size:2rem;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em}h2{font-size:1.4rem;margin:52px 0 6px;letter-spacing:-.01em;scroll-margin-top:64px}h3{font-size:1.05rem;line-height:1.35;margin:8px 0}h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 2px}p{margin:6px 0}a{color:var(--accent)}.sub{color:var(--muted);font-size:.9rem}ul,ol{margin:6px 0;padding-left:20px}
nav{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);display:flex;gap:4px;overflow-x:auto;padding:6px 16px}nav a{white-space:nowrap;text-decoration:none;font-size:.875rem;padding:10px 12px;min-height:44px;border-radius:8px;color:var(--ink)}nav a:hover{background:var(--wash)}a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.notice{background:var(--wash);border-left:3px solid var(--accent);padding:12px 14px;border-radius:0 8px 8px 0;margin:14px 0}.brief{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:12px;margin:16px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}.brief h3{margin-top:0}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}.score b{display:block;font-size:2.1rem;line-height:1.1;font-variant-numeric:tabular-nums}.score small{color:var(--muted)}.bar{height:6px;background:var(--wash);border-radius:3px;margin:8px 0}.bar i{display:block;height:100%;border-radius:3px;background:var(--accent)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:1px 9px;font-size:.75rem;color:var(--muted);margin:2px 4px 2px 0}.sev{font-weight:700;border-color:currentColor}.P0{color:var(--p0)}.P1{color:var(--p1)}.P2{color:var(--p2)}.P3{color:var(--p3)}.pass,.SUCCESS{color:var(--good)}.concern,.INCOMPLETE{color:var(--warn)}.fail,.FAILURE{color:var(--bad)}.REGRESSED{color:var(--bad);font-weight:700}
.issue{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:4px 24px}
.strip{display:flex;gap:10px;overflow-x:auto;padding:6px 0 10px}.strip figure{margin:0;flex:0 0 150px}.strip.wide figure{flex-basis:220px}.strip img,.compare img{width:100%;border-radius:8px;border:1px solid var(--line);display:block}figcaption{font-size:.75rem;color:var(--muted);margin-top:4px;line-height:1.3;overflow-wrap:anywhere}
.compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:start}.compare figure{margin:0}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
details{margin-top:10px}summary{cursor:pointer;color:var(--accent);min-height:44px;line-height:44px;font-size:.9rem}
@media print{nav{display:none}details{display:block}main{max-width:none}}
`;

function thumb(id, shots, {caption} = {}) {
  const s = shots.get(id);
  if (!s) return '';
  const src = `shots/${path.basename(s.jpg)}`;
  const text = caption || `${id} · ${s.device} · ${STAGE_LABEL[s.stage] || s.stage}${s.actionId ? ` · ${s.actionId}` : ''}`;
  return `<figure><a href="${esc(src)}"><img loading="lazy" src="${esc(src)}" alt="Screenshot ${esc(id)}: ${esc(s.device)}, ${esc(s.template)}, ${esc(STAGE_LABEL[s.stage] || s.stage)}"></a><figcaption>${esc(text)}</figcaption></figure>`;
}

const list = items => `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

function renderIssue(issue, shots) {
  const images = issue.evidenceRefs.filter(r => shots.has(r));
  const actions = issue.evidenceRefs.filter(r => /^A\d/.test(r));
  const cause = issue.rootCause?.status === 'established' ? 'Cause (established from the page)' : 'Likely cause (hypothesis)';
  return `<article class="issue" id="${esc(issue.id)}"><span class="chip sev ${esc(issue.severity)}">${esc(issue.severity)}</span><span class="chip">Confidence: ${esc(issue.confidence)}</span><span class="chip">${esc(issue.scope.replace(/-/g, ' '))}</span><span class="chip ${esc(issue.trend || '')}">${esc(issue.trend || 'NEW')}${issue.occurrences > 1 ? `, ${esc(issue.occurrences)} runs` : ''}</span>${issue.validated ? '<span class="chip pass">Validated with research</span>' : ''}${issue.devices.map(d => `<span class="chip">${esc(d)}</span>`).join('')}
<h3>${esc(issue.title)}</h3><p class="sub"><strong>${esc(issue.persona)}</strong> trying to: ${esc(issue.userGoal)}</p>
<div class="two"><div><h4>Problem</h4><p>${esc(issue.problem)}</p></div><div><h4>Recommendation</h4><p>${esc(issue.recommendation)}</p></div></div>
${images.length ? `<div class="strip">${images.map(id => thumb(id, shots)).join('')}</div>` : ''}
<details><summary>Evidence, cause, implementation and validation</summary><div class="two"><div><h4>Usability principle</h4><p>${esc(issue.principle)}${issue.wcag?.length ? `. WCAG ${esc(issue.wcag.join(', '))}` : ''}</p>
<h4>Observed evidence</h4><p>${esc(issue.observedEvidence)}${issue.quote ? ` On the page: "${esc(issue.quote)}".` : ''}</p>${actions.length ? `<p class="sub">Actions: ${esc(actions.join(', '))}</p>` : ''}
<h4>Reproduction</h4><ol>${issue.reproductionSteps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><h4>${esc(cause)}</h4><p>${esc(issue.rootCause?.text)}</p>${issue.verification ? `<h4>Cross-check</h4><p>${esc(issue.verification.verdict)}: ${esc(issue.verification.reason)}</p>` : ''}</div>
<div><h4>Alternative</h4><p>${esc(issue.alternative)}</p><h4>Expected benefit</h4><p>${esc(issue.expectedBenefit)}</p><h4>Implementation guidance</h4><p>${esc(issue.implementationGuidance)}</p><h4>Acceptance criteria</h4>${list(issue.acceptanceCriteria)}<h4>How to validate</h4><p>${esc(issue.validationMethod)}</p></div></div></details></article>`;
}

function trendText(trend, samePages) {
  if (!trend || trend.score == null) return 'No comparable earlier run';
  const sign = trend.score > 0 ? '+' : '';
  return `${sign}${trend.score} since the last comparable run${samePages ? '' : ', though the pages reviewed differ'}`;
}

function renderScorecard(ux) {
  const cards = Object.entries(ux.scorecard).map(([id, c]) => {
    const t = ux.trend.categories[id];
    return `<div class="card score"><small>${esc(c.label)}</small><b>${c.score == null ? '&ndash;' : esc(c.score)}</b>${c.score == null ? `<p class="sub">Not scored. ${esc(c.reason)}</p>` : `<div class="bar"><i style="width:${Number(c.score)}%"></i></div><small>Measured criteria only: ${esc(c.measuredScore)}. ${esc(Math.round(c.coverage * 100))}% of weight assessed.</small><br><small>${esc(trendText(t, ux.trend.samePages))}</small>`}</div>`;
  }).join('');
  const rows = Object.values(ux.scorecard).map(c => `<details><summary>${esc(c.label)}: criteria and evidence</summary><div class="scroll"><table><thead><tr><th>Criterion</th><th>Method</th><th>Weight</th><th>Result</th><th>Detail</th><th>Evidence</th></tr></thead><tbody>${c.rows.map(r => `<tr><td>${esc(r.question)}<br><span class="sub">${esc(r.criterion)}</span></td><td>${esc(r.method)}</td><td>${esc(r.weight)}</td><td class="${esc(r.verdict)}">${esc(VERDICT_LABEL[r.verdict])}</td><td>${esc(r.detail)}</td><td>${esc(r.evidenceRefs.slice(0, 5).join(', '))}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
  return `<div class="scores">${cards}</div><p class="sub">Each category score is the weighted average of its assessed criteria, with pass = 100, concern = 50 and fail = 0. A score appears only when at least ${esc(Math.round(0.5 * 100))}% of the weight was assessed and at least one measured criterion is included. Rubric version ${esc(ux.rubricVersion)}.</p>${rows}`;
}

function journeyTrend(runs = []) {
  if (runs.length < 2) return '';
  const earlier = runs.at(-2), latest = runs.at(-1);
  const difference = latest.actions - earlier.actions;
  return ` Actions compared with the previous run: ${difference > 0 ? '+' : ''}${difference}.`;
}

function renderJourneys(ux, shots) {
  if (!ux.journeys.length) return '<p>No visitor journey ran in this audit.</p>';
  return ux.journeys.map(j => {
    const m = j.metrics;
    const rows = [['Actions performed', m.actionCount], ['Target actions', j.targetActions ?? 'none set'], ['Shortest known route', m.shortestKnownActions ?? 'unknown'], ['Returned to an earlier state', m.backtracks], ['Repeated actions', m.repeatedActions], ['Dead ends', `${m.deadEnds}, ${m.deadEndsWithoutRecovery} with no way out`], ['Updates visible on screen', `${m.resultsInViewport} shown, ${m.resultsOffScreen} off screen`], ['Actions with no visible change', m.actionsWithoutVisibleFeedback], ['Pages that only led onward', m.interstitialSteps], ['Median time until the page changed', ms(m.medianResponseMs)], ['Automation time', ms(m.automationElapsedMs)]];
    const steps = j.steps.map(s => `<tr><td>${esc(s.actionId)}</td><td>${esc(s.control)}</td><td>${esc(s.ok ? (s.navigated ? `Went to ${s.toUrl}` : s.changed === false ? 'No change' : 'Updated in place') : 'Failed')}</td><td>${esc(s.itemsBefore)} to ${esc(s.itemsAfter)}</td><td>${esc(s.feedback)}</td></tr>`).join('');
    return `<article class="issue"><span class="chip ${esc(j.outcome)}"><strong>${esc(OUTCOME_TEXT[j.outcome])}</strong></span><span class="chip">${esc(j.device)}</span><span class="chip">Route: ${esc(j.planner === 'replayed' ? 'repeated from an earlier run' : 'planned this run')}</span>${j.replayFailed ? '<span class="chip fail">The earlier route stopped working</span>' : ''}<h3>${esc(j.title)}</h3><p class="sub">${esc(j.persona)}${j.why ? `. ${esc(j.why)}` : ''}</p>${j.problem ? `<p>${esc(j.problem)}</p>` : ''}
<div class="strip">${j.stages.map(s => thumb(s.shot, shots, {caption: `${STAGE_LABEL[s.stage]}${s.actionId ? ` ${s.actionId}` : ''}`})).join('')}</div><div class="scroll"><table><tbody>${rows.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</tbody></table></div><p class="sub">${esc(journeyTrend(ux.journeyHistory?.[j.key]))}</p>${steps ? `<details><summary>${esc(j.steps.length)} steps</summary><div class="scroll"><table><thead><tr><th>Action</th><th>Control</th><th>Result</th><th>Listed items</th><th>Feedback</th></tr></thead><tbody>${steps}</tbody></table></div></details>` : ''}</article>`;
  }).join('');
}

function renderResponsive(ux, shots) {
  const templates = [...new Set(ux.pages.map(p => p.template))];
  const blocks = templates.map(t => {
    const pages = ux.pages.filter(p => p.template === t && p.shot);
    if (!pages.length) return '';
    const rows = pages.map(p => `<tr><td>${esc(p.device)}</td><td>${esc(p.design.viewport.w)}x${esc(p.design.viewport.h)}</td><td>${esc(p.design.firstContentY ?? 'n/a')}</td><td>${esc(p.design.firstView.controls)}</td><td>${esc(p.design.bodyFontPx ?? 'n/a')}</td><td>${esc(p.design.h1.fontSize ?? 'none')}</td><td>${esc(p.design.buttonStyles)}</td></tr>`).join('');
    return `<h3>${esc(t)}</h3><div class="compare">${pages.map(p => thumb(p.shot, shots, {caption: `${p.device} (${p.shot})`})).join('')}</div><div class="scroll"><table><thead><tr><th>Device</th><th>Viewport</th><th>Main content starts (px)</th><th>First-screen controls</th><th>Body text (px)</th><th>Page title (px)</th><th>Button styles</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  const parity = ux.parity?.assessed ? `<p>${ux.parity.desktopOnly.length ? `Desktop navigation links not found on the phone: ${esc(ux.parity.desktopOnly.join(', '))}.` : 'Every desktop navigation link was also reachable on the phone.'}</p>` : `<p class="sub">Navigation parity was not assessed. ${esc(ux.parity?.reason || '')}</p>`;
  return blocks + parity;
}

function renderAccessibility(ux, report) {
  const k = ux.keyboard;
  const axe = report.findings.filter(f => f.kind.startsWith('accessibility-') && f.status !== 'TRANSIENT');
  const walks = k.walks.map(w => `<tr><td>${esc(w.template)}</td><td>${esc(w.analysis.stops)}</td><td>${esc(w.analysis.notVisibleCount)}</td><td>${esc(w.analysis.obscured.length)}</td><td>${esc(w.analysis.tabsToMain ?? 'n/a')}</td><td>${esc(w.analysis.skipLink ? 'Yes' : 'No')}</td><td>${esc(w.analysis.trap ? 'Yes' : 'No')}</td></tr>`).join('');
  const activations = k.activations.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.keyboardWorks ? 'Yes' : 'No')}</td><td>${esc(a.navigated ? 'Navigated' : a.openedOverlay ? 'Opened a panel' : 'Updated in place')}</td><td>${esc(a.focusLost ? 'Yes' : 'No')}</td></tr>`).join('');
  const dialogs = k.dialogs.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.semantic ? 'Yes' : 'No')}</td><td>${esc(d.focusMoved ? 'Yes' : 'No')}</td><td>${esc(d.escapedFocus)} of ${esc(d.tabsTried)}</td><td>${esc(d.escapeCloses ? 'Yes' : 'No')}</td><td>${esc(d.focusRestored == null ? 'n/a' : d.focusRestored ? 'Yes' : 'No')}</td></tr>`).join('');
  const trees = k.semantics.map(s => `<tr><td>${esc(s.template)}</td><td>${esc(s.tree.landmarks.main)}</td><td>${esc(s.tree.landmarks.navigation)}</td><td>${esc(s.tree.h1Count)}</td><td>${esc(s.tree.headingCount)}</td><td>${esc(s.tree.headingSkips.length)}</td><td>${esc(s.tree.liveRegions)}</td></tr>`).join('');
  const table = (head, body) => (body ? `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="sub">Not exercised in this run.</p>');
  return `<div class="notice"><strong>This is not a conformance statement.</strong> Automated checks and scripted keyboard tests cover only part of WCAG. A clean result here does not show that the site is accessible. Conformance needs manual review and testing with people who use assistive technology.</div>
<h3>axe-core</h3><p>${esc(report.coverage.a11yPagesScanned || 0)} page views scanned. ${esc(axe.length)} distinct rule violations reported.</p>${axe.length ? list(axe.map(f => `${f.severity}: ${f.title} (${f.devices.join(', ')})`)) : ''}
<h3>Keyboard-only tab walk</h3>${table(['Page', 'Stops', 'No visible focus', 'Focus covered', 'Tabs to content', 'Skip link', 'Trap'], walks)}
<h3>Controls operated by keyboard</h3>${table(['Control', 'Worked', 'Result', 'Focus lost'], activations)}
<h3>Dialogs and panels</h3>${table(['Opened by', 'Exposed as dialog', 'Focus moved in', 'Tabs that left it', 'Escape closes', 'Focus returned'], dialogs)}
<h3>Accessibility tree (Chromium)</h3>${table(['Page', 'Main', 'Navigation', 'H1', 'Headings', 'Skipped levels', 'Live regions'], trees)}`;
}

function executiveBrief(ux) {
  // The most serious well-supported problems, one per criterion so one fault cannot fill the list.
  const ranked = ux.issues.filter(i => i.class !== 'research-needed').sort((a, b) => a.severity.localeCompare(b.severity) || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
  const top = [...new Map([...ranked].reverse().map(i => [i.criterion, i])).values()].reverse().slice(0, 5);
  const goals = [...new Map(ux.journeys.map(j => [j.id, j])).values()];
  const outcomes = goals.map(g => `${g.title}: ${ux.journeys.filter(j => j.id === g.id).map(j => `${OUTCOME_TEXT[j.outcome].toLowerCase()} on ${j.device} in ${j.metrics.actionCount} actions`).join(', ')}`);
  return `<div class="brief"><div class="card"><h3>What visitors are trying to do</h3>${outcomes.length ? list(outcomes) : '<p>No journey ran.</p>'}</div><div class="card"><h3>Where the design makes it harder</h3>${top.length ? list(top.map(i => i.title)) : '<p>No problem with sufficient evidence was recorded in this run. This does not prove there are none.</p>'}</div><div class="card"><h3>What should change first</h3>${top.length ? list([...new Set(top.map(i => i.recommendation))]) : '<p>Nothing is proposed from this run.</p>'}</div><div class="card"><h3>How we will know it worked</h3>${top.length ? list([...new Set(top.map(i => i.acceptanceCriteria[0]))]) : '<p>Re-run this audit after any change.</p>'}<p class="sub">Each issue states its own validation method. The agent re-measures on every run.</p></div></div>`;
}

function renderMethod(ux, report) {
  const notAssessed = Object.values(ux.scorecard).flatMap(c => c.rows.filter(r => r.verdict === 'not-assessed').map(r => r.question));
  const rejected = ux.expert.rejected || [];
  const reasons = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const reasonText = Object.entries(reasons).map(([k, n]) => `${k.replace(/-/g, ' ')}: ${n}`).join('; ');
  return `<p><strong>Measured results</strong> come from a real browser and from rules listed in the scorecard. <strong>Expert judgements</strong> come from a separate review of each group of criteria by Claude using the cited screenshots. Automation timings describe this run and are not estimates of how long a person would take. The agent never reports visitor feelings or satisfaction.</p>
<p>Expert review status: ${esc(ux.expert.status)}. ${esc(ux.expert.reviewedCriteria)} expert criteria assessed. Cross-check: ${esc(ux.expert.verification || 'not run')}. ${esc(rejected.length)} claims discarded by the evidence rules${reasonText ? ` (${esc(reasonText)})` : ''}. ${esc(ux.suppressed.length)} hidden because they had no new evidence or an owner decision.</p>
<p>Claude calls used: ${esc(report.ai?.calls ?? 0)} of ${esc(report.ai?.budget ?? 0)}. Devices: ${esc(ux.devices.join(', '))}.</p>
${notAssessed.length ? `<details><summary>${esc(notAssessed.length)} criteria not assessed in this run</summary>${list(notAssessed)}</details>` : ''}
${report.errors.length ? `<details open><summary>Limitations of this run</summary>${list(report.errors)}</details>` : ''}${ux.resolvedThisRun?.length ? `<h3>No longer present</h3>${list(ux.resolvedThisRun)}` : ''}`;
}

function writeMarkdown(report, out) {
  const {ux} = report;
  const lines = [`# ${report.config.name}: expert UX report`, '', `${report.finishedAt}. Devices: ${ux.devices.join(', ')}.`, '', '> Measured results and expert judgements are labelled separately. Automated accessibility checks do not establish WCAG conformance.', '', '## Scorecard', ''];
  for (const c of Object.values(ux.scorecard)) lines.push(`- **${c.label}:** ${c.score ?? `not scored (${c.reason})`}`);
  lines.push('', '## Visitor journeys', '');
  for (const j of ux.journeys) lines.push(`- **${OUTCOME_TEXT[j.outcome]}** on ${j.device}: ${j.title}. ${j.metrics.actionCount} actions, ${j.metrics.backtracks} returns, ${j.metrics.deadEnds} dead ends.`);
  for (const cls of Object.keys(CLASS_LABEL)) {
    const issues = ux.issues.filter(i => i.class === cls);
    if (!issues.length) continue;
    lines.push('', `## ${CLASS_LABEL[cls]}`, '', introFor(cls, ux), '');
    for (const i of issues) {
      lines.push(`### ${i.severity}: ${i.title}`, '', `- **Who:** ${i.persona}, trying to: ${i.userGoal}`, `- **Principle:** ${i.principle}`, `- **Severity, confidence, scope:** ${i.severity}, ${i.confidence}, ${i.scope}`, `- **Problem:** ${i.problem}`, `- **Evidence:** ${i.observedEvidence} (${i.evidenceRefs.join(', ')})`, `- **Reproduce:** ${i.reproductionSteps.join('; ')}`, `- **${i.rootCause?.status === 'established' ? 'Cause' : 'Likely cause (hypothesis)'}:** ${i.rootCause?.text}`, `- **Recommendation:** ${i.recommendation}`, `- **Alternative:** ${i.alternative}`, `- **Expected benefit:** ${i.expectedBenefit}`, `- **Implementation:** ${i.implementationGuidance}`, `- **Acceptance:** ${i.acceptanceCriteria.join('; ')}`, `- **Validate:** ${i.validationMethod}`, '');
    }
  }
  if (report.errors.length) lines.push('', '## Limitations', ...report.errors.map(x => `- ${cleanText(x, 400)}`));
  fs.writeFileSync(path.join(out, 'ux-report.md'), `${lines.join('\n')}\n`);
}

export function writeUxReport(report, out) {
  const {ux} = report;
  const target = path.join(out, 'site', 'ux');
  fs.mkdirSync(path.join(target, 'shots'), {recursive: true});
  const shots = new Map();
  for (const s of ux.shots) {
    const from = path.join(out, s.jpg);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(target, 'shots', path.basename(s.jpg)));
    shots.set(s.id, s);
  }
  const sections = Object.keys(CLASS_LABEL).map(cls => {
    const issues = ux.issues.filter(i => i.class === cls);
    return `<section id="${cls}"><h2>${esc(CLASS_LABEL[cls])} (${issues.length})</h2><p class="sub">${esc(introFor(cls, ux))}</p>${issues.map(i => renderIssue(i, shots)).join('') || '<p>None in this run.</p>'}</section>`;
  }).join('');
  const legend = Object.entries(SEVERITY_MEANING).map(([k, x]) => `<span class="chip sev ${k}">${k}</span> ${esc(x)}`).join(' &nbsp; ');
  const body = `<nav aria-label="Report sections"><a href="#brief">Summary</a><a href="#scorecard">Scorecard</a><a href="#journeys">Journeys</a><a href="#detected-defect">Defects</a><a href="#expert-judgment">Judgements</a><a href="#research-needed">Research</a><a href="#visual">Visual</a><a href="#accessibility">Accessibility</a><a href="#method">Method</a><a href="../index.html">Technical report</a></nav><main>
<header><h1>${esc(report.config.name)}: expert UX report</h1><p class="sub">${esc(report.config.url)} · ${esc(report.finishedAt)} · ${esc(ux.devices.join(', '))}</p></header>
<section id="brief"><h2>Summary</h2>${executiveBrief(ux)}<p class="sub">${legend}</p></section>
<section id="scorecard"><h2>UX scorecard</h2>${renderScorecard(ux)}</section>
<section id="journeys"><h2>Visitor journeys</h2><p class="sub">A journey counts as reached only when a condition fixed in advance is true on the final page. An automated route may differ from what a person would do.</p>${renderJourneys(ux, shots)}</section>
${sections}
<section id="visual"><h2>Visual design across devices</h2>${renderResponsive(ux, shots)}</section>
<section id="accessibility"><h2>Accessibility</h2>${renderAccessibility(ux, report)}</section>
<section id="method"><h2>Method and limits</h2>${renderMethod(ux, report)}</section></main>`;
  fs.writeFileSync(path.join(target, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(report.config.name)} UX report</title><style>${CSS}</style></head><body>${body}</body></html>`);
  fs.writeFileSync(path.join(target, 'files.json'), JSON.stringify(['index.html', ...[...shots.values()].map(s => `shots/${path.basename(s.jpg)}`)]));
  writeMarkdown(report, out);
}
