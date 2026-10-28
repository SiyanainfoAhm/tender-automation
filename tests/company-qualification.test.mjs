import {test} from 'node:test';import assert from 'node:assert/strict';
import {turnover,matchProjects,extractFinancial,validateSpec,money} from '../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs';
import {dateInQuote} from '../supabase/functions/agenttender-orch-v2-chat/company-credentials-store.mjs';
import {normalizeQualification} from '../supabase/functions/agenttender-orch-v2-chat/qualification.mjs';
const entity='Siyana Info Solutions Pvt. Ltd.';
const facts=['2021-22','2022-23','2023-24'].map((financial_year,i)=>({financial_year,amount_inr:(i+1)*1000000,legal_entity:entity,currency:'INR',metric:'revenue_from_operations',audited:true,verification_state:'VERIFIED',source_page:8,quote:'Revenue from Operations\n16\n1,000,000\n2,000,000'}));
const spec={years:facts.map(f=>f.financial_year),method:'average',minimum_inr:2000000};
test('three-year average, each-year minimum, cumulative and explicit highest use deterministic arithmetic',()=>{
 assert.equal(turnover(facts,spec,entity).value_inr,2000000);assert.equal(turnover(facts,spec,entity).result,'PASS');
 assert.equal(turnover(facts,{...spec,method:'each'},entity).result,'FAIL');assert.equal(turnover(facts,{...spec,method:'cumulative'},entity).value_inr,6000000);assert.equal(turnover(facts,{...spec,method:'highest'},entity).value_inr,3000000);
});
test('missing required financial year cannot produce a passing average',()=>{const r=turnover(facts.slice(1),spec,entity);assert.equal(r.result,'UNKNOWN');assert.equal(r.value_inr,null);assert.deepEqual(r.missing_years,['2021-22']);});
test('foreign legal entity cannot contribute turnover',()=>{assert.equal(turnover(facts.map(f=>({...f,legal_entity:'IT1STOP Inc.'})),spec,entity).result,'UNKNOWN');});
test('conflicting financial values prevent apparent PASS',()=>{assert.equal(turnover([...facts,{...facts[0],amount_inr:9000000}],spec,entity).result,'UNKNOWN');});
test('profit and unaudited statements cannot establish turnover',()=>{for(const changes of [{metric:'net_profit'},{audited:false},{verification_state:'CANDIDATE'}])assert.equal(turnover(facts.map(f=>({...f,...changes})),spec,entity).result,'UNKNOWN');});
test('units normalize Indian comma groups and reject uncertain numeric text',()=>{assert.equal(money('1,09,17,639'),10917639);assert.equal(money('10','lakhs'),1000000);assert.equal(money('12?30'),null);});
test('audited table extracts revenue only, respects hundreds and prefers detailed copy',()=>{
 const d={id:'d',source_fingerprint:'f',extracted_text:'--- PAGE 1 ---\nSiyana Info Solutions Private Limited\nIndependent Auditor report\nyear ended March 31, 2025\nAmount in Rupees\nRevenue from Operations\n16\n10,917,639\n23,010,779\nOther Income\n17\n6,627\n--- PAGE 2 ---\nSiyana Info Solutions Private Limited\nyear ended March 31, 2025\nAmount in Rupees\n(in \'00)\nRevenue from Operations\n16\n109,176\n230,108\n'};
 const r=extractFinancial(d,entity);assert.deepEqual(r.facts.map(f=>f.amount_inr),[10917639,23010779]);assert.ok(r.facts.every(f=>f.source_page===1));
});
const project=(id,overrides={})=>({id,project_name:'Website '+id,client_name:'Private Client',description:'Design and development of website with CMS and cloud hosting',project_value_inr:2000000,project_status:'completed',project_type:'Private',end_date:'2024-02-20',qualification:{legal_entity:entity,verification_state:'VERIFIED',contract_ref:id,completion_evidence:{page:3,quote:'This assignment has been completed satisfactorily'},source_documents:[{source_document_id:'d',source_page:3,quote:'This assignment has been completed satisfactorily'}]},...overrides});
const experience={scope:'website development CMS',minimum_inr:1500000,count:2,completed:true,client_category:'any',since:'2021-01-01'};
test('multiple distinct completed projects meeting minimum value PASS',()=>{assert.equal(matchProjects([project('a'),project('b')],experience,entity,'2026-10-28').result,'PASS');});
test('similar-looking contract management CMS does not match website CMS',()=>{const r=matchProjects([project('a',{project_name:'Comprehensive contract management system',description:'Design and development of comprehensive contract management system CMS'})],{...experience,count:1},entity,'2026-10-28');assert.equal(r.qualifying_count,0);});
test('missing completion certificate, government requirement, dates and foreign entity exclude projects',()=>{
 for(const overrides of [{qualification:{legal_entity:entity,verification_state:'VERIFIED',source_documents:[{}]}},{project_status:null},{end_date:'2020-01-01'},{qualification:{...project('a').qualification,legal_entity:'Mitaja Corporation'}},{project_value_inr:null}])assert.equal(matchProjects([project('a',overrides)],{...experience,count:1},entity,'2026-10-28').result,'UNKNOWN');
 assert.equal(matchProjects([project('a')],{...experience,count:1,client_category:'government'},entity,'2026-10-28').result,'UNKNOWN');
});
test('duplicate project references count once',()=>{assert.equal(matchProjects([project('a'),project('a')],experience,entity,'2026-10-28').qualifying_count,1);});
test('forged threshold or years rejected by original-clause validation',()=>{
 const quote='Average annual turnover INR 20 lakhs in 2021-22, 2022-23 and 2023-24';assert.ok(validateSpec(spec,[quote]));assert.equal(validateSpec({...spec,minimum_inr:100},[quote]),false);assert.equal(validateSpec({...spec,years:['2020-21']},[quote]),false);
});
test('date normalization must be proved by the actual source quote',()=>{assert.ok(dateInQuote('2024-02-20','Completion Date: 20-Feb-2024'));assert.equal(dateInQuote('2024-02-20','Date: 21-Feb-2024'),false);});
test('missing original RFP cannot produce mandatory financial PASS',()=>{const r=normalizeQualification({software_fit:true,requirements:[{category:'Turnover',mandatory:true,result:'PASS',turnover_spec:spec}]},{rfp:[],company:[],coverage:{complete:false,warnings:[]},tender:{id:'t'},rules:[],credentials:{entity,facts,projects:[],issues:[]}});assert.equal(r.requirements.length,0);assert.equal(r.recommendation,'NOT_VERIFIED');});
test('expired certification cannot establish PASS',()=>{
 const r=normalizeQualification({requirements:[{category:'Certifications / empanelment',mandatory:true,result:'PASS',rfp_evidence:[{ref:'R1',quote:'Bidder must hold ISO 27001 certification'}],company_evidence:[{ref:'C1',quote:'Siyana holds ISO 27001 certification'}]}]},{rfp:[{ref:'R1',text:'Bidder must hold ISO 27001 certification'}],company:[{ref:'C1',text:'Siyana holds ISO 27001 certification',metadata:{verification_status:'verified',expiry_date:'2020-01-01'}}],coverage:{complete:true,warnings:[]},tender:{id:'t'},rules:[]});assert.equal(r.requirements[0].result,'UNKNOWN');
});

