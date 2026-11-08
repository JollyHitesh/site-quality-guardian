#!/usr/bin/env node
// Runs in the job that can write to the repository, so the file contents are never trusted.
import fs from 'node:fs';
import path from 'node:path';
import {sanitizeMemory, saveMemoryFile} from '../src/memory.mjs';

const [incoming, outgoing] = process.argv.slice(2);
if (!incoming || !outgoing) { console.error('Usage: sanitize-memory.mjs <incoming-dir> <outgoing-dir>'); process.exit(64); }
let count = 0;
for (const name of fs.readdirSync(incoming)) {
  if (!/^[a-z0-9-]+\.json$/.test(name)) { console.warn(`Skipping unexpected file: ${name}`); continue; }
  const raw = JSON.parse(fs.readFileSync(path.join(incoming, name), 'utf8'));
  saveMemoryFile(sanitizeMemory(raw, name.replace(/\.json$/, '')), path.join(outgoing, name));
  count++;
}
console.log(`Sanitized ${count} memory file(s)`);
