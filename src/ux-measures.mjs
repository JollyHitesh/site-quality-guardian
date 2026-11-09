// Rules over measurements. Each returns a verdict for one criterion, plus problem records that
// carry their evidence. No model is involved, so the same measurements give the same result.
import crypto from 'node:crypto';
import {CATALOG} from './ux-catalog.mjs';
import {criterionById, severityOf, DIMENSIONS} from './ux-framework.mjs';

const unique = list => [...new Set(list.filter(Boolean))];
const v = (verdict, detail, evidenceRefs = []) => ({verdict, detail, evidenceRefs: unique(evidenceRefs).slice(0, 8)});
const NOT = reason => v('not-assessed', reason);
const byCount = (n, detail, refs, concernUpTo = 1) => v(n === 0 ? 'pass' : n <= concernUpTo ? 'concern' : 'fail', detail, refs);
const byShare = (bad, total, detail, refs) => v(!bad ? 'pass' : bad * 2 < total ? 'concern' : 'fail', detail, refs);
const journeyRefs = j => unique([...(j.stages || []).map(s => s.shot), ...j.steps.map(s => s.actionId)]);
const stepRefs = (j, step) => unique([step.actionId, (j.stages || []).find(s => s.actionId === step.actionId)?.shot]);

function evaluateJourneys(d, t, add) {
  const all = d.journeys;
  const out = {};
  const conclusive = all.filter(j => j.outcome !== 'INCOMPLETE');
  const failed = all.filter(j => j.outcome === 'FAILURE');
  for (const j of failed) add({kind: 'journey-failed', subject: j.key, device: j.device, journey: j, m: {problem: j.problem}, refs: journeyRefs(j)});
  out['E-journey-success'] = !conclusive.length ? NOT('No journey reached a conclusive outcome in this run.')
    : failed.length ? v('fail', `${failed.length} of ${conclusive.length} conclusive journeys failed.`, failed.flatMap(journeyRefs)) : v('pass', `${conclusive.length} of ${conclusive.length} conclusive journeys reached their verified goal.`, conclusive.flatMap(journeyRefs));

  const succeeded = all.filter(j => j.outcome === 'SUCCESS');
  const judged = succeeded.filter(j => j.targetActions || j.metrics.excessOverShortest !== null);
  let worst = 0;
  for (const j of judged) {
    const overTarget = j.targetActions ? j.metrics.actionCount - j.targetActions : 0;
    const excess = j.metrics.excessOverShortest || 0;
    worst = Math.max(worst, overTarget);
    if (overTarget >= t.actionsOverTargetConcern || excess >= t.excessOverShortest) {
      add({kind: 'journey-excess-actions', subject: j.key, device: j.device, journey: j, m: {actions: j.metrics.actionCount, target: j.targetActions, shortest: excess >= t.excessOverShortest ? j.metrics.shortestKnownActions : null}, refs: journeyRefs(j)});
      if (excess >= t.excessOverShortest) worst = Math.max(worst, t.actionsOverTargetConcern);
    }
  }
  out['E-action-target'] = !judged.length ? NOT('No successful journey had an action target or a known shorter route.')
    : v(worst >= t.actionsOverTargetFail ? 'fail' : worst >= t.actionsOverTargetConcern ? 'concern' : 'pass', judged.map(j => `${j.title}: ${j.metrics.actionCount} actions${j.targetActions ? ` of target ${j.targetActions}` : ''}`).join('; '), judged.flatMap(journeyRefs));

  const executed = all.filter(j => j.metrics.actionCount > 0);
  if (!executed.length) {
    for (const id of ['E-backtrack', 'E-dead-ends', 'E-interstitial', 'C-result-visible', 'C-feedback']) out[id] = NOT('No journey executed an action in this run.');
    return out;
  }
  let backtrackWorst = 0;
  for (const j of executed) {
    const n = j.metrics.backtracks + j.metrics.repeatedActions;
    backtrackWorst = Math.max(backtrackWorst, n);
    if (n) add({kind: 'journey-backtracking', subject: j.key, device: j.device, journey: j, m: {backtracks: j.metrics.backtracks, repeated: j.metrics.repeatedActions}, refs: journeyRefs(j)});
  }
  out['E-backtrack'] = v(backtrackWorst === 0 ? 'pass' : backtrackWorst === 1 ? 'concern' : 'fail', `Most loops or repeats on one journey: ${backtrackWorst}. Automated path, so a person may differ.`, executed.flatMap(journeyRefs));

  let deadEnds = 0, stranded = 0;
  const deadRefs = [];
  for (const j of executed) {
    for (const s of j.steps.filter(x => x.ok && ((x.changed === false && !x.navigated) || x.empty))) {
      deadEnds++;
      if (!s.recovery.length) stranded++;
      deadRefs.push(...stepRefs(j, s));
      add({kind: 'journey-dead-end', subject: `${j.key}|${s.key}`, device: j.device, journey: j, m: {control: s.control, recovery: s.recovery.length > 0}, refs: stepRefs(j, s)});
    }
  }
  out['E-dead-ends'] = v(!deadEnds ? 'pass' : stranded ? 'fail' : 'concern', `${deadEnds} dead-end step(s), ${stranded} with no visible way out.`, deadRefs.length ? deadRefs : executed.flatMap(journeyRefs));

  let interstitial = 0;
  const interstitialRefs = [];
  for (const j of executed) {
    j.steps.filter(s => s.ok).forEach((s, i, list) => {
      if (!s.interstitial || i === list.length - 1) return;
      interstitial++;
      interstitialRefs.push(...stepRefs(j, s));
      add({kind: 'journey-interstitial', subject: `${j.key}|${s.toUrl}`, device: j.device, journey: j, m: {control: s.control}, refs: stepRefs(j, s)});
    });
  }
  out['E-interstitial'] = byCount(interstitial, `${interstitial} step(s) mainly passed the visitor on to another step.`, interstitialRefs.length ? interstitialRefs : executed.flatMap(journeyRefs));

  const content = executed.flatMap(j => j.steps.filter(s => s.ok && !s.navigated && s.feedback !== 'unknown' && s.changed !== false).map(s => ({j, s})));
  const off = content.filter(x => x.s.feedback === 'off-screen');
  for (const {j, s} of off) add({kind: 'journey-result-offscreen', subject: `${j.key}|${s.key}`, device: j.device, journey: j, m: {control: s.control}, refs: stepRefs(j, s)});
  out['C-result-visible'] = !content.length ? NOT('No journey step updated the page in place.')
    : v(!off.length ? 'pass' : off.length * 2 >= content.length ? 'fail' : 'concern', `${content.length - off.length} of ${content.length} in-place updates had visible content change in the viewport or none to show.`, off.length ? off.flatMap(x => stepRefs(x.j, x.s)) : content.flatMap(x => stepRefs(x.j, x.s)));

  const silent = content.filter(x => x.s.feedback === 'none' && x.s.expanded === 0 && !x.s.dialogOpen);
  for (const {j, s} of silent) add({kind: 'journey-no-feedback', subject: `${j.key}|${s.key}`, device: j.device, journey: j, m: {control: s.control}, refs: stepRefs(j, s)});
  out['C-feedback'] = !content.length ? NOT('No journey step updated the page in place.') : byCount(silent.length, `${silent.length} of ${content.length} in-place actions showed no visible content change.`, silent.length ? silent.flatMap(x => stepRefs(x.j, x.s)) : content.flatMap(x => stepRefs(x.j, x.s)));
  return out;
}

