import fs from 'node:fs';

export function loadMemory(file = 'memory/state.json') {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      schemaVersion: 1, runs: Number(parsed.runs) || 0, lastRun: parsed.lastRun || null,
      actionCounts: parsed.actionCounts || {}, visitedPaths: parsed.visitedPaths || {},
      observations: parsed.observations || {}, candidateRegressions: parsed.candidateRegressions || [],
      lastFindings: parsed.lastFindings || []
    };
  } catch { return {schemaVersion:1,runs:0,lastRun:null,actionCounts:{},visitedPaths:{},observations:{},candidateRegressions:[],lastFindings:[]}; }
}

export function nextPriority(memory, candidates) {
  return [...new Set(candidates)].sort((a,b) => (memory.actionCounts[a] || 0) - (memory.actionCounts[b] || 0));
}

export function saveMemory(memory, results, file = 'memory/state.json') {
  memory.runs = (memory.runs || 0) + 1;
  memory.lastRun = results.finishedAt;
  for (const action of results.actions || []) {
    const key = `${action.device}:${action.type}:${action.target}`.slice(0,150);
    memory.actionCounts[key] = (memory.actionCounts[key] || 0) + 1;
  }
  for (const p of results.visitedPaths || []) memory.visitedPaths[p] = (memory.visitedPaths[p] || 0) + 1;
  const old = memory.observations || {};
  for (const f of results.findings || []) {
    const key = f.fingerprint;
    if (!key) continue;
    const prior = old[key] || {firstSeen: results.finishedAt, occurrences:0};
    old[key] = {firstSeen:prior.firstSeen, lastSeen:results.finishedAt, occurrences:prior.occurrences+1, title:f.title, status:f.status};
  }
  memory.observations = Object.fromEntries(Object.entries(old).slice(-350));
  memory.lastFindings = (results.findings || []).slice(0,100).map(f => ({fingerprint:f.fingerprint,title:f.title,status:f.status,severity:f.severity}));
  memory.candidateRegressions = (memory.candidateRegressions || []).slice(-50);
  fs.mkdirSync(file.split('/').slice(0,-1).join('/') || '.', {recursive:true});
  fs.writeFileSync(file, JSON.stringify(memory, null, 2)+'\n');
}
