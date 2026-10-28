import test from 'node:test';
import assert from 'node:assert/strict';
import {processPageBatch} from './checkpoint.mjs';
test('saved 40-page checkpoint resumes in bounded batches without rereading completed pages',async()=>{
 let saved={pages:Object.fromEntries(Array.from({length:40},(_,i)=>[i+1,{text:'saved '+i}])),cursor:41};const read=[];
 const state=structuredClone(saved);
 await processPageBatch(state,166,{native:4},async n=>{read.push(n);return {text:'page '+n}},async()=>{saved=structuredClone(state)});
 assert.deepEqual(read,[41,42,43,44]);assert.equal(saved.cursor,45);assert.equal(saved.pages[1].text,'saved 0');assert.equal(state.done,false);
});
test('a failure preserves prior pages and resumes at the failed page',async()=>{
 let saved={pages:{},cursor:1};const state=structuredClone(saved);
 await assert.rejects(processPageBatch(state,6,{native:4},async n=>{if(n===3)throw Error('CPU failure');return {text:'page '+n}},async()=>{saved=structuredClone(state)}),/CPU failure/);
 assert.equal(saved.cursor,3);const reads=[];
 await processPageBatch(saved,6,{native:4},async n=>{reads.push(n);return {text:'page '+n}},async()=>{});
 assert.deepEqual(reads,[3,4,5,6]);assert.equal(saved.done,true);assert.equal(Object.keys(saved.pages).length,6);
});
