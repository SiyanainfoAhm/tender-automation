import test from 'node:test';import assert from 'node:assert/strict';
import {commitBatches,compactChunks} from './batches.mjs';
test('large indexes resume at persisted batch progress after interruption',async()=>{
 let saved={status:'INDEXING',content_hash:'hash',chunk_count:0},fail=true;const starts=[];
 const db={from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:saved,error:null}}}),rpc:async(_name,body)=>{starts.push(body.p_chunks[0].chunk_index);if(body.p_chunks[0].chunk_index===100&&fail){fail=false;return {error:Error('interrupted')}}saved={...saved,chunk_count:body.p_chunks.at(-1).chunk_index+1};return {data:{cursor:saved.chunk_count,complete:saved.chunk_count===1205},error:null}}};
 const payload={p_hash:'hash',p_source:'s',p_total:1205,p_chunks:Array.from({length:1205},(_,i)=>({chunk_index:i}))};
 await assert.rejects(commitBatches(db,payload),/interrupted/);assert.equal(saved.chunk_count,100);
 const resumed=await commitBatches(db,payload);assert.equal(resumed.cursor,300);assert.deepEqual(starts,[0,100,100,200]);
});
test('index compaction removes only non-substantive footer chunks and repeated page-quality arrays',()=>{
 const result=compactChunks([{content:'-- 2 of 166 --',metadata:{}},{content:'Bidder must provide a valid signed declaration before submission.',metadata:{extraction_quality:{pages:Array(166).fill({}),total_pages:166},page_references:[10]}}]);
 assert.equal(result.length,1);assert.equal(result[0].metadata.extraction_quality.total_pages,166);assert.equal(result[0].metadata.extraction_quality.pages,undefined);assert.deepEqual(result[0].metadata.page_references,[10]);
});
