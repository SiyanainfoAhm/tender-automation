import test from 'node:test';import assert from 'node:assert/strict';import {finalEvidenceLedger} from './final-ledger.mjs';
test('final validation receives late clauses and originals after the sixth source',()=>{
 const docs=Array.from({length:9},(_,i)=>({document_id:'d'+i,file_name:'rfp'+i+'.pdf',extracted_text:'x'.repeat(30000)+'Mandatory waiver '+i}));
 const stage={coverage:{complete:true,gaps:[]},evidence_sources:docs.map((d,i)=>({ref:'D'+i,document_id:d.document_id})),assessment:{requirements:docs.map((d,i)=>({ref:'D'+i,quote:'Mandatory waiver '+i}))}};
 const ledger=finalEvidenceLedger(docs,stage);assert.equal(ledger.originals.length,9);assert.equal(ledger.originals[8].text,'Mandatory waiver 8');assert.equal(ledger.coverage.complete,true);
});
test('a stale saved clause is an explicit coverage gap',()=>{
 const result=finalEvidenceLedger([{document_id:'d',file_name:'rfp.pdf',extracted_text:'New source text'}],{coverage:{complete:true,gaps:[]},evidence_sources:[{ref:'D1',document_id:'d'}],assessment:{requirements:[{ref:'D1',quote:'Old mandatory source clause'}]}});
 assert.equal(result.coverage.complete,false);assert.equal(result.coverage.gaps[0].reason,'SOURCE_CLAUSE_CHANGED');
});
