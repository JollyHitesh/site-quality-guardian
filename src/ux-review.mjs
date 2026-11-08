// The expert layer. Claude reviews each group of criteria separately, and software decides what
// survives: every claim must cite evidence Claude was actually shown.
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {cleanAiText, untrusted} from './claude.mjs';
import {CRITERIA, DIMENSIONS, IMPACTS, CONFIDENCES, severityOf, criterionById} from './ux-framework.mjs';

const text = {type: 'string'};
const list = {type: 'array', items: text};

function issueSchema(ids) {
  const fields = {
    criterion: {type: 'string', enum: ids}, title: text, priorId: text, classification: {type: 'string', enum: ['expert-judgment', 'research-needed']}, userGoal: text, persona: text,
    problem: text, observedEvidence: text, quote: text, evidenceRefs: list, reproductionSteps: list, impact: {type: 'string', enum: IMPACTS}, confidence: {type: 'string', enum: CONFIDENCES},
    template: text, device: text, rootCauseHypothesis: text, recommendation: text, alternative: text, expectedBenefit: text, implementationGuidance: text, acceptanceCriteria: list, validationMethod: text,
  };
  return {type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields};
}

export function reviewSchema(ids) {
  return {
    type: 'object', additionalProperties: false, required: ['assessments', 'issues'],
    properties: {
      assessments: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['criterion', 'verdict', 'rationale', 'evidenceRefs'], properties: {criterion: {type: 'string', enum: ids}, verdict: {type: 'string', enum: ['pass', 'concern', 'fail', 'insufficient-evidence']}, rationale: text, evidenceRefs: list}}},
      issues: {type: 'array', maxItems: 6, items: issueSchema(ids)},
    },
  };
}

const VERIFY_SCHEMA = {type: 'object', additionalProperties: false, required: ['results'], properties: {results: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'verdict', 'reason', 'duplicateOf'], properties: {id: text, verdict: {type: 'string', enum: ['supported', 'weak', 'contradicted']}, reason: text, duplicateOf: text}}}}};

// A review may suggest what visitors might experience. It may not assert it as fact or put a number on it.
const INVENTED = [
  /\b(users?|visitors?|people|customers?)\s+(are|feel|get|become|will (?:be|feel|get|become))\s+(frustrated|confused|annoyed|overwhelmed|lost|angry|satisfied|delighted|stressed)\b/i,
  /\b\d+(?:\.\d+)?\s*%\s+of\s+(users?|visitors?|people|customers?)\b/i,
  /\b(satisfaction|frustration|sus|nps|csat)\s+(score|rating|of)\b/i,
  /\b(takes?|took|requires?|needs?)\s+(users?|visitors?|people)\s+(about\s+|around\s+|roughly\s+)?\d+\s*(s\b|sec|min)/i,
];

export function assertsInventedFact(values) {
  const joined = values.filter(Boolean).join(' ');
  return INVENTED.some(pattern => pattern.test(joined));
}

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Applies the evidence rules to one batch of output. Rejections are counted and published. */
export function validateReview(output, {criteria, shownShots, actionIds, pageText = '', measuredIds = new Set()}) {
  const allowed = new Set(criteria.map(c => c.id));
  const citable = refs => (Array.isArray(refs) ? refs : []).filter(r => shownShots.has(r) || actionIds.has(r) || measuredIds.has(r));
  const direct = refs => refs.filter(r => shownShots.has(r) || actionIds.has(r));
  const assessments = [];
  const seen = new Set();
  for (const a of Array.isArray(output?.assessments) ? output.assessments : []) {
    if (!allowed.has(a.criterion) || seen.has(a.criterion)) continue;
    seen.add(a.criterion);
    const refs = citable(a.evidenceRefs);
    const usable = a.verdict !== 'insufficient-evidence' && direct(refs).length > 0;
    assessments.push({criterion: a.criterion, provenance: 'expert', verdict: usable ? a.verdict : 'not-assessed', detail: usable ? cleanAiText(a.rationale, 400) : a.verdict === 'insufficient-evidence' ? `The reviewer reported insufficient evidence: ${cleanAiText(a.rationale, 200)}` : 'The reviewer gave a verdict without citing evidence it was shown, so it was discarded.', evidenceRefs: refs.slice(0, 6)});
  }
  const issues = [], rejected = [];
  const reject = (raw, reason) => rejected.push({title: cleanAiText(raw?.title, 120), criterion: cleanAiText(raw?.criterion, 20), reason});
  for (const raw of Array.isArray(output?.issues) ? output.issues : []) {
    if (!allowed.has(raw.criterion)) { reject(raw, 'unknown-criterion'); continue; }
    const refs = citable(raw.evidenceRefs);
    if (!direct(refs).length) { reject(raw, 'no-screenshot-or-action-evidence'); continue; }
    if (!IMPACTS.includes(raw.impact) || !raw.problem || !raw.recommendation || !raw.validationMethod) { reject(raw, 'incomplete-record'); continue; }
    if (assertsInventedFact([raw.problem, raw.observedEvidence, raw.expectedBenefit, raw.rootCauseHypothesis])) { reject(raw, 'asserted-unmeasured-human-state'); continue; }
    if (raw.quote && norm(raw.quote).length >= 3 && !norm(pageText).includes(norm(raw.quote))) { reject(raw, 'quote-not-on-any-page'); continue; }
    issues.push({...raw, evidenceRefs: refs.slice(0, 6)});
  }
  return {assessments, issues, rejected};
}

