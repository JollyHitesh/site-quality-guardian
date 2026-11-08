// Runs the real audit against a small local site with known defects.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

let chromiumReady = false;
try {
  const {chromium} = await import('playwright');
  chromiumReady = fs.existsSync(chromium.executablePath());
  await import('@axe-core/playwright');
} catch { chromiumReady = false; }

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const shell = body => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title></head><body>${body}<p>${'Plenty of readable text so this page is not considered blank. '.repeat(20)}</p></body></html>`;
const pages = {
  '/': shell(`<h1>Home</h1>
    <button id="works" style="height:48px" onclick="document.getElementById('out').textContent='Filtered results'">Works</button>
    <button style="height:48px">Dead</button>
    <button style="height:48px" onclick="document.getElementById('drawer').hidden=false">Filters</button>
    <div id="drawer" hidden><button style="height:48px" onclick="document.getElementById('out').textContent='From drawer'">Hidden Option</button></div>
    <div id="out">Initial results</div>
    <div style="width:700px;background:#eee">Too wide</div>
    <input placeholder="Search movies" style="font-size:13px">
    <button style="width:12px;height:12px;padding:0" aria-label="tiny-a"></button><button style="width:12px;height:12px;padding:0" aria-label="tiny-b"></button>
    <a href="/movies/one">Movie one</a> <a href="/about">About</a> <a href="/missing">Missing page</a> <a href="/go/out">Outbound</a>
    <a href="#" style="display:block;height:30px">Book now</a>
    <img src="/nope.png" alt="broken">
    <script>fetch('/api/broken')</script>`),
  '/movies/one': shell('<h1>Movie</h1>'),
  '/about': shell('<h2>About</h2>'),
};

function startServer() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const body = pages[req.url.split('?')[0]];
    if (!body) { res.writeHead(404, {'content-type': 'text/html'}); res.end('nope'); return; }
    res.writeHead(200, {'content-type': 'text/html'});
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, hits, port: server.address().port})));
}

test('audit finds seeded defects and keeps to its safety limits', {skip: !chromiumReady && 'Playwright browser or axe not installed', timeout: 180000}, async () => {
  const {server, hits, port} = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-int-'));
  const configFile = path.join(dir, 'site.json');
  fs.writeFileSync(configFile, JSON.stringify({
    name: 'Fixture', url: `http://127.0.0.1:${port}/`, allowedHosts: ['127.0.0.1'], devices: ['mobile'],
    filters: ['Works', 'Dead', 'Hidden Option', 'Not There'], revealButtons: ['Filters'], searchQueries: [],
    detailPathPrefixes: ['/movies/'], excludePaths: ['/go'], rateLimitMs: 50, maxRunMinutes: 2,
  }));
  const child = spawn(process.execPath, ['src/runner.mjs', '--mode', 'smoke', '--config', configFile, '--out', path.join(dir, 'out'), '--memory', path.join(dir, 'state.json')], {cwd: root, stdio: 'ignore'});
  await new Promise(resolve => child.on('close', resolve));
  server.close();
  server.closeAllConnections();

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  const has = kind => report.findings.some(f => f.kind === kind);
  for (const kind of ['layout-overflow', 'input-zoom-ios', 'tap-target-too-small', 'primary-tap-target-small', 'broken-image', 'invalid-booking-url', 'broken-internal-link', 'resource-http-error', 'control-no-effect']) {
    assert.ok(has(kind), `expected finding ${kind}; got ${report.findings.map(f => f.kind).join(', ')}`);
  }
  const noEffect = report.findings.filter(f => f.kind === 'control-no-effect').map(f => f.title);
  assert.deepEqual(noEffect, ['"Dead" changed nothing on the page'], 'working controls must not be flagged');
  const action = target => report.actions.find(a => a.target === target);
  assert.equal(action('Hidden Option').via, 'Filters', 'control inside a drawer is reached through its reveal button');
  assert.deepEqual(report.coverage.missingControls.mobile, ['Not There']);
  assert.ok(report.errors.some(e => e.includes('Not There')), 'missing controls are surfaced');
  assert.ok(report.visitedPaths.includes('/movies/one') && report.visitedPaths.includes('/about'), 'each page type is sampled');
  assert.equal(hits.some(u => u.startsWith('/go')), false, 'excluded outbound paths are never requested');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'site', 'index.html')));
  assert.ok(report.findings.find(f => f.kind === 'input-zoom-ios').instances[0].evidence.screenshot, 'layout findings carry an annotated screenshot');
});

test('syntax check stays cheap', () => {
  for (const file of fs.readdirSync(path.join(root, 'src'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'src', file)]);
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});