function evaluateRecovery(d, add) {
  const {emptySearch: e, notFound: n} = d.recovery;
  const refs = [];
  let fails = 0, concerns = 0, tested = 0;
  if (e?.tested) {
    tested++;
    const shot = unique([e.shot, e.action]);
    refs.push(...shot);
    if (!e.hasMessage) { fails++; add({kind: 'empty-no-message', subject: 'search', device: e.device, template: e.template, m: {}, refs: shot}); }
    if (!e.recovery.length) { fails++; add({kind: 'empty-no-recovery', subject: 'search', device: e.device, template: e.template, m: {}, refs: shot}); }
  }
  if (n?.tested) {
    tested++;
    const shot = unique([n.shot, n.action]);
    refs.push(...shot);
    if (n.status === 200) { concerns++; add({kind: 'notfound-soft', subject: 'status', device: n.device, template: '(error page)', m: {status: n.status}, refs: shot}); }
    if (!n.hasMessage || !n.internalLinks) { fails++; add({kind: 'notfound-no-path', subject: 'path', device: n.device, template: '(error page)', m: {hasMessage: n.hasMessage}, refs: shot}); }
  }
  for (const f of d.findings.filter(x => x.kind === 'filter-empty-unexplained')) { fails++; refs.push(f.stepId); }
  if (!tested) return NOT('Neither an empty search nor a missing page could be probed.');
  return v(fails ? 'fail' : concerns ? 'concern' : 'pass', `${tested} recovery probe(s): ${fails} failing and ${concerns} partial.`, refs);
}