const CONFIDENCE_ORDER = {low: 0, medium: 1, high: 2};

/** Confidence comes from corroboration. A model saying "high" is not enough on its own. */
export function resolveConfidence(claimed, {refs, measuredCorroboration, supported, validated}) {
  if (validated) return 'high';
  const direct = refs.filter(r => /^[SA]\d/.test(r)).length;
  const ceiling = supported && (measuredCorroboration || direct >= 2) ? 'high' : supported ? 'medium' : 'low';
  return CONFIDENCE_ORDER[claimed] <= CONFIDENCE_ORDER[ceiling] ? claimed : ceiling;
}

const fingerprintOf = value => crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);

/** Gives accepted output the same structure as measured issues, and clearly labels it. */
export function finishExpertIssue(raw, {shotsById, coreTemplates, devices, audience, measuredCriteria = new Set(), verification = null}) {
  const criterion = criterionById(raw.criterion);
  const shots = raw.evidenceRefs.map(r => shotsById.get(r)).filter(Boolean);
  const templates = [...new Set([cleanAiText(raw.template, 80), ...shots.map(s => s.template)].filter(Boolean))].slice(0, 4);
  const issueDevices = [...new Set(shots.map(s => s.device))];
  const supported = verification?.verdict === 'supported';
  const confidence = resolveConfidence(raw.confidence, {refs: raw.evidenceRefs, measuredCorroboration: measuredCriteria.has(raw.criterion), supported});
  const classification = verification?.verdict === 'weak' ? 'research-needed' : raw.classification;
  const core = templates.some(t => coreTemplates.includes(t));
  const title = cleanAiText(raw.title, 150);
  return {
    id: `ux-expert-${fingerprintOf(`${raw.criterion}|${templates[0] || ''}|${norm(title)}`)}`, kind: 'expert', class: classification, provenance: 'expert',
    criterion: raw.criterion, dimension: criterion.dimension, principle: DIMENSIONS[criterion.dimension], wcag: [], priorId: cleanAiText(raw.priorId, 40),
    userGoal: cleanAiText(raw.userGoal, 160), persona: cleanAiText(raw.persona, 120) || audience, title, problem: cleanAiText(raw.problem, 500), observedEvidence: cleanAiText(raw.observedEvidence, 500), quote: cleanAiText(raw.quote, 160),
    evidenceRefs: raw.evidenceRefs, reproductionSteps: (raw.reproductionSteps || []).slice(0, 8).map(s => cleanAiText(s, 180)),
    severity: severityOf({impact: raw.impact, core, objective: false, confidence}), impact: raw.impact, confidence, scope: templates.length > 1 ? 'multiple-page-types' : core ? 'core-page-type' : 'single-page-type', templates, devices: issueDevices.length ? issueDevices : devices.slice(0, 1),
    rootCause: {text: cleanAiText(raw.rootCauseHypothesis, 300), status: 'hypothesis'}, recommendation: cleanAiText(raw.recommendation, 500), alternative: cleanAiText(raw.alternative, 300), expectedBenefit: cleanAiText(raw.expectedBenefit, 300), implementationGuidance: cleanAiText(raw.implementationGuidance, 500),
    acceptanceCriteria: (raw.acceptanceCriteria || []).slice(0, 5).map(s => cleanAiText(s, 200)), validationMethod: cleanAiText(raw.validationMethod, 300), verification: verification ? {verdict: verification.verdict, reason: cleanAiText(verification.reason, 240)} : null,
  };
}

const BATCH_IMAGES = {
  language: s => (s.stage === 'landing' ? 0 : s.journey ? 1 : 2),
  workload: s => (s.stage === 'landing' ? 0 : s.stage === 'page' ? 1 : 2),
  interaction: s => (['empty-state', 'error-page', 'server-error'].includes(s.stage) ? 0 : s.journey ? 1 : 2),
  visual: s => (s.stage === 'page' || s.stage === 'landing' ? 0 : s.journey ? 1 : 2),
  responsive: s => (s.stage === 'landing' || s.stage === 'page' ? 0 : ['empty-state', 'error-page'].includes(s.stage) ? 1 : 2),
};

