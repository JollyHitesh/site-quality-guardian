#!/usr/bin/env node
// A smoke run replaces the whole dashboard, so this fetches the last UX report to put back.
// Failure is harmless: the dashboard simply has no UX link until the next UX audit.
import fs from 'node:fs';
import path from 'node:path';

const [base, sitesDir, target] = process.argv.slice(2);
if (!base || !sitesDir || !target) { console.error('Usage: carry-ux-report.mjs <pages-base-url> <sites-dir> <target-dir>'); process.exit(64); }
const origin = new URL(base);
if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1') { console.error('The dashboard address must use https'); process.exit(64); }
const SAFE_FILE = /^(index\.html|shots\/[A-Za-z0-9_.-]+\.jpg)$/;
const MAX_FILES = 80;
const get = url => fetch(url, {redirect: 'error', signal: AbortSignal.timeout(20000)});

for (const name of fs.readdirSync(sitesDir).filter(f => f.endsWith('.json'))) {
  const slug = name.replace(/\.json$/, '');
  const root = `${base.replace(/\/$/, '')}/${slug}/ux`;
  try {
    const listing = await get(`${root}/files.json`);
    if (!listing.ok) { console.log(`${slug}: no earlier UX report`); continue; }
    const files = (await listing.json()).filter(f => typeof f === 'string' && SAFE_FILE.test(f)).slice(0, MAX_FILES);
    const fetched = await Promise.all(files.map(async file => {
      const response = await get(`${root}/${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return [file, Buffer.from(await response.arrayBuffer())];
    }));
    for (const [file, body] of fetched) {
      const destination = path.join(target, slug, file);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, body);
    }
    fs.writeFileSync(path.join(target, slug, 'files.json'), JSON.stringify(files));
    console.log(`${slug}: kept ${files.length} files`);
  } catch (e) {
    console.log(`${slug}: could not keep the earlier UX report (${e.name})`);
  }
}
