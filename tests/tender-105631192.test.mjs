import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionDocumentId,extractionUsable,selectCompanyExcerpts,uncoveredSubmissionRequirements} from '../supabase/functions/agenttender-orch-v2-chat/qualification-evidence.mjs';
import {normalizeQualification,renderQualification} from '../supabase/functions/agenttender-orch-v2-chat/qualification.mjs';
import {resolveSpec,turnover,certificationAssessment} from '../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs';
import {durableChat} from '../supabase/functions/agenttender-orch-v2-chat/memory.mjs';
import {retrieve} from '../supabase/functions/agenttender-orch-v2-chat/analyst.ts';
const docs=[{id:'pdf-id',file_name:'website-revamp-tender-document.pdf'},{id:'sheet-id',file_name:'report-20261027-083434.xlsx'}];
test('a subcontracting prohibition proves the rule, not an unsupported company execution plan',()=>{
 const quote='The successful bidder shall execute the contract; subcontracting is prohibited.';
 const r=normalizeQualification({requirements:[{category:'Consortium / subcontracting',mandatory:true,result:'PASS',basis:'RFP_ONLY',rfp_evidence:[{ref:'R1',quote}],explanation:'No subcontracting is proposed.'}]},{rfp:[{ref:'R1',text:quote}],company:[],coverage:{complete:true,warnings:[]},tender:{id:'t'},rules:[]});
 assert.equal(r.requirements[0].result,'UNKNOWN');assert.doesNotMatch(r.requirements[0].explanation,/No subcontracting is proposed/);
});
test('mandatory tax and digital-signature instructions cannot disappear outside the eligibility table',()=>{
 const sources=[{ref:'R4',text:'Income Tax paid receipts for the last Three (3) years of the firm.'},{ref:'R5',text:'The Bidder shall authenticate the bid with his digital certificate.'}];
 const rows=uncoveredSubmissionRequirements(sources,[]);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.result==='UNKNOWN'));
 assert.equal(uncoveredSubmissionRequirements(sources,rows).length,0);
 const r=normalizeQualification({requirements:[],requirements_complete:true},{rfp:sources,company:[],coverage:{complete:true,warnings:[]},tender:{id:'t'},rules:[]});
 assert.equal(r.requirements.length,2);assert.equal(r.recommendation,'NOT_VERIFIED');
});
test('percentage EMD cannot pass from an unknown quote price or an unpaid slip',()=>{
 const quote='EMD @ 1% of quoted price online transfer slip.';
 const r=normalizeQualification({requirements:[{category:'EMD',mandatory:true,result:'PASS',basis:'RFP_ONLY',rfp_evidence:[{ref:'R1',quote}]}]}, {rfp:[{ref:'R1',text:quote}],company:[],coverage:{complete:true,warnings:[]},tender:{id:'t'},rules:[]});
 assert.equal(r.requirements[0].result,'UNKNOWN');assert.equal(r.recommendation,'NOT_VERIFIED');
});
test('original incorporation certificate needs legal entity, statutory wording and CIN',()=>{
 const document={name:'Incorporation.pdf',extraction_status:'READY',verification_status:'verified',extracted_text:'--- PAGE 1 ---\nCertificate of Incorporation\nI hereby certify that Siyana Info Solutions Private Limited is incorporated under the Companies Act, 2013. CIN U72200GJ2015PTC083412'};
 assert.equal(certificationAssessment('Firm registration certificate from Registrar of companies / Societies/ MSME',[document],'Siyana Info Solutions Private Limited','2026-11-05').result,'PASS');
 assert.equal(certificationAssessment('Firm registration certificate from Registrar of companies / Societies/ MSME',[{...document,extracted_text:'Company profile: Siyana Info Solutions Private Limited'}],'Siyana Info Solutions Private Limited','2026-11-05').result,'UNKNOWN');
});
test('legacy exact document-ID filename associations recover PDF and spreadsheet without guessing',()=>{
 for(const d of docs)assert.equal(extractionDocumentId({file_name:`sp-${d.id}-${d.file_name}`},docs),d.id);
 assert.equal(extractionDocumentId({file_name:'website-revamp-tender-document.pdf'},docs),null);
 assert.equal(extractionDocumentId({document_id:'foreign',file_name:'sp-pdf-id-website-revamp-tender-document.pdf'},docs),null);
});
test('successful native spreadsheet is not called failed OCR; partial PDFs cannot certify coverage',()=>{
 assert.equal(extractionUsable({extraction_status:'SUCCESS',extraction_metadata:{format:'non_pdf',completeness:'unverified'}}),true);
 for(const q of [{completeness:'partial'},{ocr_required_pages:[3]},{ocr_unreadable_pages:[5]},{total_pages:17,processed_pages:16}])assert.equal(extractionUsable({extraction_status:'SUCCESS',extraction_metadata:q}),false);
});
test('long audit cannot starve the later GST/PAN evidence',()=>{
 const sources=[{ref:'C1',source_id:'audit',text:'A'.repeat(110000)},{ref:'C2',source_id:'gst',text:'GST registration certificate'},{ref:'C3',source_id:'pan',text:'PAN original certificate'}];
 const selected=selectCompanyExcerpts(sources);
 assert.equal(selected.length,3);assert.equal(selected[2].text,sources[2].text);assert.ok(selected.reduce((n,s)=>n+s.text.length,0)<=100000);
 assert.equal(selected[0].excerpted,true);
});
test('absent RFP produces one evidence limitation, zero invented criteria and NOT_VERIFIED 0',()=>{
 const r=normalizeQualification({requirements:[],software_fit:false},{rfp:[],company:[],coverage:{complete:false,warnings:['Original RFP unavailable']},tender:{id:'t'},rules:[]});
 assert.equal(r.recommendation,'NOT_VERIFIED');assert.equal(r.qualification_confidence,0);assert.equal(r.requirements.length,0);
 assert.doesNotMatch(renderQualification(r),/applicability unverified|CONDITIONAL_GO/);
});
test('actual SPMVV per-year threshold preserves FY2025-26 instead of substituting a three-year average',()=>{
 const q='The bidder should have turnover of at least Rs.10.00 Lakh in the last three financial years (for every year) i.e 2023-24, 2024-25 & 2025-26.';
 const spec=resolveSpec({method:'each',years:['2023-24','2024-25','2025-26'],minimum_inr:1000000},[q],'2026-11-05');
 assert.equal(spec.method,'each');assert.equal(turnover([],spec,'Siyana').result,'UNKNOWN');
 assert.equal(resolveSpec({...spec,method:'average'},[q],'2026-11-05'),null);
});
test('educational client restriction and multiple POs cannot become a passing generic-government project count',()=>{
 const q='Bidder should have executed similar nature of work worth Rs.10 lakhs in single purchase order(s) / multiple purchase order(s) in 2023-24, 2024-25 & 2025-26 regularly for government educational organizations.';
 assert.equal(resolveSpec({scope:'website',count:1,minimum_inr:1000000,client_category:'government'},[q],'2026-11-05'),null);
});
test('internal read-only qualification probe skips chat writes but retains principal validation',async()=>{
 const user='24950c4e-a9d5-4c07-bb4f-82152930a2fe',tender='65dc7b71-072e-43f9-b5da-dc28c7f7e606';
 let forwarded=0;
 const db={from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{company_id:'company',is_active:true}})}},rpc(){throw Error('Unexpected memory write')}};
 const process=async req=>{forwarded++;assert.equal((await req.json()).read_only,true);return Response.json({ok:true})};
 const request=body=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await durableChat(request({read_only:true,tender_id:tender,question:'Qualify'}),process,db,'test-key',{})).status,401);
 assert.equal(forwarded,0);
 assert.equal((await durableChat(request({read_only:true,user_id:user,tender_id:tender,question:'Qualify'}),process,db,'test-key',{})).status,200);
 assert.equal(forwarded,1);
});
test('eligibility retrieval uses existing legacy extraction and indexed PDF/XLSX without a false OCR warning',async()=>{
 const filters=[];
 const chunks=docs.map((d,i)=>({id:'chunk'+i,source_id:'legacy'+i,chunk_index:0,content:i?'Report sheet: as per the tender document':'Bidder turnover must be at least ten lakh per year.',metadata:{tender_document_id:d.id},document_name:'legacy-'+d.file_name,source_type:'TENDER_DOCUMENT'}));
 const tables={agenttender_ai_document_chunks:chunks,agenttender_tender_documents:docs,agenttender_document_extractions:docs.map(d=>({tender_id:null,source_tender_id:'105631192',document_id:null,file_name:`sp-${d.id}-${d.file_name}`,extraction_status:'SUCCESS',extraction_metadata:{}}))};
 const db={rpc:async()=>({data:[]}),from(table){if(table==='agenttender_tenders')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{source_tender_id:'105631192'}})};const f=[];return {select(){return this},eq(k,v){filters.push([table,k,v]);if(table==='agenttender_document_extractions')f.push([k,[v]]);return this},is(k,v){f.push([k,[v]]);return this},in(k,v){f.push([k,v]);return this},order(){return this},range(){return this},then(resolve){let data=tables[table];for(const [k,v] of f)data=data.filter(x=>v.includes(x[k]));return Promise.resolve({data,count:data.length}).then(resolve)}}}};
 const result=await retrieve(db,'tender','company','Do we qualify?','ELIGIBILITY','DO_WE_QUALIFY',false);
 assert.equal(result.coverage.complete,true);assert.equal(result.tender.length,2);assert.deepEqual(result.coverage.warnings,[]);
 assert.ok(result.tender.some(x=>x.document_name==='website-revamp-tender-document.pdf'));
 assert.ok(filters.some(([t,k,v])=>t==='agenttender_ai_document_chunks'&&k==='company_id'&&v==='company'));
});