/** Picks a varied set: the most relevant kind of screen first, spread across devices. */
export function selectImages(batch, shots, limit) {
  const rank = BATCH_IMAGES[batch];
  const remaining = [...shots].filter(s => s.jpg).sort((a, b) => rank(a) - rank(b));
  const chosen = [];
  const count = {};
  while (chosen.length < limit && remaining.length) {
    remaining.sort((a, b) => rank(a) - rank(b) || (count[a.device] || 0) - (count[b.device] || 0));
    const next = remaining.shift();
    chosen.push(next);
    count[next.device] = (count[next.device] || 0) + 1;
  }
  return chosen;
}

const RULES = `Rules for this review:
- Judge only what the attached screenshots and the evidence block show. Do not guess about screens you cannot see.
- Give one assessment per listed criterion. Use "insufficient-evidence" when the evidence cannot answer it. That is a correct, useful answer.
- Every assessment and issue must cite evidenceRefs copied exactly from the screenshot and action ids provided.
- Do not state how visitors feel or what they think, and do not give satisfaction scores, percentages of users, or human task times. Describe what is on screen. You may write that something "may" cause difficulty, because this is a hypothesis.
- Do not repeat "alreadyMeasured" problems.
- "priorHypotheses" are only there so you can reuse an id if you independently see the same problem now. They are not evidence. Set priorId to that id, or an empty string. Do not raise something because it is on that list.
- Set "classification" to "expert-judgment" when the evidence shows the problem, or "research-needed" when it is only an idea that needs testing with people.
- "impact": blocks = the task cannot be completed; major = substantial added difficulty on the task; minor = noticeable friction; polish = refinement. Rate actual impact. Do not soften it and do not inflate it.
- Quote exact on-page text in "quote" when the problem is about wording, otherwise use an empty string.
- A screenshot with stage "server-error" shows an intermittent failure that may not recur. Judge only how the error is presented, and say that it was intermittent.
- Recommendations must be specific enough to build. Acceptance criteria must be testable. Name how to validate the change.`;

export async function reviewBatch(ai, {batch, config, evidence, shots, outDir}) {
  const criteria = CRITERIA.filter(c => c.method === 'expert' && c.batch === batch);
  const images = shots.map(s => path.join(outDir, s.jpg)).filter(f => fs.existsSync(f));
  const definition = criteria.map(c => ({id: c.id, principle: DIMENSIONS[c.dimension], question: c.question, lookFor: c.lookFor}));
  const site = {name: config.name, purpose: config.purpose, priorities: config.priorities, audiences: config.audiences};
  const prompt = `You are a senior UX researcher and product designer conducting an expert evaluation of ${config.url}. Assess only these criteria, each on its own merits:\n${JSON.stringify(definition)}\n\nSite context (trusted configuration): ${JSON.stringify(site)}\n\n${RULES}\n\nThe ${images.length} attached screenshots are, in order: ${shots.slice(0, images.length).map(s => `${s.id} (${s.device}, ${s.template}, ${s.stage}${s.journey ? `, journey: ${s.journey}` : ''})`).join('; ')}.\n\nEvidence collected by the audit:\n${untrusted(evidence, 15000)}`;
  const output = await ai.ask(prompt, reviewSchema(criteria.map(c => c.id)), {images, timeoutMs: Math.max(config.ai.timeoutMs, 240000)});
  return {output, criteria};
}

/** A second, sceptical reading of the expert issues. It can only remove or downgrade them. */
export async function verifyIssues(ai, {issues, shots, config, outDir}) {
  const images = shots.map(s => path.join(outDir, s.jpg)).filter(f => fs.existsSync(f));
  const claims = issues.map((x, i) => ({id: String(i), title: x.title, problem: x.problem, observedEvidence: x.observedEvidence, cites: x.evidenceRefs}));
  const prompt = `You are checking another reviewer's UX claims about ${config.url}. Be sceptical. For each claim, look only at the cited screenshots and decide: "supported" if the screenshot clearly shows it, "weak" if it is plausible but not visible or depends on assumptions about people, "contradicted" if the screenshot shows otherwise. If a claim describes the same underlying problem as an earlier claim in the list, set duplicateOf to that earlier id, otherwise use an empty string.\n\nThe ${images.length} attached screenshots are, in order: ${shots.slice(0, images.length).map(s => s.id).join(', ')}.\n\nClaims:\n${untrusted(claims, 9000)}`;
  const output = await ai.ask(prompt, VERIFY_SCHEMA, {images, timeoutMs: Math.max(config.ai.timeoutMs, 240000)});
  return new Map((output.results || []).map(r => [r.id, r]));
}
