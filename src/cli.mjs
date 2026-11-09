#!/usr/bin/env node
// Entry point. Exits non-zero only for an agent failure: site problems are for the workflow to judge.
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig, configFromUrl, listSites} from './config.mjs';
import {Audit} from './audit.mjs';
import {writeDashboardIndex} from './report.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] || fallback; };

const mode = flag('--mode', 'smoke');
if (!['smoke', 'intelligent', 'ux'].includes(mode)) { console.error('Mode must be smoke, intelligent or ux'); process.exit(64); }

const out = flag('--out', 'out');
const site = flag('--site', null);
const url = flag('--url', null);
const configFile = flag('--config', null);

let configs;
try {
  if (url) configs = [configFromUrl(url)];
  else if (configFile) configs = [loadConfig(configFile)];
  else if (site && site !== 'all') {
    if (!/^[a-z0-9-]+$/.test(site)) throw new Error('Site must be a site file name without .json');
    configs = [loadConfig(path.join('sites', `${site}.json`))];
  }
  else configs = listSites('sites').map(loadConfig);
} catch (e) {
  console.error(`Invalid configuration: ${e.message}`);
  process.exit(64);
}

const budgetText = flag('--claude-budget', process.env.GUARDIAN_CLAUDE_BUDGET || null);
if (budgetText !== null && (!/^\d{1,2}$/.test(budgetText) || Number(budgetText) > 30)) { console.error('Claude budget must be a whole number from 0 to 30'); process.exit(64); }
const claudeBudget = budgetText === null ? null : Number(budgetText);

const reports = [];
let agentFailed = false;
for (const config of configs) {
  const siteOut = path.join(out, config.slug);
  const memoryFile = flag('--memory', path.join('memory', `${config.slug}.json`));
  const report = await new Audit({config, mode, out: siteOut, memoryFile, trace: argv.includes('--trace'), claudeBudget}).run();
  reports.push({slug: config.slug, name: config.name, url: config.url, out: siteOut, report});
  if (report.status === 'FAILED' || report.status === 'NO_ACTIONS') agentFailed = true;
}

writeDashboardIndex(reports, out);
const summary = {mode, finishedAt: new Date().toISOString(), blockers: reports.reduce((n, r) => n + r.report.blockers, 0), blockedBySite: reports.filter(r => r.report.status === 'BLOCKED_BY_SITE_PROTECTION').length, budgetLimited: reports.filter(r => r.report.budget && !r.report.budget.complete).length, sites: reports.map(r => ({slug: r.slug, status: r.report.status, blockers: r.report.blockers, findings: r.report.findings.length, budget: r.report.budget || null}))};
fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
process.exit(agentFailed ? 1 : 0);
