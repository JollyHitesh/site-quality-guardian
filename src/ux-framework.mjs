// The evaluation method, as data. Every criterion is assessed on its own, either by a rule over
// measurements or by an expert review that must cite evidence. Nothing here depends on a prompt.
import crypto from 'node:crypto';

export const DIMENSIONS = {
  'nielsen-1': 'Visibility of system status (Nielsen 1)',
  'nielsen-2': 'Match between system and the real world (Nielsen 2)',
  'nielsen-3': 'User control and freedom (Nielsen 3)',
  'nielsen-4': 'Consistency and standards (Nielsen 4)',
  'nielsen-5': 'Error prevention (Nielsen 5)',
  'nielsen-6': 'Recognition rather than recall (Nielsen 6)',
  'nielsen-7': 'Flexibility and efficiency of use (Nielsen 7)',
  'nielsen-8': 'Aesthetic and minimalist design (Nielsen 8)',
  'nielsen-9': 'Help users recognise, diagnose and recover from errors (Nielsen 9)',
  'nielsen-10': 'Help and documentation (Nielsen 10)',
  'information-architecture': 'Information architecture',
  'cognitive-load': 'Cognitive load',
  'progressive-disclosure': 'Progressive disclosure',
  'interaction-design': 'Interaction design',
  'visual-hierarchy': 'Visual hierarchy',
  'visual-craft': 'Visual craft: density, legibility, spacing and affordance',
  'responsive-behaviour': 'Responsive behaviour',
  'wcag-operable': 'WCAG: operable by keyboard',
  'wcag-robust': 'WCAG: perceivable and robust semantics',
};

export const CATEGORIES = {
  discoverability: 'Discoverability',
  'task-efficiency': 'Task efficiency',
  clarity: 'Clarity',
  'visual-design': 'Visual design',
  accessibility: 'Accessibility',
};

const measured = (id, dimension, category, weight, question, pass, concern, fail, wcag) => ({id, dimension, category, weight, method: 'measured', question, rubric: {pass, concern, fail}, wcag});
const expert = (id, dimension, category, batch, question, lookFor) => ({id, dimension, category, weight: 1, method: 'expert', batch, question, lookFor, rubric: {pass: 'Cited evidence shows the criterion is met', concern: 'Cited evidence shows a limited or partial problem', fail: 'Cited evidence shows a clear problem on an important screen'}});