function evaluateDesign(d, t, add) {
  const out = {};
  const pages = d.pages.filter(p => p.design);
  if (!pages.length) {
    for (const id of ['V-primary-position', 'V-h1', 'V-legibility', 'V-affordance', 'V-consistency', 'V-density', 'D-hover', 'D-link-labels', 'D-key-controls']) out[id] = NOT('No page could be measured in this run.');
    return out;
  }
  const refsOf = list => unique(list.map(p => p.shot));
  const seed = (p, kind, m, subject = p.template) => add({kind, subject, device: p.device, template: p.template, m, refs: unique([p.shot])});
  const count = (id, bad, passDetail, badDetail) => { out[id] = byShare(bad.length, pages.length, bad.length ? badDetail : passDetail, refsOf(bad.length ? bad : pages)); };

  const late = pages.filter(p => p.design.firstContentY !== null && p.design.firstContentY / p.design.viewport.h > t.firstContentMaxViewportShare);
  late.forEach(p => seed(p, 'primary-content-late', {y: p.design.firstContentY, viewport: p.design.viewport.h, share: p.design.firstContentY / p.design.viewport.h}));
  out['V-primary-position'] = byShare(late.length, pages.length, `${late.length} of ${pages.length} measured views start their main content late.`, refsOf(late.length ? late : pages));

  const weak = pages.filter(p => p.design.h1.count && p.design.bodyFontPx && p.design.h1.fontSize / p.design.bodyFontPx < t.h1MinRatio);
  weak.forEach(p => seed(p, 'weak-page-title', {h1: p.design.h1.fontSize, body: p.design.bodyFontPx, ratio: Number((p.design.h1.fontSize / p.design.bodyFontPx).toFixed(2))}));
  count('V-h1', weak, `The page title is at least ${t.h1MinRatio} times the body size on all measured pages.`, `${weak.length} page(s) have a weak title.`);

  const illegible = pages.map(p => {
    const reasons = [];
    if (p.design.bodyFontPx && p.design.bodyFontPx < t.bodyFontMinPx) reasons.push(`Most text on this page is ${p.design.bodyFontPx}px, below the ${t.bodyFontMinPx}px limit.`);
    if (p.design.lineLengthChars && p.design.lineLengthChars > t.lineLengthMaxChars) reasons.push(`Median line length is about ${p.design.lineLengthChars} characters, above the limit of ${t.lineLengthMaxChars}.`);
    return {p, reasons};
  }).filter(x => x.reasons.length);
  illegible.forEach(({p, reasons}) => seed(p, 'legibility-limits', {reasons}));
  count('V-legibility', illegible.map(x => x.p), 'Body size and line length are within limits.', `${illegible.length} page(s) exceed a legibility limit.`);

  const flat = pages.filter(p => p.design.lowAffordance.length);
  flat.forEach(p => seed(p, 'low-affordance', {count: p.design.lowAffordance.length, first: p.design.lowAffordance[0].label}));
  out['V-affordance'] = byShare(flat.length, pages.length, flat.length ? `${flat.length} page(s) have buttons with no visible boundary or marker.` : 'Every button has a visible boundary or marker.', refsOf(flat.length ? flat : pages));

  const sprawl = pages.filter(p => p.design.buttonStyles > t.distinctButtonStyles);
  sprawl.forEach(p => seed(p, 'button-style-sprawl', {count: p.design.buttonStyles}));
  count('V-consistency', sprawl, `No page has more than ${t.distinctButtonStyles} button styles.`, `${sprawl.length} page(s) exceed the style limit.`);

  const limitOf = p => (p.family === 'mobile' ? t.firstViewControlsMobile : t.firstViewControlsDesktop);
  const crowded = pages.filter(p => p.design.firstView.controls > limitOf(p));
  crowded.forEach(p => seed(p, 'control-overload', {count: p.design.firstView.controls, limit: limitOf(p)}));
  count('V-density', crowded, 'First-screen control counts are within the limits.', `${crowded.length} page(s) exceed the first-screen control limit.`);

  const hover = pages.filter(p => p.design.hoverReveals.length);
  hover.forEach(p => seed(p, 'hover-only-control', {count: p.design.hoverReveals.length, first: p.design.hoverReveals[0]}));
  const rules = new Set(hover.flatMap(p => p.design.hoverReveals));
  out['D-hover'] = v(!rules.size ? 'pass' : rules.size === 1 ? 'concern' : 'fail', `${rules.size} hover-only reveal rule(s) found.`, refsOf(hover.length ? hover : pages));

  const conflicts = pages.flatMap(p => p.design.navConflicts.map(c => ({p, c})));
  conflicts.forEach(({p, c}) => seed(p, 'nav-label-conflict', {label: c.label, destinations: c.destinations}, c.label));
  const conflictLabels = new Set(conflicts.map(x => x.c.label));
  out['D-link-labels'] = byCount(conflictLabels.size, `${conflictLabels.size} navigation label(s) point to more than one destination.`, refsOf(conflicts.length ? conflicts.map(x => x.p) : pages));

  // Key controls are judged where a visitor arrives.
  const landings = pages.filter(p => p.template === '/');
  const buried = [];
  let found = 0;
  for (const p of landings) {
    const visible = p.design.keyControls.filter(c => c.y <= p.design.viewport.h * t.keyControlMaxViewports);
    const depths = Object.entries(d.keyControlDepth?.[p.device] || {});
    if (p.design.keyControls.length || depths.length) found++;
    if (!visible.length && p.design.keyControls.length) { buried.push(p); seed(p, 'key-control-buried', {label: p.design.keyControls[0].label, reason: `${Math.round(p.design.keyControls[0].y / p.design.viewport.h * 10) / 10} screens down the page`}, p.design.keyControls[0].label); }
    if (!p.design.keyControls.length && !depths.length && d.keyControlsDeclared) { buried.push(p); seed(p, 'key-control-buried', {missing: true, template: p.template}, 'missing'); }
    for (const [term, {depth, name}] of depths) {
      const onFirstScreens = visible.some(c => new RegExp(term, 'i').test(c.label));
      if (depth > t.keyControlMaxDepth && !onFirstScreens) { buried.push(p); seed(p, 'key-control-buried', {label: name, reason: `${depth} actions away from the first screen`}, term); }
    }
  }
  out['D-key-controls'] = !landings.length ? NOT('The landing page was not measured.') : (!found && !d.keyControlsDeclared) ? NOT('No search or filter control exists to judge, and none is declared for this site.')
    : byCount(buried.length, buried.length ? `${buried.length} device(s) have the main control out of easy reach.` : 'Key controls are in the first two screens or one action away.', refsOf(buried.length ? buried : landings));
  return out;
}

