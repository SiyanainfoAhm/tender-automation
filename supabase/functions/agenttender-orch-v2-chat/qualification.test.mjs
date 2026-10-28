import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQualification,renderQualification,dimensions,sourceBoundEvidence} from './qualification.mjs';
import {qualificationDecision} from './policy.mjs';
const rfp=[{ref:'R1',document:'Original RFP.pdf',page:7,text:'Custom website development is required. Average annual turnover shall be INR 1000000. Bidder must be NICSI empanelled. Subcontracting is prohibited.'}];
const company=[{ref:'C1',document:'Audited statements.pdf',page:3,text:'Average annual turnover is INR 2000000 for the three required financial years.',metadata:{verification_status:'verified'}}];
const context={rfp,company,coverage:{complete:true,warnings:[]},tender:{id:'t',source_tender_id:'104339554',title:'Software',status:'VERIFY',qualification_status:'NO_GO'},rules:[]};
const evidence=[{ref:'R1',quote:'Custom website development is required.'}];
const row=(category,result='PASS',basis='RFP_ONLY')=>({category,requirement:category,mandatory:true,result,basis,rfp_evidence:evidence,company_evidence:[],explanation:'Evidence based',action:'Obtain proof'});
const base=()=>({software_fit:true,requirements_complete:true,summary:'Current evidence reviewed.',requirements:dimensions.map(d=>({...row(d),mandatory:d==='Scope'||d==='EMD'||d==='Deadline / amendments'}))});
test('suitable custom website with every mandatory requirement proven is GO',()=>{
 const report=normalizeQualification(base(),context);assert.equal(report.recommendation,'GO');
 assert.match(renderQualification(report),/Original RFP.pdf, p. 7/);
 assert.match(renderQualification(report),/recorded qualification: NO_GO/);
});
test('missing company financial proof is UNKNOWN and NOT_VERIFIED, never FAIL',()=>{
 const raw=base();raw.requirements[1]=row('Turnover','FAIL','COMPANY_COMPARISON');
 const r=normalizeQualification(raw,context);assert.equal(r.requirements[1].result,'UNKNOWN');assert.equal(r.recommendation,'NOT_VERIFIED');
});
test('turnover summary quote alone cannot replace annual verified arithmetic',()=>{
 const raw=base();raw.requirements[1]={...row('Turnover','PASS','COMPANY_COMPARISON'),company_evidence:[{ref:'C1',quote:company[0].text}]};
 assert.equal(normalizeQualification(raw,context).requirements[1].result,'UNKNOWN');
 raw.requirements[1].company_evidence[0].quote='Turnover is INR 9000000';
 assert.equal(normalizeQualification(raw,context).requirements[1].result,'UNKNOWN');
});
test('similar-project absence cannot be a confirmed mandatory experience failure',()=>{
 const raw=base();raw.requirements[2]=row('Experience','FAIL','COMPANY_COMPARISON');assert.equal(normalizeQualification(raw,context).recommendation,'NOT_VERIFIED');
});
test('mandatory NICSI/MeitY failure needs positive company evidence',()=>{
 const raw=base();raw.requirements[4]={...row('Certifications / empanelment','FAIL','COMPANY_COMPARISON'),rfp_evidence:[{ref:'R1',quote:'Bidder must be NICSI empanelled.'}],company_evidence:[{ref:'C2',quote:'The company is not NICSI empanelled.'}]};
 const r=normalizeQualification(raw,{...context,company:[...company,{ref:'C2',document:'Verified company declaration.pdf',text:'The company is not NICSI empanelled.',metadata:{verification_status:'verified'}}]});assert.equal(r.recommendation,'NO_GO');
});
test('hardware-dominant original scope can establish NO_GO without company documents',()=>{
 const raw=base();raw.requirements[0]={...row('Scope','FAIL','EXCLUSION'),rule_code:'HARDWARE',exceptions_checked:true};
 assert.equal(normalizeQualification(raw,{...context,rules:[{code:'HARDWARE',decision:'NO_GO'}]}).recommendation,'NO_GO');
});
test('missing RFP and incomplete OCR prevent full qualification certification',()=>{
 for(const c of [{...context,rfp:[]},{...context,coverage:{complete:false,warnings:['Four pages require OCR']}}])assert.equal(normalizeQualification(base(),c).recommendation,'NOT_VERIFIED');
});
test('medical software is not excluded by industry and recorded NO_GO is not inherited',()=>{
 const r=normalizeQualification(base(),{...context,tender:{...context.tender,title:'BHU Anaesthesia Software'}});assert.equal(r.recommendation,'GO');
});
test('partner cannot fill bidder credential gap without a cited permission clause',()=>{
 const raw=base();raw.requirements[4]={...row('Certifications / empanelment','PASS','COMPANY_COMPARISON'),uses_partner:true,company_evidence:[{ref:'C1',quote:company[0].text}]};
 assert.equal(normalizeQualification(raw,context).requirements[4].result,'UNKNOWN');
});
test('candidate and expired company documents remain leads and cannot prove PASS',()=>{
 for(const metadata of [{verification_status:'pending'},{verification_status:'verified',expiry_date:'2020-01-01'}])assert.equal(sourceBoundEvidence([{ref:'C1',quote:company[0].text}],[{...company[0],metadata}],true)[0].verified,false);
});
test('manual GO is preserved and cannot override unknown eligibility or an expired official deadline',()=>{
 const raw=base();raw.requirements[11]=row('Deadline / amendments','FAIL','DEADLINE');
 const r=normalizeQualification(raw,{...context,tender:{...context.tender,qualification_status:'GO',decision_source:'MANUAL'}});assert.equal(r.recommendation,'NO_GO');assert.equal(r.recorded_qualification_status,'GO');assert.equal(r.changed_business_statuses,0);
});
test('policy requires positive software scope and complete evidence for GO',()=>{
 assert.equal(qualificationDecision({requirements:[{mandatory:true,result:'PASS'}],coverageComplete:true,requirementsComplete:true,softwareFit:false}),'NOT_VERIFIED');
});
test('EMD failures use the approved 500000 payable cap and verified exemption review',()=>{
 for(const emd_assessment of [{},{currency:'INR',payable_amount:400000,payable_verified:true,exemptions_reviewed:true},{currency:'INR',payable_amount:600000,payable_verified:false,exemptions_reviewed:true}]){
  const raw=base();raw.requirements[5]={...row('EMD','FAIL'),emd_assessment};assert.equal(normalizeQualification(raw,context).requirements[5].result,'UNKNOWN');
 }
 const raw=base();raw.requirements[5]={...row('EMD','FAIL'),emd_assessment:{currency:'INR',payable_amount:600000,payable_verified:true,exemptions_reviewed:true}};assert.equal(normalizeQualification(raw,context).recommendation,'NO_GO');
});
test('CERT delivery-firm wording is distinguished from bidder-level empanelment',()=>{
 const r=normalizeQualification(base(),{...context,rfp:[...rfp,{ref:'R2',document:'Scope.pdf',page:2,text:'Undertake Vulnerability Assessment of the website quarterly, by a CERT empaneled firm.'}]});
 assert.match(r.interpretations[0],/does not establish bidder-level empanelment/);assert.match(renderQualification(r),/Scope.pdf, p. 2/);
});