export const CRITERIA = [
  // Measured: a rule decides, so the result is reproducible.
  measured('D-key-controls', 'information-architecture', 'discoverability', 3, 'Can visitors find the main search and filter controls without digging?', 'Every key control is within the limits below', 'One key control exceeds a limit', 'No key control could be found, or several exceed a limit'),
  measured('D-hover', 'interaction-design', 'discoverability', 2, 'Is anything revealed only by hovering?', 'No hover-only reveal rule found', 'One hover-only reveal rule', 'Several hover-only reveal rules'),
  measured('D-link-labels', 'information-architecture', 'discoverability', 2, 'Do navigation labels identify one destination each?', 'No conflicting labels', 'One conflict', 'Several conflicts', ['2.4.4']),
  measured('E-journey-success', 'nielsen-7', 'task-efficiency', 4, 'Did conclusive visitor journeys reach their verified goal?', 'All conclusive journeys succeeded', 'Not used', 'A journey failed with evidence'),
  measured('E-action-target', 'nielsen-7', 'task-efficiency', 3, 'Did successful journeys stay within their action target?', 'All within target', 'Slightly over target', 'Well over target'),
  measured('E-backtrack', 'nielsen-3', 'task-efficiency', 2, 'Did the observed path avoid loops and repeated actions?', 'None observed', 'One on a journey', 'Two or more on a journey'),
  measured('E-dead-ends', 'nielsen-9', 'task-efficiency', 3, 'Did the observed path avoid dead ends?', 'None observed', 'Dead end with a way out', 'Dead end with no way out'),
  measured('E-interstitial', 'nielsen-8', 'task-efficiency', 2, 'Did journeys avoid steps that only lead to another step?', 'None observed', 'One such step', 'Two or more such steps'),
  measured('C-result-visible', 'nielsen-1', 'clarity', 3, 'Do results appear where the visitor is looking?', 'Results appeared in the viewport', 'Some appeared off screen', 'Most appeared off screen'),
  measured('C-feedback', 'nielsen-1', 'clarity', 2, 'Does each action give visible feedback?', 'Every action gave feedback', 'One action gave none', 'Several actions gave none'),
  measured('C-recovery', 'nielsen-9', 'clarity', 3, 'Do empty and error states explain themselves and offer a way out?', 'Message and a way out', 'Partial, such as an error page with HTTP 200', 'No message or no way out'),
  measured('V-primary-position', 'visual-hierarchy', 'visual-design', 3, 'Does main content start in the first screen?', 'Starts within the first screen on all measured views', 'Late on under half', 'Late on half or more'),
  measured('V-h1', 'visual-hierarchy', 'visual-design', 2, 'Is the page title visually dominant?', 'Title is clearly larger than body text', 'Under half fall short', 'Half or more fall short'),
  measured('V-legibility', 'visual-craft', 'visual-design', 2, 'Are body size and line length readable?', 'Within limits', 'Under half of views exceed a limit', 'Half or more exceed a limit'),
  measured('V-mobile-layout', 'responsive-behaviour', 'visual-design', 3, 'Does the layout fit small screens and fingers?', 'No layout finding on phones', 'Comfort findings only', 'Overflow or undersized targets'),
  measured('V-affordance', 'visual-craft', 'visual-design', 2, 'Do buttons look operable?', 'All have a visible boundary or marker', 'Under half of views have exceptions', 'Half or more have exceptions'),
  measured('V-consistency', 'nielsen-4', 'visual-design', 1, 'Is the button styling consistent?', 'Within the style limit', 'Over on under half of views', 'Over on half or more'),
  measured('V-density', 'cognitive-load', 'visual-design', 2, 'Is the first screen free of control overload?', 'Within the limit', 'Over on under half of views', 'Over on half or more'),
  measured('V-parity', 'responsive-behaviour', 'visual-design', 2, 'Can phone visitors reach what desktop visitors can?', 'No desktop-only destinations', 'One', 'Several'),
  measured('A-axe', 'wcag-robust', 'accessibility', 3, 'Did axe-core report violations?', 'None reported on scanned pages', 'Moderate or minor only', 'Serious or critical present'),
  measured('A-focus-visible', 'wcag-operable', 'accessibility', 3, 'Is keyboard focus visible and unobscured?', 'Visible at every tab stop', 'Missing or covered at a few stops', 'Missing at many stops', ['2.4.7', '2.4.11']),
  measured('A-reachable', 'wcag-operable', 'accessibility', 4, 'Can every control be reached and used by keyboard?', 'All reached and operated', 'One control fails', 'Several controls fail', ['2.1.1']),
  measured('A-order', 'wcag-operable', 'accessibility', 3, 'Is the tab order logical and free of traps?', 'Logical, with no trap', 'Out-of-order jumps, or a long route to content', 'A keyboard trap', ['2.1.2', '2.4.1', '2.4.3']),
  measured('A-dialog', 'wcag-operable', 'accessibility', 3, 'Do dialogs manage focus?', 'Focus moves in, stays in, Escape closes, focus returns', 'One behaviour missing', 'Several behaviours missing', ['2.4.3']),
  measured('A-focus-recovery', 'wcag-operable', 'accessibility', 2, 'Is focus kept after an action updates the page?', 'Focus stayed meaningful', 'Lost once', 'Lost repeatedly', ['2.4.3']),
  measured('A-semantics', 'wcag-robust', 'accessibility', 3, 'Are structure and control state exposed to assistive technology?', 'Landmarks, headings and state are exposed', 'One gap', 'Several gaps', ['1.3.1', '4.1.2', '4.1.3']),

  // Expert: Claude judges from cited screenshots and actions. Software checks the citations.
  expert('X-language', 'nielsen-2', 'clarity', 'language', 'Do labels and copy use words this audience knows?', 'Jargon, undefined abbreviations, mixed languages, labels that assume insider knowledge.'),
  expert('X-recognition', 'nielsen-6', 'discoverability', 'language', 'Are options and current selections visible rather than remembered?', 'Hidden selections, filters whose state disappears, icons with no label.'),
  expert('X-help', 'nielsen-10', 'clarity', 'language', 'Is help available where a visitor would need it?', 'Unexplained terms, no explanation of formats or codes.'),
  expert('X-ia', 'information-architecture', 'discoverability', 'language', 'Is content grouped and named the way visitors think about it?', 'Sections that overlap, unclear navigation grouping, missing wayfinding.'),
  expert('X-minimalism', 'nielsen-8', 'visual-design', 'workload', 'Does each screen show only what supports the task?', 'Competing promotions, decorative content ahead of the task.'),
  expert('X-cognitive-load', 'cognitive-load', 'clarity', 'workload', 'Is the amount to compare and remember reasonable?', 'Many simultaneous choices, comparisons forcing memory across screens.'),
  expert('X-progressive', 'progressive-disclosure', 'clarity', 'workload', 'Is complexity revealed at the right moment?', 'Advanced options shown too early, or essentials buried behind disclosure.'),
  expert('X-efficiency', 'nielsen-7', 'task-efficiency', 'workload', 'Does the design offer direct routes for the main tasks?', 'Missing shortcuts, defaults that do not suit the main task.'),
  expert('X-status', 'nielsen-1', 'clarity', 'interaction', 'Does the interface show what is happening and what is selected?', 'Missing counts, unclear selected states, no loading indication.'),
  expert('X-control', 'nielsen-3', 'task-efficiency', 'interaction', 'Can visitors undo, go back or clear choices easily?', 'No clear-all, drawers without obvious exits, lost state on back.'),
  expert('X-prevention', 'nielsen-5', 'clarity', 'interaction', 'Does the design prevent wrong turns before they happen?', 'Filter combinations that yield nothing, no warning before leaving the site.'),
  expert('X-recovery', 'nielsen-9', 'clarity', 'interaction', 'Do messages say what went wrong and what to do?', 'Vague empty states, dead-end error pages.'),
  expert('X-interaction', 'interaction-design', 'visual-design', 'interaction', 'Do controls behave as their appearance promises?', 'Links styled as buttons, toggles that navigate, unexpected scroll jumps.'),
  expert('X-hierarchy', 'visual-hierarchy', 'visual-design', 'visual', 'Is the order of importance clear at a glance?', 'Competing focal points, weak titles, primary action not dominant.'),
  expert('X-density', 'visual-craft', 'visual-design', 'visual', 'Is the content density right for the device?', 'Cramped cards, too much per row, or too much empty scrolling.'),
  expert('X-legibility', 'visual-craft', 'visual-design', 'visual', 'Is text comfortable to read in context?', 'Text over images, thin weights, weak contrast that rules may miss.'),
  expert('X-spacing', 'visual-craft', 'visual-design', 'visual', 'Does spacing group related items?', 'Uneven gaps, related items far apart, unrelated items touching.'),
  expert('X-affordance', 'visual-craft', 'visual-design', 'visual', 'Is it obvious what can be pressed?', 'Flat controls, cards that look clickable but are not.'),
  expert('X-consistency', 'nielsen-4', 'visual-design', 'visual', 'Are components and patterns consistent between screens?', 'The same action with different styling or names.'),
  expert('X-discoverability', 'information-architecture', 'discoverability', 'responsive', 'Can visitors see what the site can do from what is on screen?', 'Capabilities hidden behind unlabelled icons or drawers.'),
  expert('X-feedback', 'nielsen-1', 'clarity', 'responsive', 'Is feedback visually noticeable at each journey stage?', 'Result changes that look identical to the previous state.'),
  expert('X-empty', 'nielsen-9', 'clarity', 'responsive', 'Are empty states designed rather than left blank?', 'Blank areas, messages with no next step.'),
  expert('X-responsive', 'responsive-behaviour', 'visual-design', 'responsive', 'Does each device get a layout suited to it?', 'Desktop layouts squeezed onto tablets, wasted space, patterns that change meaning.'),
];