function evaluateFindings(d, add) {
  const mobile = d.pages.some(p => p.family === 'mobile');
  const out = {};
  const severe = ['layout-overflow', 'tap-target-too-small', 'sticky-coverage'];
  const comfort = ['primary-tap-target-small', 'input-zoom-ios'];
  const layout = d.findings.filter(f => [...severe, ...comfort].includes(f.kind));
  out['V-mobile-layout'] = !mobile ? NOT('No phone was audited.') : v(layout.some(f => severe.includes(f.kind)) ? 'fail' : layout.length ? 'concern' : 'pass', layout.length ? `Phone layout findings: ${unique(layout.map(f => f.kind)).join(', ')}.` : 'No phone layout finding was recorded.', d.pages.filter(p => p.family === 'mobile').map(p => p.shot));
  const axe = d.findings.filter(f => f.kind.startsWith('accessibility-'));
  out['A-axe'] = !d.a11yPagesScanned ? NOT('axe-core could not scan any page.') : v(axe.some(f => ['P1', 'P2'].includes(f.severity)) ? 'fail' : axe.length ? 'concern' : 'pass', `axe-core scanned ${d.a11yPagesScanned} page view(s) and reported ${axe.length} distinct rule violation(s). Automated rules cannot establish conformance.`, d.pages.slice(0, 4).map(p => p.shot));
  for (const f of d.findings) {
    const axeRule = f.kind.startsWith('accessibility-');
    if (!axeRule && !CATALOG[f.kind]) continue;
    const instance = f.instances[0]?.evidence || {};
    const shots = f.instances.map(i => i.evidence?.screenshot).filter(Boolean).map(file => d.shotIdOf(file));
    const pageShots = d.pages.filter(p => f.devices.includes(p.device) && f.pages.includes(p.template)).map(p => p.shot);
    const refs = unique([...shots, ...(d.actionIds.has(f.stepId) ? [f.stepId] : []), ...pageShots]).slice(0, 4);
    add({kind: axeRule ? 'accessibility-axe' : f.kind, subject: axeRule ? `${instance.rule}` : `${f.kind}|${f.scope || f.pages[0] || ''}`, device: f.devices[0], devices: f.devices, templates: f.pages, m: axeRule ? {rule: instance.rule, help: f.title.replace(/^Accessibility: /, ''), affected: instance.affected, helpUrl: instance.help, selectors: JSON.stringify(instance.selectors || []).slice(0, 200)} : {title: f.title}, refs, severityHint: f.severity, finding: f.fingerprint});
  }
  return out;
}

