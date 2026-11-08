import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedUrl,safeAction,policyAllows,isExcludedPath} from '../src/security.mjs';
import {nextPriority,saveMemory,loadMemory} from '../src/memory.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cfg={url:'https://www.ov-berlin.de/',allowedHosts:['www.ov-berlin.de','ov-berlin.de'],detailPathPrefixes:['/movies/'],views:['List','Cards','Map','Week'],filters:['Tonight','English audio']};
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
 saveMemory(m,{finishedAt:'2026-11-08T00:00:00Z',actions:[{device:'desktop',type:'click',target:'Map',outcome:'PASS'},{device:'mobile',type:'click',target:'Map',outcome:'SKIPPED/ERROR: x'}],visitedPaths:['/movies/x'],findings:[]},file);
 const reread=loadMemory(file);
 assert.equal(reread.runs,1);assert.equal(reread.visitedPaths['/movies/x'],1);assert.equal(reread.actionCounts['desktop:click:Map'],1);
 assert.equal(reread.actionCounts['mobile:click:Map'],undefined,'failed actions must not count as coverage');
});
test('denies German and reservation labels without blocking ordinary ones',()=>{
 const c={...cfg,filters:['Tickets kaufen','Jetzt reservieren','Anmelden','Tomorrow','Display options'],safeButtons:[]};
 for(const target of ['Tickets kaufen','Jetzt reservieren','Anmelden'])assert.equal(policyAllows({type:'click',target},c),false,target);
 for(const target of ['Tomorrow','Display options'])assert.equal(policyAllows({type:'click',target},c),true,target);
});
test('localhost may use http, excluded paths are not opened',()=>{
 const local={url:'http://127.0.0.1:3000/',allowedHosts:['127.0.0.1'],detailPathPrefixes:['/go','/movies/'],excludePaths:['/go']};
 assert.equal(isAllowedUrl('http://127.0.0.1:3000/a',local),true);
 assert.equal(isExcludedPath('/go/123',local),true);
 assert.equal(isExcludedPath('/gone',local),false);
 assert.equal(safeAction({type:'open_detail',target:'Out'},{buttons:[],internalLinks:[{text:'Out',href:'http://127.0.0.1:3000/go/1'}]},local),false);
});
