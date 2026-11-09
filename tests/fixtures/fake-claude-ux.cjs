#!/usr/bin/env node
// Stands in for the Claude CLI: fixed plans for fixture journeys, and review output that
// deliberately includes claims the evidence rules must reject.
const fs = require('fs');

let input = '';
process.stdin.on('data', d => { input += d; }).on('end', () => {
  const args = process.argv.slice(2);
  const schema = args[args.indexOf('--json-schema') + 1];
  const content = JSON.parse(input).message.content;
  const message = content[0].text;
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({images: content.length - 1, schema: schema.slice(0, 60), fenced: message.includes('untrusted_page_data'), elsewhere: /"elsewhere":\[\{/.test(message)})}\n`);
  const ref = name => { const m = new RegExp(`"ref":"([ck]\\d+)",[^{}]*"name":"${name}"`).exec(message); return m ? m[1] : null; };
  const step = (...names) => {
    for (const name of names) if (ref(name)) return {status: 'continue', reasoning: 'next', evidenceQuote: '', actions: [{ref: ref(name), why: 'next step'}]};
    return {status: 'blocked', reasoning: 'no path', problem: 'No control leads onward', evidenceQuote: 'Films', actions: []};
  };
  let output;
  if (schema.includes('evidenceQuote')) {
    if (message.includes('See the list of results')) output = step('Start browsing', 'Continue');
    else if (message.includes('Show only comedies')) output = step('Comedy');
    else if (message.includes('Find a western')) {
      const dramaTurns = (message.match(/"name":"Drama"/g) || []).length;
      const tried = (message.match(/open the next/g) || []).length;
      void dramaTurns;
      output = tried === 0 ? {status: 'continue', reasoning: 'try', evidenceQuote: '', actions: [{ref: ref('Drama'), why: 'open the next'}]} : tried === 1 ? {status: 'continue', reasoning: 'undo', evidenceQuote: '', actions: [{ref: ref('Drama'), why: 'open the next one again'}]} : step('Western');
    } else output = step('Comedy');
  } else if (schema.includes('assessments')) {
    const ids = [...new Set((/"enum":\[("X-[^\]]*)\]/.exec(schema) || [, ''])[1].match(/X-[a-z-]+/g) || [])];
    const shot = (/in order: (S\d+)/.exec(message) || [])[1] || 'S01';
    const base = {priorId: '', userGoal: 'Find a film', persona: 'Visitor on a phone', observedEvidence: 'The screenshot shows this.', quote: '', reproductionSteps: ['Open the page'], confidence: 'high', template: '/', device: 'mobile', rootCauseHypothesis: 'Layout priority', alternative: 'Another way', expectedBenefit: 'Less scrolling', implementationGuidance: 'Change the template', acceptanceCriteria: ['It is visible'], validationMethod: 'First-click test'};
    const issue = extra => ({...base, criterion: ids[0], classification: 'expert-judgment', impact: 'major', title: 'Default title', problem: 'A problem is visible', evidenceRefs: [shot], recommendation: 'Change it', ...extra});
    const batch = ids[0];
    const issues = [issue({title: `Supported claim for ${batch}`, problem: `The screen may make ${batch} harder.`})];
    if (batch === 'X-language') issues.push(issue({title: 'Cites a screenshot it never saw', evidenceRefs: ['S999']}), issue({title: 'Claims a feeling', problem: 'Users feel frustrated by this page.'}), issue({title: 'Misquotes the page', quote: 'words that are nowhere on the site'}), issue({title: 'Idea to test', classification: 'research-needed', impact: 'minor'}));
    if (batch === 'X-hierarchy') issues.push(issue({title: 'Reviewer contradicted please', problem: 'The title is missing.'}));
    if (batch === 'X-minimalism') issues.push(issue({title: 'Duplicate of an earlier claim', problem: 'The same thing said again.'}));
    if (batch === 'X-status') issues.push(issue({title: 'Blocking concern', impact: 'blocks'}));
    output = {assessments: ids.map(id => ({criterion: id, verdict: id === 'X-empty' ? 'insufficient-evidence' : 'concern', rationale: 'Seen on screen', evidenceRefs: id === 'X-spacing' ? ['S999'] : [shot]})), issues};
  } else if (schema.includes('contradicted')) {
    const fence = /<untrusted_page_data[^>]*>\n([\s\S]*?)\n<\/untrusted_page_data/.exec(message);
    const claims = JSON.parse(fence[1]);
    output = {results: claims.map(c => ({id: c.id, verdict: /contradicted please/.test(c.title) ? 'contradicted' : /Idea/.test(c.title) ? 'weak' : 'supported', reason: 'Checked', duplicateOf: /Duplicate of/.test(c.title) ? '0' : ''}))};
  } else {
    output = {goals: []};
  }
  console.log(JSON.stringify({type: 'result', structured_output: output}));
});