function evaluateKeyboard(d, t, add) {
  const k = d.keyboard;
  const ids = ['A-focus-visible', 'A-reachable', 'A-order', 'A-dialog', 'A-focus-recovery', 'A-semantics'];
  if (!k?.tested) return Object.fromEntries(ids.map(id => [id, NOT('Keyboard tests did not run.')]));
  const out = {};
  const walks = k.walks.filter(w => w.analysis.stops > 0);
  let hidden = 0, obscured = 0;
  const focusRefs = [];
  for (const w of walks) {
    const a = w.analysis;
    const refs = unique([w.shot, w.action]);
    focusRefs.push(...refs);
    hidden += a.notVisibleCount;
    obscured += a.obscured.length;
    if (a.notVisibleCount) add({kind: 'kb-focus-not-visible', subject: w.template, device: k.device, template: w.template, m: {count: a.notVisibleCount, stops: a.stops}, refs});
    if (a.obscured.length) add({kind: 'kb-focus-obscured', subject: w.template, device: k.device, template: w.template, m: {names: a.obscured}, refs});
    if (a.trap) add({kind: 'kb-trap', subject: w.template, device: k.device, template: w.template, m: {at: a.trap.at}, refs});
    if (a.orderJumps.length) add({kind: 'kb-order-jumps', subject: w.template, device: k.device, template: w.template, m: {count: a.orderJumps.length, first: a.orderJumps[0]}, refs});
    if (a.positiveTabindex.length) add({kind: 'kb-positive-tabindex', subject: w.template, device: k.device, template: w.template, m: {names: a.positiveTabindex}, refs});
    if (a.tabsToMain && a.tabsToMain > t.tabsToMainNoSkip && !a.skipLink) add({kind: 'kb-long-route', subject: w.template, device: k.device, template: w.template, m: {tabs: a.tabsToMain}, refs});
  }
  const totalStops = walks.reduce((n, w) => n + w.analysis.stops, 0);
  out['A-focus-visible'] = !walks.length ? NOT('No tab stop was found.') : v(hidden + obscured === 0 ? 'pass' : hidden > totalStops * 0.2 ? 'fail' : 'concern', `${hidden} of ${totalStops} tab stops showed no visible focus, and ${obscured} were covered.`, focusRefs);

  const pointerRefs = unique([...k.pointerOnly.flatMap(x => [x.shot, x.action])]);
  if (k.pointerOnly.length) add({kind: 'kb-unreachable-control', subject: 'pointer-only', device: k.device, template: '/', m: {names: k.pointerOnly.flatMap(x => x.names).slice(0, 8)}, refs: pointerRefs});
  const inert = k.activations.filter(a => a.keyboardWorks === false && a.mouseWorks);
  for (const a of inert) add({kind: 'kb-activation-fails', subject: a.key, device: k.device, template: a.template, m: {name: a.name}, refs: unique([a.shot, a.action])});
  const unreachableCount = k.pointerOnly.reduce((n, x) => n + x.names.length, 0) + inert.length;
  out['A-reachable'] = byCount(unreachableCount, `${unreachableCount} control(s) failed by keyboard. ${k.activations.length} control(s) were activated by keyboard.`, unreachableCount ? [...pointerRefs, ...inert.flatMap(a => [a.shot, a.action])] : [...focusRefs, ...k.activations.map(a => a.action)]);

  const traps = walks.filter(w => w.analysis.trap);
  const jumps = walks.reduce((n, w) => n + w.analysis.orderJumps.length + w.analysis.positiveTabindex.length + (w.analysis.tabsToMain > t.tabsToMainNoSkip && !w.analysis.skipLink ? 1 : 0), 0);
  out['A-order'] = !walks.length ? NOT('No tab stop was found.') : v(traps.length ? 'fail' : jumps ? 'concern' : 'pass', `${traps.length} keyboard trap(s) and ${jumps} order or route problem(s).`, focusRefs);

  let dialogProblems = 0;
  const dialogRefs = [];
  for (const dlg of k.dialogs) {
    const refs = unique([dlg.shot, dlg.action]);
    dialogRefs.push(...refs);
    const seed = (kind, m) => { dialogProblems++; add({kind, subject: dlg.key, device: k.device, template: dlg.template, m: {name: dlg.name, ...m}, refs}); };
    if (!dlg.semantic) seed('dialog-no-semantics', {});
    if (!dlg.focusMoved) seed('dialog-focus-not-moved', {});
    if (dlg.escapedFocus > 0) seed('dialog-focus-escapes', {count: dlg.escapedFocus, tabs: dlg.tabsTried});
    if (dlg.escapeCloses === false) seed('dialog-no-escape', {});
    if (dlg.escapeCloses && dlg.focusRestored === false) seed('dialog-focus-not-restored', {});
  }
  out['A-dialog'] = !k.dialogs.length ? NOT('No dialog or overlay was opened during the keyboard test.') : byCount(dialogProblems, `${k.dialogs.length} overlay(s) tested, ${dialogProblems} focus-management problem(s).`, dialogRefs);

  const inPlace = k.activations.filter(a => a.keyboardWorks && !a.navigated && !a.openedOverlay);
  const lost = inPlace.filter(a => a.focusLost);
  for (const a of lost) add({kind: 'kb-focus-lost', subject: a.key, device: k.device, template: a.template, m: {name: a.name}, refs: unique([a.shot, a.action])});
  out['A-focus-recovery'] = !inPlace.length ? NOT('No control updated the page in place during the keyboard test.') : byCount(lost.length, `${lost.length} of ${inPlace.length} in-place actions lost focus.`, inPlace.map(a => a.action));

  let gaps = 0;
  const semRefs = [];
  for (const s of k.semantics) {
    const refs = unique([s.shot, s.action]);
    semRefs.push(...refs);
    const missing = ['main', 'navigation'].filter(r => !s.tree.landmarks[r]);
    if (missing.length) { gaps++; add({kind: 'sem-landmarks', subject: s.template, device: k.device, template: s.template, m: {missing}, refs}); }
    if (s.tree.h1Count === 0 || s.tree.headingSkips.length) { gaps++; add({kind: 'sem-headings', subject: s.template, device: k.device, template: s.template, m: {h1Count: s.tree.h1Count, first: s.tree.headingSkips[0]}, refs}); }
  }
  // Several filters with the same fault are one fix.
  const stateless = k.activations.filter(x => x.stateHidden);
  if (stateless.length) {
    gaps += stateless.length;
    const refs = unique(stateless.flatMap(a => [a.shot, a.action]));
    semRefs.push(...refs);
    add({kind: 'sem-state-not-exposed', subject: 'controls', device: k.device, template: stateless[0].template, m: {name: stateless.map(a => a.name).join('", "')}, refs});
  }
  const silentUpdates = d.journeys.flatMap(j => j.steps.filter(s => s.ok && s.listingChanged && !s.navigated && !s.liveRegionPresent).map(s => ({j, s})));
  if (silentUpdates.length) { gaps++; const refs = silentUpdates.flatMap(x => stepRefs(x.j, x.s)); semRefs.push(...refs); add({kind: 'sem-no-status', subject: 'results', device: silentUpdates[0].j.device, template: '/', m: {count: silentUpdates.length}, refs}); }
  out['A-semantics'] = !k.semantics.length ? NOT('The accessibility tree could not be read.') : byCount(gaps, gaps ? `${gaps} structural or state gap(s) in the accessibility tree.` : 'Landmarks, headings and the tested control states are exposed.', semRefs);
  return out;
}

