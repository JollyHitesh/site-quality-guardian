// Two small sites. One has planted UX anti-patterns. The other is the control: it does the same
// jobs well, so a check that fires on it is a false positive.
import http from 'node:http';

const copy = 'A short description of this programme, long enough to count as real page content for anyone reading it carefully on any device. ';
const films = ['Alpha Film', 'Bravo Film', 'Charlie Film', 'Delta Film', 'Echo Film', 'Foxtrot Film'];

function badScript() {
  const all = ['Alpha Film', 'Bravo Film', 'Charlie Film', 'Delta Film', 'Echo Film', 'Foxtrot Film'];
  const list = document.getElementById('list');
  const note = document.getElementById('note');
  const draw = items => { list.innerHTML = items.map(f => `<li class="card">${f} is playing this week at several cinemas</li>`).join(''); };
  let drama = false;
  window.drama = el => { drama = !drama; el.classList.toggle('on'); draw(drama ? [] : all); note.textContent = ''; };
  window.pick = (el, text) => { el.classList.toggle('on'); draw(all.slice(0, 3)); note.textContent = text; };
  window.relabel = el => { const box = el.parentElement; box.innerHTML = '<button onclick="relabel(this)">Refresh</button>'; note.textContent = 'List refreshed at the top of the page'; };
  window.openPanel = () => { document.getElementById('panel').style.display = 'block'; };
  window.search = e => { if (e.key === 'Enter') { draw([]); note.textContent = ''; } };
  document.getElementById('softtoggle').addEventListener('click', () => { document.getElementById('note').textContent = 'Toggled the view of the list'; });
  draw(all);
}

function trapScript() {
  const first = document.getElementById('t1');
  const last = document.getElementById('t2');
  last.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); first.focus(); } });
}

const badStyle = `<style>
  a:focus,button:focus,input:focus,[tabindex]:focus{outline:none}
  body{margin:0;font:13px sans-serif}
  h1{font-size:14px;margin:0}
  .hero{height:1500px;background:#def}
  .on{background:#fc0}
  .flat{background:transparent;border:0;padding:4px}
  .menu .sub{display:none}
  .menu:hover .sub{display:block}
  .wide{width:900px;background:#eee}
  #panel{display:none;position:fixed;inset:10% 10%;background:#fff;border:1px solid #333;padding:20px}
  .deals{display:none}
  @media (min-width:800px){.deals{display:inline}}
  .tiny{width:12px;height:12px;padding:0}
</style>`;

