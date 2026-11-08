#!/usr/bin/env node
// Last gate before anything is published. Prints only the file and rule, never the matched text.
import fs from 'node:fs';
import path from 'node:path';
import {SECRET_RULES} from '../src/redact.mjs';

const BINARY = /\.(png|jpe?g|gif|webp)$/i;
const targets = process.argv.slice(2);
if (!targets.length) { console.error('Usage: scan-public-output.mjs <dir-or-file>...'); process.exit(64); }

const exactValues = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN'].map(name => [name, process.env[name]]).filter(([, v]) => v && v.length >= 8);
const problems = [];

function scanFile(file) {
  const name = path.basename(file);
  if (/^trace-.*\.zip$/.test(name)) { problems.push([file, 'browser-trace-file']); return; }
  if (BINARY.test(name)) return;
  const buffer = fs.readFileSync(file);
  const text = buffer.toString('utf8');
  for (const [rule, pattern] of SECRET_RULES) if (pattern.test(text)) problems.push([file, rule]);
  for (const [envName, value] of exactValues) if (text.includes(value)) problems.push([file, `exact-value:${envName}`]);
}

function walk(target) {
  if (!fs.existsSync(target)) return;
  if (fs.statSync(target).isFile()) { scanFile(target); return; }
  for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
}

targets.forEach(walk);
for (const [file, rule] of problems) console.error(`BLOCKED ${file}: ${rule}`);
console.log(problems.length ? `Publication blocked: ${problems.length} problem(s)` : 'Public output scan passed');
process.exit(problems.length ? 1 : 0);
