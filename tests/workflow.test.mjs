// Structural checks on the workflows. These complement, and do not replace, actionlint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const audit = fs.readFileSync('.github/workflows/audit.yml', 'utf8');
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const job = name => {
  const start = audit.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} exists`);
  const rest = audit.slice(start + 3);
  const next = rest.search(/\n {2}(?:#[^\n]*\n {2})?[a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next);
};

test('no YAML tabs and every run step is indented', () => {
  for (const file of [audit, ci]) assert.equal(file.includes('\t'), false);
});

test('workflow defaults to no permissions, and only the right job can write', () => {
  assert.match(audit, /^permissions: \{\}$/m);
  assert.match(job('audit'), /permissions:\n\s+contents: read/);
  assert.doesNotMatch(job('audit'), /contents: write|id-token|pages: write/);
  assert.match(job('persist-memory'), /contents: write/);
  assert.match(job('deploy-dashboard'), /pages: write/);
  assert.match(job('deploy-dashboard'), /id-token: write/);
});

test('the browsing job holds no repository credentials', () => {
  const checkouts = job('audit').match(/persist-credentials: (\w+)/g);
  assert.deepEqual([...new Set(checkouts)], ['persist-credentials: false']);
});

test('the Claude token is present only where needed', () => {
  const lines = audit.split('\n').filter(l => l.includes('secrets.'));
  assert.equal(lines.length, 2, 'one presence check and one audit step');
  assert.equal(audit.includes('ANTHROPIC_API_KEY'), false);
  const before = audit.slice(0, audit.indexOf('Run the read-only browser audit'));
  assert.ok(before.indexOf('npm ci') < before.indexOf('secrets.'), 'packages install before any secret is read');
});

test('every action is pinned to a commit', () => {
  for (const file of [audit, ci]) {
    for (const line of file.split('\n').filter(l => /uses:/.test(l))) assert.match(line, /@[0-9a-f]{40} # v/, line);
  }
});

test('dependencies are locked and scripts disabled', () => {
  for (const file of [audit, ci]) assert.match(file, /npm ci --ignore-scripts/);
  assert.ok(fs.existsSync('package-lock.json'));
  assert.equal(fs.readFileSync('package-lock.json', 'utf8').includes('artifactory'), false, 'lockfile must work for anyone');
});

test('untrusted inputs never reach a shell through expressions', () => {
  for (const line of audit.split('\n')) {
    if (/\$\{\{/.test(line) && /^\s*(run:|node |echo |npm )/.test(line)) assert.fail(`expression in shell: ${line}`);
  }
});

test('only standard free runners are used', () => {
  for (const file of [audit, ci]) for (const line of file.split('\n').filter(l => /runs-on:/.test(l))) assert.match(line, /ubuntu-latest$/);
});

test('reports and memory are kept even when the run fails', () => {
  const steps = job('audit');
  assert.ok(steps.indexOf('Upload full evidence') < steps.indexOf('Fail the run'));
  assert.ok(steps.indexOf('Package the dashboard') < steps.indexOf('Fail the run'));
  assert.match(job('persist-memory'), /!cancelled\(\)/);
  assert.match(job('deploy-dashboard'), /!cancelled\(\)/);
});

test('the memory sanitizer cleans files and refuses unexpected names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-sanitize-'));
  const incoming = path.join(root, 'in');
  fs.mkdirSync(incoming);
  fs.writeFileSync(path.join(incoming, 'site.json'), JSON.stringify({schemaVersion: 2, runs: 'x', findings: {a: {title: 'y'.repeat(999)}}}));
  fs.writeFileSync(path.join(incoming, '..evil.json'), '{}');
  const out = path.join(root, 'out');
  const result = spawnSync(process.execPath, ['scripts/sanitize-memory.mjs', incoming, out], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(out), ['site.json']);
  const clean = JSON.parse(fs.readFileSync(path.join(out, 'site.json'), 'utf8'));
  assert.equal(clean.findings.a.title.length, 160);
  assert.equal(clean.runs, 0);
});