const shell = (body, head = '', lang = 'en') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>${head}</head><body>${body}</body></html>`;

function badPages() {
  const nav = `<nav><a href="/section-a">More</a> <a href="/section-b">More</a> <a href="/section-a">Stuff</a> <a class="deals" href="/deals">Deals</a></nav>`;
  const onward = (next, label = 'Continue') => shell(`${badStyle}<a href="${next}" style="display:block;padding:12px">${label}</a><p>Please continue.</p>`);
  return {
    '/': shell(`${badStyle}${nav}
      <div class="menu">Browse<div class="sub"><a href="/section-b">Hidden section</a></div></div>
      <h1>Films</h1><h3>This week</h3>
      <a href="/step-1" tabindex="3" style="display:block;padding:12px">Start browsing</a>
      <button class="flat" style="height:48px" onclick="pick(this,'Showing only comedies')">Comedy</button>
      <button style="height:48px" onclick="pick(this,'Showing only westerns')">Western</button>
      <button style="height:48px" onclick="drama(this)">Drama</button>
      <div><button style="height:48px" onclick="relabel(this)">Refresh</button></div>
      <button style="height:48px" onclick="openPanel()">Open details</button>
      <button style="height:48px" onclick="this.nextElementSibling.hidden=false">Options</button>
      <div hidden><button style="height:48px" onclick="this.nextElementSibling.hidden=false">Advanced</button><div hidden><button style="height:48px" onclick="document.getElementById('note').textContent='Filters applied here'">Filters</button></div></div>
      <div style="cursor:pointer;padding:12px" onclick="document.getElementById('note').textContent='Sorted by date'">Sort films</div>
      <div role="button" tabindex="0" id="softtoggle" style="padding:12px;cursor:pointer">Toggle list</div>
      <input type="search" placeholder="Search films" onkeydown="search(event)" style="font-size:13px">
      <div class="hero"></div>
      <div id="note"></div><ul id="list"></ul><p>${copy.repeat(5)}</p>
      <div class="wide">Too wide for a phone</div>
      <button class="tiny" aria-label="a"></button><button class="tiny" aria-label="b"></button>
      <img src="/poster.png"><button style="height:48px"></button>
      <div id="panel"><p>Details about this programme and what it contains for visitors reading it.</p><a href="/section-a">One</a> <a href="/section-b">Two</a></div>
      <script>(${badScript})()</script>`),
    '/step-1': onward('/step-2'),
    '/step-2': onward('/results'),
    '/results': shell(`${badStyle}<h1>Results</h1><ul>${films.map(f => `<li class="card">${f} is playing this week at several cinemas</li>`).join('')}</ul><p>${copy.repeat(3)}</p>`),
    '/section-a': shell(`${badStyle}<h1>Section A</h1><p>${copy.repeat(3)}</p><button id="t1" style="height:48px">One</button><button id="t2" style="height:48px">Two</button><a href="/">Back home</a><script>(${trapScript})()</script>`),
    '/section-b': shell(`${badStyle}<h1>Section B</h1><p>${copy.repeat(3)}</p><div style="height:2500px"></div><a href="/">Back home</a><div style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#333"></div>`),
    '/deals': shell(`${badStyle}<h1>Deals</h1><p>${copy.repeat(3)}</p>`),
  };
}

function goodScript() {
  const all = ['Alpha Film', 'Bravo Film', 'Charlie Film', 'Delta Film', 'Echo Film', 'Foxtrot Film'];
  const list = document.getElementById('list');
  const status = document.getElementById('status');
  const draw = (items, text) => { list.innerHTML = items.map(f => `<li class="card">${f} is playing this week at several cinemas</li>`).join(''); status.textContent = text; };
  window.toggle = (el, text) => { const on = el.getAttribute('aria-pressed') !== 'true'; el.setAttribute('aria-pressed', String(on)); draw(on ? all.slice(0, 3) : all, on ? text : 'Showing all films'); };
  window.openDialog = () => document.getElementById('details').showModal();
  document.getElementById('find').addEventListener('submit', e => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim().toLowerCase();
    const found = all.filter(f => f.toLowerCase().includes(q));
    draw(found, found.length ? `${found.length} films found` : `No results for ${q}`);
    document.getElementById('clear').hidden = found.length > 0;
  });
  window.clearSearch = () => { document.getElementById('q').value = ''; document.getElementById('clear').hidden = true; draw(all, 'Showing all films'); };
  draw(all, 'Showing all films');
}

const goodStyle = `<style>
  body{margin:0;font:16px/1.5 sans-serif}
  h1{font-size:32px;margin:8px 0}
  main{padding:12px;max-width:70ch}
  a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #06c;outline-offset:2px}
  .skip{position:absolute;left:-999px}.skip:focus{left:8px}
  header nav a{display:inline-block;padding:12px}
  button{height:48px;background:#eee;border:1px solid #666;border-radius:6px;font:inherit;padding:0 12px}
  button[aria-pressed=true]{background:#fc0}
  input{height:48px;font-size:16px}
  dialog p{max-width:40ch}
</style>`;

