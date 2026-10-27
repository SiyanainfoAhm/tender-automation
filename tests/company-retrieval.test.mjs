import test from 'node:test';
import assert from 'node:assert/strict';
import {companyQuery,retrieveCompany,retrieve} from '../supabase/functions/agenttender-orch-v2-global-chat/analyst.ts';
import {safeAnswer} from '../supabase/functions/agenttender-orch-v2-global-chat/plan.mjs';
import {requestedFinancialYears,financialDocumentAnswer} from '../supabase/functions/agenttender-orch-v2-chat/company-periods.mjs';
import {presentAnswer} from '../supabase/functions/agenttender-orch-v2-chat/presentation.mjs';

test('three completed Indian fiscal years follow the current date, including April rollover',()=>{
 assert.deepEqual(requestedFinancialYears('Find last three years audited balance sheets',new Date('2026-10-28T00:00:00Z')),['2023-24','2024-25','2025-26']);
 assert.deepEqual(requestedFinancialYears('Find last three years audited balance sheets',new Date('2026-02-01T00:00:00Z')),['2022-23','2023-24','2024-25']);
});
test('older available accounts never silently replace an unresolved required year',()=>{
 const answer=financialDocumentAnswer('Find last three years audited balance sheets',[{source_id:'d',document_name:'Audited accounts.pdf',metadata:{financial_year:'2022-23'}}],new Date('2026-10-28T00:00:00Z'));
 assert.match(answer,/Unresolved years: 2023-24, 2024-25, 2025-26/);
});
test('presentation preserves exact company source names and authorized references',()=>{
 const source={ref:'C1',document:'Audited accounts.pdf',source_type:'COMPANY_DOCUMENT',source_id:'d',document_url:'/api/documents/d'};
 const result=presentAnswer({answer:'Audited accounts.pdf [C1]',result:'UNVERIFIED',evidence_state:'MEDIUM'},[source],{});
 assert.match(result.answer,/Audited accounts.pdf/);assert.equal(result.response_trace.sources_used[0].document_url,'/api/documents/d');
});

test('financial search expands to actual accounts rather than a catalogue query',()=>{
 const query=companyQuery('Find audited balance sheets for the last three years');
 assert.match(query,/balance sheet/);assert.match(query,/audit report/);
});
test('global document cards accept only retrieved IDs and construct protected routes',()=>{
 const answer=safeAnswer({summary:'Found accounts',details:'Financial periods need checking',document_ids:['good','other-company','good'],tender_ids:[],followups:[]},[],[{source_id:'good',document_name:'Audited accounts.pdf',metadata:{financial_year:'2024-25',verification_status:'pending'},document_url:'https://untrusted.example'}]);
 assert.equal(answer.documents.length,1);assert.equal(answer.documents[0].href,'/api/documents/good');assert.equal(answer.documents[0].verification_status,'pending');
});
test('hybrid search fails closed if source-document verification fails',async()=>{
 const db={rpc:async()=>({data:[{chunk_id:'c',document_id:'d'}]}),from:()=>({select(){return this},eq(){return this},in:async()=>({error:{message:'unavailable'}})})};
 await assert.rejects(()=>retrieveCompany(db,'company','GST',Array(384).fill(0)),/source verification unavailable/);
});
test('no matching document returns no fabricated source',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:[]}}};
 const result=await retrieveCompany(db,'company','Quantum Zeta certificate',Array(384).fill(0));
 assert.deepEqual(result.company,[]);assert.equal(calls[0].name,'agenttender_match_company_evidence');assert.equal(calls[0].args.p_company_id,'company');
});
test('source records are verified in the requested company and get protected links',async()=>{
 const filters=[];
 const db={rpc:async()=>({data:[{chunk_id:'c',document_id:'d',content:'Actual registration'}]}),from(table){if(table==='agenttender_companies')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{name:'Company A'}})};if(table==='agenttender_company_document_texts')return {select(){return this},eq(){return this},in:async()=>({data:[{document_id:'d',extraction_status:'PARTIAL'}]})};assert.equal(table,'agenttender_company_documents');return {select(){return this},eq(k,v){filters.push([k,v]);return this},in:async()=>({data:[{id:'d',name:'GST.pdf',verification_status:'pending'}]})}}};
 const result=await retrieveCompany(db,'company-A','GST',Array(384).fill(0));
 assert.ok(filters.some(([k,v])=>k==='company_id'&&v==='company-A'));
 assert.equal(result.company[0].document_url,'/api/documents/d');assert.equal(result.company[0].metadata.verification_status,'pending');assert.equal(result.company[0].metadata.extraction_status,'PARTIAL');assert.equal(result.company[0].metadata.company_name,'Company A');
});
test('a caller without document permission never queries company evidence',async()=>{
 const calls=[];const db={rpc:async(name)=>{calls.push(name);return {data:[]}}};
 const result=await retrieve(db,'tender','company','Find GST certificate','ANALYSIS','',false);
 assert.deepEqual(result.company,[]);assert.ok(!calls.includes('agenttender_match_company_evidence'));
});