test('relative RFP years resolve by closing date, never by available facts',async()=>{
 const {resolveSpec}=await import('../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs');
 const resolved=resolveSpec({method:'average',years:[],minimum_inr:10000000},['Average annual turnover INR 1 Cr for the last three financial years'],'2026-11-20');
 assert.deepEqual(resolved.years,['2023-24','2024-25','2025-26']);assert.equal(turnover(facts,resolved,entity).result,'UNKNOWN');
});
test('both chatbot direct financial routes use identical source-validated calculation and deny unpermitted reads',async()=>{
 const {companyFinancialAnswer}=await import('../supabase/functions/agenttender-orch-v2-chat/qualification.mjs');
 const documents=facts.map((f,i)=>({id:'d'+i,name:'Audited '+f.financial_year,source_fingerprint:'f'+i,extraction_status:'READY',verification_status:'verified',extracted_text:f.quote}));
 const data={company_name:entity,documents,facts:facts.map((f,i)=>({fact_key:'financial.turnover:'+i,verification_state:'VERIFIED',fact:{...f,source_document_id:'d'+i,source_fingerprint:'f'+i}})),projects:[]};
 let reads=0;const db={rpc:async()=>{reads++;return {data};}};const question='Calculate our average turnover for 2021-22, 2022-23 and 2023-24';
 const a=await companyFinancialAnswer(db,'company',question);const b=await companyFinancialAnswer(db,'company',question);assert.equal(a.answer,b.answer);assert.equal(a.calculation.value_inr,2000000);assert.match(a.answer,/Audited 2021-22, p. 8/);
 assert.equal(await companyFinancialAnswer(db,'company',question,false),null);assert.equal(reads,2);
 documents[0].source_fingerprint='changed';assert.equal((await companyFinancialAnswer(db,'company',question)).calculation.value_inr,null);
});
test('project completion is confirmed from a linked actual certificate, never a conditional work-order clause',async()=>{
 const {validateProject}=await import('../supabase/functions/agenttender-orch-v2-chat/company-credentials-store.mjs');
 const body='--- PAGE 1 ---\nVendor: Siyana Info Solutions Pvt. Ltd.\nClient: Sample Client Private Limited\nProject Title: Design and development of corporate website\nContract No: SAMPLE-WO-2023-01\nContract Value: INR 18,35,000\nScope: Design and development of website with WordPress CMS\nStart Date: 22-May-2023\nPayment after successful completion of work.\n';
 const certificate='--- PAGE 2 ---\nCOMPLETION CERTIFICATE\nVendor: Siyana Info Solutions Pvt. Ltd.\nContract No: SAMPLE-WO-2023-01\nGo-Live / Completion Date: 20-Feb-2024\nThis assignment has been completed satisfactorily.\n';
 const raw={client_name:'Sample Client Private Limited',project_name:'Design and development of corporate website',contract_ref:'SAMPLE-WO-2023-01',currency:'INR',original_amount:1835000,start_date:'2023-05-22',completion_date:null,client_category:'Private',evidence:{entity:'Vendor: Siyana Info Solutions Pvt. Ltd.',client:'Client: Sample Client Private Limited',project:'Project Title: Design and development of corporate website',contract_ref:'Contract No: SAMPLE-WO-2023-01',value:'Contract Value: INR 18,35,000',scope:'Scope: Design and development of website with WordPress CMS',start:'Start Date: 22-May-2023',completion:'',completion_date:''}};
 const doc={id:'d',company_id:'c',source_fingerprint:'f',verification_status:'verified',extracted_text:body};
 assert.equal(validateProject(structuredClone(raw),doc,entity).project.project_status,null);
 const proven=validateProject(structuredClone(raw),{...doc,extracted_text:body+certificate},entity).project;assert.equal(proven.project_status,'completed');assert.equal(proven.end_date,'2024-02-20');
});