function goodPages() {
  const head = '<a class="skip" href="#main">Skip to main content</a><header><nav aria-label="Main"><a href="/programme">Programme</a> <a href="/cinemas">Cinemas</a></nav></header>';
  const page = (title, body = '') => shell(`${goodStyle}${head}<main id="main"><h1>${title}</h1><p>${copy.repeat(3)}</p>${body}<p><a href="/">Back to all films</a></p></main>`);
  return {
    '/': shell(`${goodStyle}${head}<main id="main"><h1>Films this week</h1>
      <form id="find" role="search"><label>Search films <input id="q" type="search" name="q"></label> <button>Go</button> <button type="button" id="clear" hidden onclick="clearSearch()">Clear search</button></form>
      <button aria-pressed="false" onclick="toggle(this,'Showing only comedies')">Comedy</button>
      <button aria-pressed="false" onclick="toggle(this,'Showing only westerns')">Western</button>
      <button aria-haspopup="dialog" onclick="openDialog()">Open details</button>
      <p role="status" id="status"></p><ul id="list"></ul><p>${copy.repeat(2)}</p>
      <h2>About</h2><p>${copy.repeat(2)}</p>
      <dialog id="details" aria-label="Programme details"><p>Details about this programme and what it contains for visitors.</p><form method="dialog"><button>Close</button></form></dialog></main>
      <script>(${goodScript})()</script>`),
    '/programme': page('Programme'),
    '/cinemas': page('Cinemas'),
  };
}

const notFound = {
  bad: {status: 200, html: shell('<div>Oops</div>')},
  good: {status: 404, html: shell(`${goodStyle}<main><h1>Page not found</h1><p>This page does not exist. <a href="/">See all films</a>.</p></main>`)},
};

export function startUxFixture(kind) {
  const table = kind === 'bad' ? badPages() : goodPages();
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const key = req.url.split('?')[0];
    if (key === '/robots.txt') { res.writeHead(200, {'content-type': 'text/plain'}); res.end('User-agent: *\nAllow: /\n'); return; }
    if (req.method === 'GET' && table[key]) { res.writeHead(200, {'content-type': 'text/html'}); res.end(table[key]); return; }
    if (req.method === 'GET' && /\.(png|ico)$/.test(key)) { res.writeHead(404); res.end(); return; }
    res.writeHead(notFound[kind].status, {'content-type': 'text/html'});
    res.end(notFound[kind].html);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, hits, port: server.address().port})));
}

export const JOURNEYS = {
  bad: [
    {id: 'reach-results', title: 'See the list of results', persona: 'Visitor on a phone', targetActions: 1, estimatedTurns: 3, successCheck: {kind: 'page-path-contains', value: '/results', alsoRequire: 'none'}},
    {id: 'filter-comedy', title: 'Show only comedies', persona: 'Visitor on a phone', targetActions: 1, estimatedTurns: 2, successCheck: {kind: 'page-text-contains', value: 'Showing only comedies', alsoRequire: 'none'}},
    {id: 'find-western', title: 'Find a western', persona: 'Visitor on a phone', targetActions: 1, estimatedTurns: 3, successCheck: {kind: 'page-text-contains', value: 'Showing only westerns', alsoRequire: 'none'}},
  ],
  good: [
    {id: 'filter-comedy', title: 'Show only comedies', persona: 'Visitor on a phone', targetActions: 1, estimatedTurns: 2, successCheck: {kind: 'page-text-contains', value: 'Showing only comedies', alsoRequire: 'none'}},
  ],
};

export function uxConfig(kind, port) {
  return {
    name: 'UX fixture', url: `http://127.0.0.1:${port}/`, allowedHosts: ['127.0.0.1'], timezone: 'Europe/Berlin', rateLimitMs: 20, maxPages: 6, maxActions: 40, maxRunMinutes: 9,
    purpose: 'Help visitors find films.', audiences: ['Visitor on a phone'],
    ai: {models: ['fake']},
    ux: {devices: ['mobile', 'tablet', 'desktop'], journeys: JOURNEYS[kind], keyControls: 'search|filter', exploreActions: 16, maxPages: 5, keyboardPages: 4, maxRunMinutes: 9},
  };
}
