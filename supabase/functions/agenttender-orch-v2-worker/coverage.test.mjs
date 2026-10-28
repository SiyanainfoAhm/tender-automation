import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageUnits,extractionGaps,reviewCoverage,sourceOutline,presentAnnexures} from './coverage.mjs';
import {validateAssessment} from './step3-evidence.mjs';
const rules=[{code:'FIT_WEB_PORTAL',decision:'REVIEW'},{code:'HARDWARE',decision:'NO_GO'}];
test('text-identical attachments share review spans while retaining all source references',()=>{
 const units=coverageUnits([{ref:'D1',document_kind:'ORIGINAL',text:'same content'},{ref:'D2',document_kind:'ORIGINAL',text:'same content'},{ref:'D3',document_kind:'ORIGINAL',text:'different content'}]);
 assert.equal(units.length,2);assert.deepEqual(units[0].equivalent_refs,['D1','D2']);
});
test('annexures late in a long RFP are exposed as present sections with page references',()=>{
 const outline=sourceOutline([{ref:'D1',document_name:'17-page-rfp.pdf',text:'x'.repeat(28000)+'\n--- PAGE 13 ---\nANNEXURE – I\nTECHNICAL SPECIFICATIONS\nCore website modernization\n--- PAGE 14 ---\nANNEXURE – II\nTECHNICAL BID\nCompliance form'}]);
 assert.ok(outline[0].sections.some(s=>s.heading==='ANNEXURE – I'&&s.page_number===13));assert.ok(outline[0].sections.some(s=>s.heading==='ANNEXURE – II'&&s.page_number===14));
 assert.equal(presentAnnexures('Annexures I & II technical specifications',outline),true);assert.equal(presentAnnexures('Annexure IV',outline),false);
});
const quote='Bidder shall provide a valid registration certificate.';
const mkDoc=(i,text=quote)=>({document_id:'id'+i,file_name:'rfp'+i+'.pdf',document_kind:'ORIGINAL',extracted_text:text,extraction_metadata:{}});
const mockDB=(cp,valid=true)=>({from:()=>({update(value){this.value=value;return this},eq(){return this},async select(){if(valid)Object.assign(cp,this.value.checkpoint);return {data:valid?[{tender_id:'t'}]:[],error:null}}})});
const args=(docs,cp={},valid=true)=>({db:mockDB(cp,valid),tender:{id:'t',title:'Develop a portal'},docs,work:{documents:docs.map(d=>({document_id:d.document_id,file_name:d.file_name,storage_status:'COMPLETED'}))},rules,verifiedCorrections:[],checkpoint:cp,leaseToken:'lease',fingerprint:'revision-1',version:'test',aiKey:'key',allowAI:true,validateAssessment});
const withAI=async(fn,reply)=>{const prev=globalThis.fetch;globalThis.fetch=async(_url,init)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply?reply(JSON.parse(init.body)):{disposition:'NEED_MORE',evidence:[],requirements:[],unresolved_questions:[]})}}]});try{return await fn()}finally{globalThis.fetch=prev}};
test('every character and documents after the fifth are scheduled, with overlap at clause boundaries',()=>{
 const sources=Array.from({length:9},(_,i)=>({ref:'D'+i,text:'x'.repeat(54000)+'LAST WAIVER '+i}));
 const units=coverageUnits(sources);assert.equal(units.length,36);
 for(const s of sources){let cursor=0;for(const u of units.filter(u=>u.ref===s.ref)){assert.equal(u.start,cursor);cursor=u.end;}assert.equal(cursor,s.text.length);assert.ok(units.some(u=>u.text.endsWith('LAST WAIVER '+s.ref.slice(1))))}
});
test('checkpoints resume after two spans and retain clauses beyond the old 26000 limit',async()=>withAI(async()=>{
 const docs=[mkDoc(1,'x'.repeat(54000)+quote),...Array.from({length:6},(_,i)=>mkDoc(i+2,quote+String(i)))],cp={};let result;
 for(let i=0;i<12;i++){result=await reviewCoverage(args(docs,cp));if(!result.pending)break;}
 assert.equal(result.coverage.complete,true);assert.equal(result.result.coverage.reviewed,result.result.coverage.total);assert.ok(result.coverage.findings.some(x=>x.ref==='D7'));assert.ok(result.coverage.findings.some(x=>x.start===54000&&x.requirements.some(r=>r.quote===quote)));
},body=>{const u=JSON.parse(body.messages[1].content).span;return {disposition:'NEED_MORE',requirements:u?.text.includes(quote)?[{ref:u.ref,text:'registration',quote}]:[],unresolved_questions:[]}}));
test('changed associations/content/completeness fingerprint discards the old cursor',async()=>withAI(async()=>{
 const cp={step3_coverage:{fingerprint:'old',cursor:99,findings:[]}};const result=await reviewCoverage(args([mkDoc(1)],cp));assert.equal(result.coverage.fingerprint,'revision-1');assert.equal(result.coverage.cursor,2);
}));
test('partial OCR and missing uploaded originals are explicit coverage gaps',()=>{
 const docs=[mkDoc(1)];docs[0].extraction_metadata={total_pages:17,processed_pages:16,completeness:'partial',ocr_required_pages:[17]};
 const gaps=extractionGaps(docs,{documents:[{document_id:'id1',file_name:'rfp.pdf'},{document_id:'missing',file_name:'amendment.pdf',storage_status:'UPLOADING'}]});assert.equal(gaps.length,2);assert.equal(gaps[1].reason,'UPLOAD_INCOMPLETE');
});
test('stale lease never accepts coverage checkpoint',async()=>withAI(async()=>{await assert.rejects(reviewCoverage(args([mkDoc(1)],{},false)),/STALE_LEASE/)}));
test('provider-truncated output is never accepted as reviewed coverage',async()=>{
 const prev=globalThis.fetch;globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]});const cp={};try{await assert.rejects(reviewCoverage(args([mkDoc(1)],cp)),/OUTPUT_INCOMPLETE/);assert.equal(cp.step3_coverage,undefined)}finally{globalThis.fetch=prev}
});
test('completed text coverage with missing amendment cannot authorize exclusion or PQ readiness',async()=>withAI(async()=>{
 const docs=[mkDoc(1,quote)],cp={};const a=args(docs,cp);a.work.documents.push({document_id:'other',file_name:'amendment.pdf',storage_status:'COMPLETED'});let r=await reviewCoverage(a);assert.equal(r.pending,true);r=await reviewCoverage({...a,checkpoint:cp});assert.equal(r.result.assessment.disposition,'NEED_MORE');
},()=>({disposition:'CLEAR_EXCLUSION',primary_scope_clear:true,exceptions_checked:true,evidence:[{ref:'D1',quote,rule_code:'HARDWARE',exceptions_checked:true}],unresolved_questions:[]})));