test('recertification due is not an extension of actual certificate expiry',async()=>{
 const {certificateValidity,certificationAssessment}=await import('../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs');
 const text='Siyana Info Solutions Pvt Ltd ISO/IEC 27001:2022\nSurv. audit on or before/ Certificate expiry\n16 September 2025\nRecertification Due\n16 September 2027';
 assert.equal(certificateValidity(text,null,'2026-11-20').valid,false);
 assert.equal(certificationAssessment('ISO 27001:2022',[{name:'ISO Certificate',verification_status:'verified',extraction_status:'READY',extracted_text:text}],entity,'2026-11-20').result,'UNKNOWN');
});
test('incorporation CIN cannot prove mandatory PAN and GST',async()=>{
 const {certificationAssessment}=await import('../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs');
 const result=certificationAssessment('Valid PAN and GST registrations',[{name:'Incorporation',verification_status:'verified',extraction_status:'READY',extracted_text:'Siyana Info Solutions Pvt Ltd CIN U72200GJ2015PTC083424'}],entity,'2026-10-28');assert.equal(result.result,'UNKNOWN');assert.deepEqual(result.missing,['PAN','GST']);
});
test('experience financial-year window excludes current-year and older completions',async()=>{
 const {resolveSpec}=await import('../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs');
 const s=resolveSpec({scope:'website development',count:1,minimum_inr:1000000,completed:true,client_category:'any'},['One completed website development project of INR 10 lakhs during the last three financial years'],'2026-11-20');
 assert.equal(s.since,'2023-04-01');assert.equal(s.until,'2026-03-31');
 assert.equal(matchProjects([project('a',{end_date:'2026-06-01'})],s,entity,'2026-11-20').qualifying_count,0);
 assert.equal(matchProjects([project('a',{end_date:'2024-02-20'})],s,entity,'2026-11-20').qualifying_count,1);
});
test('bundled certificates cannot borrow another certificate expiry or legal entity',async()=>{
 const {certificationAssessment}=await import('../supabase/functions/agenttender-orch-v2-chat/company-qualification.mjs');
 const d={name:'All Certificates',verification_status:'verified',extraction_status:'READY',extracted_text:'--- PAGE 1 ---\nSiyana Info Solutions Pvt Ltd CMMI Level 3\nCertificate Expiry 05 April 2027\n--- PAGE 2 ---\nSiyana Info Solutions Pvt Ltd ISO 27001:2022\nCertificate expiry 16 September 2025'};
 assert.equal(certificationAssessment('ISO 27001:2022',[d],entity,'2026-11-20').result,'UNKNOWN');
 assert.equal(certificationAssessment('CMMI Level 3',[d],entity,'2026-11-20').result,'PASS');
});
