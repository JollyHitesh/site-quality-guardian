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
    for (const line of file.split('\n').filter(l => /uses:/.test(l))) assert.match(line, /@[0-9a-f]{40} # v|docker:\/\/[^@]+@sha256:[0-9a-f]{64} # /, line);
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

test('Claude never runs on a schedule', () => {
  const crons = audit.match(/- cron:/g);
  assert.equal(crons.length, 1, 'one scheduled audit only');
  const mode = audit.match(/MODE: (.*)/)[1];
  assert.match(mode, /event_name == 'workflow_dispatch' && inputs\.mode \|\| 'smoke'/);
  assert.equal(/schedule.*intelligent/.test(mode), false);
  assert.match(audit, /- intelligent/, 'manual runs can still choose it');
});

test('the scheduled deterministic audit has its own switch', () => {
  assert.match(audit, /if: \$\{\{ github\.event_name != 'schedule' \|\| vars\.GUARDIAN_SCHEDULED_SMOKE == 'true' \}\}/);
  assert.equal(audit.includes('vars.GUARDIAN_SCHEDULED_INTELLIGENT'), false);
  assert.ok(audit.indexOf('workflow_dispatch') < audit.indexOf('GUARDIAN_SCHEDULED_SMOKE'));
});

test('published output is scanned, and traces cannot be uploaded', () => {
  const steps = job('audit');
  assert.match(steps, /node scripts\/scan-public-output\.mjs out memory/);
  assert.ok(steps.indexOf('scan-public-output') < steps.indexOf('Upload full evidence'));
  assert.match(steps, /rm -rf out memory/);
  assert.match(steps, /!out\/\*\*\/trace-\*\.zip/);
  assert.equal(steps.includes('--trace'), false, 'CI never records traces');
});

test('a run blocked by the site goes red after publishing the truth', () => {
  const steps = job('audit');
  assert.match(steps, /jq '\.blockedBySite' out\/summary\.json/);
  assert.ok(steps.indexOf('Upload full evidence') < steps.indexOf('blockedBySite'));
});

test('CI lints the workflows with actionlint', () => {
  assert.match(ci, /actionlint:\n/);
  assert.match(ci, /rhysd\/actionlint@sha256:/);
});

test('the output scanner reports problems without printing secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-scan-'));
  const fakeKey = ['sk', 'ant', 'abcdefghijklmnop1234'].join('-');
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({leak: fakeKey}));
  const leak = spawnSync(process.execPath, ['scripts/scan-public-output.mjs', root], {encoding: 'utf8'});
  assert.equal(leak.status, 1);
  assert.match(leak.stderr, /anthropic-key/);
  assert.equal(`${leak.stdout}${leak.stderr}`.includes(fakeKey), false);

  fs.writeFileSync(path.join(root, 'report.json'), '{"ok":true}');
  assert.equal(spawnSync(process.execPath, ['scripts/scan-public-output.mjs', root], {encoding: 'utf8'}).status, 0);

  fs.writeFileSync(path.join(root, 'note.txt'), 'value is exact-token-value-123');
  const exact = spawnSync(process.execPath, ['scripts/scan-public-output.mjs', root], {encoding: 'utf8', env: {...process.env, CLAUDE_CODE_OAUTH_TOKEN: 'exact-token-value-123'}});
  assert.equal(exact.status, 1);
  assert.match(exact.stderr, /exact-value:CLAUDE_CODE_OAUTH_TOKEN/);
  assert.equal(`${exact.stdout}${exact.stderr}`.includes('exact-token-value-123'), false);

  fs.rmSync(path.join(root, 'note.txt'));
  fs.writeFileSync(path.join(root, 'trace-mobile.zip'), 'x');
  assert.equal(spawnSync(process.execPath, ['scripts/scan-public-output.mjs', root], {encoding: 'utf8'}).status, 1, 'traces cannot be published');
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

test('CI really runs the UX browser tests and the security checks', () => {
  assert.match(ci, /playwright install --with-deps chromium webkit/);
  assert.match(ci, /npm audit --audit-level=high/);
  assert.match(ci, /github\/codeql-action\/analyze@/);
  assert.match(ci, /^permissions:\n {2}contents: read$/m);
});

test('the Claude budget reaches the audit through the environment and is reported', () => {
  assert.match(audit, /GUARDIAN_CLAUDE_BUDGET: \$\{\{ inputs\.claude_budget \|\| vars\.GUARDIAN_CLAUDE_BUDGET \|\| '12' \}\}/);
  assert.match(job('audit'), /Report the Claude call budget/);
  assert.match(job('audit'), /budgetLimited/);
  assert.equal(/\$\{\{[^}]*claude_budget[^}]*\}\}.*node /.test(audit), false);
});

test('UX audits are manual, get the token, and keep smoke free of Claude', () => {
  assert.match(audit, /- ux\n/);
  assert.match(audit, /\(env\.MODE == 'intelligent' \|\| env\.MODE == 'ux'\) && secrets\.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.equal(audit.match(/- cron:/g).length, 1);
  assert.match(audit.match(/MODE: (.*)/)[1], /inputs\.mode \|\| 'smoke'/);
});

test('the latest UX report survives later runs and cannot fetch unexpected files', async () => {
  const http = await import('node:http');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-carry-'));
  const sites = path.join(root, 'sites');
  fs.mkdirSync(sites);
  fs.writeFileSync(path.join(sites, 'demo.json'), '{}');
  fs.writeFileSync(path.join(sites, 'absent.json'), '{}');
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push(req.url);
    if (req.url === '/demo/ux/files.json') return res.end(JSON.stringify(['index.html', 'shots/a.jpg', '../../evil.sh', 'shots/../x.jpg', 7]));
    if (req.url === '/demo/ux/index.html') return res.end('<h1>report</h1>');
    if (req.url === '/demo/ux/shots/a.jpg') return res.end('jpg');
    res.statusCode = 404;
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const out = path.join(root, 'prev');
  const {execFile} = await import('node:child_process');
  await new Promise((resolve, reject) => execFile(process.execPath, ['scripts/carry-ux-report.mjs', `http://127.0.0.1:${server.address().port}`, sites, out], e => (e ? reject(e) : resolve())));
  server.close();
  server.closeAllConnections();
  assert.equal(fs.readFileSync(path.join(out, 'demo', 'index.html'), 'utf8'), '<h1>report</h1>');
  assert.ok(fs.existsSync(path.join(out, 'demo', 'shots', 'a.jpg')));
  assert.equal(asked.some(u => /evil|\.\./.test(u)), false);
  assert.equal(fs.existsSync(path.join(out, 'absent')), false);
});