function evaluateParity(d, add) {
  const p = d.parity;
  if (!p?.assessed) return NOT(p?.reason || 'Phone and desktop navigation could not be compared.');
  if (p.desktopOnly.length) add({kind: 'desktop-only-destination', subject: 'nav', device: p.phoneDevice, template: '/', m: {paths: p.desktopOnly.slice(0, 8)}, refs: p.refs});
  return byCount(p.desktopOnly.length, `${p.desktopOnly.length} desktop navigation destination(s) were not found on the phone.`, p.refs);
}

// The count is exact, but one automated route may not be the route a person would take.
const LOW_CONFIDENCE = new Set(['journey-excess-actions', 'journey-backtracking']);
const MEDIUM_CONFIDENCE = new Set(['journey-interstitial', 'journey-failed', 'key-control-buried', 'primary-content-late', 'desktop-only-destination', 'kb-order-jumps', 'control-no-effect', 'state-lost-on-reload', 'filter-empty-unexplained', 'sem-no-status']);
// The same fault on many page types is one fix, so it is one issue with a wider scope.
const SITE_WIDE = new Set(['weak-page-title', 'legibility-limits', 'low-affordance', 'button-style-sprawl', 'primary-content-late', 'control-overload', 'kb-focus-not-visible', 'kb-focus-obscured', 'sem-landmarks', 'sem-headings', 'kb-long-route', 'hover-only-control']);
const fingerprint = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);

