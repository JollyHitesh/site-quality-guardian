import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedUrl,safeAction} from '../src/security.mjs';
import {nextPriority,saveMemory,loadMemory} from '../src/memory.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cfg={url:'https://www.ov-berlin.de/',allowedHosts:['www.ov-berlin.de','ov-berlin.de'],views:['List','Cards','Map','Week'],filters:['Tonight','English audio']};
const inv={buttons:['Tonight','Buy tickets','English audio','Subscribe','Map'],internalLinks:[{text:'Film X',href:'https://www.ov-berlin.de/movies/film-x'},{text:'External',href:'https://example.com'}]};
test('strict same-website navigation',()=>{
 assert.equal(isAllowedUrl('https://www.ov-berlin.de/movies/film',cfg),true);
 assert.equal(isAllowedUrl('https://www.ov-berlin.de.evil.com',cfg),false);
 assert.equal(isAllowedUrl('http://www.ov-berlin.de',cfg),false);
 assert.equal(isAllowedUrl('javascript:alert(1)',cfg),false);
});
test('rejects purchases, subscriptions and external links',()=>{
 assert.equal(safeAction({type:'click',target:'Buy tickets'},inv,cfg),false);
 assert.equal(safeAction({type:'click',target:'Subscribe'},inv,cfg),false);
 assert.equal(safeAction({type:'click',target:'Like'}, {buttons:['Like'],internalLinks:[]},cfg),false);
 assert.equal(safeAction({type:'open_detail',target:'External'},inv,cfg),false);
 assert.equal(safeAction({type:'view',target:'Map'},inv,cfg),true);
 assert.equal(safeAction({type:'search',target:'English tonight'},inv,cfg),true);
 assert.equal(safeAction({type:'shell',target:'cat ~/.ssh/id_rsa'},inv,cfg),false);
});
test('least-tested actions prioritized',()=>{
 assert.deepEqual(nextPriority({actionCounts:{'a':4,'b':0}},['a','b','c']),['b','c','a']);
});
test('memory persists across runs',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'guardian-test-')),'memory.json');
 const m=loadMemory(file);
 saveMemory(m,{finishedAt:'2026-11-08T00:00:00Z',actions:[{device:'desktop',type:'click',target:'Map'}],visitedPaths:['/movies/x'],findings:[]},file);
 const reread=loadMemory(file);
 assert.equal(reread.runs,1);assert.equal(reread.visitedPaths['/movies/x'],1);assert.equal(reread.actionCounts['desktop:click:Map'],1);
});