export const EXPERT_BATCHES = ['language', 'workload', 'interaction', 'visual', 'responsive'];

export const DEFAULT_THRESHOLDS = {
  actionsOverTargetConcern: 1,
  actionsOverTargetFail: 3,
  excessOverShortest: 2,
  firstContentMaxViewportShare: 0.8,
  h1MinRatio: 1.25,
  bodyFontMinPx: 14,
  lineLengthMaxChars: 100,
  firstViewControlsMobile: 24,
  firstViewControlsDesktop: 45,
  distinctButtonStyles: 12,
  tabsToMainNoSkip: 12,
  keyControlMaxDepth: 1,
  keyControlMaxViewports: 2,
};

export const VERDICT_VALUE = {pass: 1, concern: 0.5, fail: 0};

/** A short fingerprint of the rubric. Scores are only compared when this is unchanged. */
export function rubricVersion(thresholds = DEFAULT_THRESHOLDS, weights = {}) {
  const shape = CRITERIA.map(c => [c.id, c.category, weights[c.id] ?? c.weight, c.method]);
  return crypto.createHash('sha1').update(JSON.stringify([shape, thresholds])).digest('hex').slice(0, 8);
}

export function criterionById(id) { return CRITERIA.find(c => c.id === id) || null; }

export const IMPACTS = ['blocks', 'major', 'minor', 'polish'];
export const CONFIDENCES = ['low', 'medium', 'high'];
const SEVERITY_TABLE = {blocks: ['P1', 'P1'], major: ['P2', 'P1'], minor: ['P3', 'P2'], polish: ['P3', 'P3']};

/**
 * Severity follows impact and whether a core task is affected. P0 needs objective proof that a
 * core task is blocked on every device checked, and low confidence lowers the rating one level.
 */
export function severityOf({impact, core = false, objective = false, confidence = 'medium', allDevices = false}) {
  let severity = (SEVERITY_TABLE[impact] || SEVERITY_TABLE.minor)[core ? 1 : 0];
  if (impact === 'blocks' && core && objective && allDevices) severity = 'P0';
  if (confidence === 'low' && severity !== 'P3') severity = `P${Number(severity[1]) + 1}`;
  return severity;
}