/** Expands merged problem records into the full structure a designer or developer can act on. */
export function buildMeasuredIssues(seeds, {audience, coreTemplates, devices}) {
  const merged = new Map();
  for (const s of seeds) {
    const id = SITE_WIDE.has(s.kind) ? `${s.kind}|site` : `${s.kind}|${s.subject}`;
    if (!merged.has(id)) merged.set(id, {...s, mergeKey: id, devices: [], templates: [], refs: [], journeys: []});
    const m = merged.get(id);
    m.devices = unique([...m.devices, ...(s.devices || [s.device])]);
    m.templates = unique([...m.templates, ...(s.templates || [s.template || s.journey?.template || '/'])]);
    m.refs = unique([...m.refs, ...s.refs]);
    if (s.journey) m.journeys = unique([...m.journeys, s.journey]);
  }
  const issues = [];
  let withoutEvidence = 0;
  for (const s of merged.values()) {
    const entry = CATALOG[s.kind];
    if (!entry) continue;
    if (!s.refs.length) { withoutEvidence++; continue; }
    const criterion = criterionById(entry.criterion);
    const journey = s.journeys[0];
    const core = !!journey?.coreTask || s.templates.some(t => coreTemplates.includes(t));
    const confidence = LOW_CONFIDENCE.has(s.kind) ? 'low' : MEDIUM_CONFIDENCE.has(s.kind) ? 'medium' : 'high';
    const problem = journey ? `${journey.title}: ${entry.problem(s.m)}` : entry.problem(s.m);
    const guide = typeof entry.guide === 'function' ? entry.guide(s.m) : entry.guide;
    const reproduction = journey
      ? [`Open ${journey.startUrl} on ${journey.device} as a new visitor`, ...journey.steps.filter(x => x.ok).map(x => `${x.kind === 'navigate' ? 'Follow' : 'Activate'} "${x.control}" (${x.actionId})`)]
      : [`Open ${s.templates[0]} on ${s.devices.join(', ')}`, `Check: ${criterion.question}`];
    issues.push({
      id: `ux-${s.kind}-${fingerprint(s.mergeKey)}`, kind: s.kind, class: 'detected-defect', provenance: 'measured',
      criterion: criterion.id, dimension: criterion.dimension, principle: DIMENSIONS[criterion.dimension], wcag: criterion.wcag || [],
      userGoal: journey?.title || entry.goal || criterion.question, persona: entry.persona || journey?.persona || audience,
      title: problem.slice(0, 150), problem, observedEvidence: `${problem} Measured by the audit on ${s.devices.join(', ')}.`, measurements: s.m,
      evidenceRefs: s.refs.slice(0, 6), reproductionSteps: reproduction.slice(0, 10),
      // axe-core already rates its own rules, so that rating is kept.
      severity: s.kind === 'accessibility-axe' && s.severityHint ? s.severityHint : severityOf({impact: entry.impact, core, objective: true, confidence, allDevices: devices.length > 1 && devices.every(x => s.devices.includes(x))}),
      impact: entry.impact, confidence, scope: s.templates.length > 1 ? 'multiple-page-types' : core ? 'core-page-type' : 'single-page-type', templates: s.templates, devices: s.devices,
      rootCause: {text: entry.cause, status: entry.established ? 'established' : 'hypothesis'}, recommendation: entry.fix, alternative: entry.alt, expectedBenefit: entry.benefit, implementationGuidance: guide,
      acceptanceCriteria: entry.accept, validationMethod: entry.validate, findingRef: s.finding || null,
    });
  }
  return {issues, withoutEvidence};
}

/** Every measured criterion gets a verdict, even if that verdict is "not assessed". */
export function evaluateMeasured(data, thresholds) {
  const seeds = [];
  const add = s => seeds.push(s);
  const results = {
    ...evaluateJourneys(data, thresholds, add), ...evaluateDesign(data, thresholds, add), ...evaluateFindings(data, add), ...evaluateKeyboard(data, thresholds, add),
    'C-recovery': evaluateRecovery(data, add), 'V-parity': evaluateParity(data, add),
  };
  return {assessments: Object.entries(results).map(([criterion, r]) => ({criterion, provenance: 'measured', ...r})), seeds};
}
