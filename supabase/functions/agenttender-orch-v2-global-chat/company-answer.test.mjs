import {test} from 'node:test';import assert from 'node:assert/strict';
import {companyQuestion,financialYears,certificateFacts,renderFinancial,answerCompany} from './company-answer.mjs';
const entity='Siyana Info Solutions Private Limited';
const d={id:'certificate',name:'Financial AVG Annual Certificate',extraction_status:'READY',verification_status:'verified',extracted_text:'--- PAGE 1 ---\nCHARTERED ACCOUNTANTS\n'+entity+'\nFinancial Year\nTotal Turnover\n2023-24\n₹ 23010779\n2024-25\n₹ 10917639\n2025-26\n₹ 22305373\nAverage Annual Turnover ₹ 1,87,44,597/-'};
const state={entity,facts:[],documents:[d]};
test('company intents require no tender; qualification stays in existing tender route',()=>{
 for(const q of ['What is our turnover?','average turnover','company profile','Show our certifications','Show our similar projects','our experience'])assert.ok(companyQuestion(q),q);
 for(const q of ['Do we qualify for this tender?','Show tenders where we meet all PQ requirements.','Which tenders need company certificates?'])assert.equal(companyQuestion(q),false,q);
});
test('CA annual amounts and average are evidence-based, cited and deduplicated',()=>{
 assert.equal(certificateFacts(d,entity).length,3);const r=renderFinancial(state,'average turnover',new Date('2026-10-28'));
 assert.match(r.details,/1,87,44,597/);assert.match(r.details,/2,30,10,779/);assert.match(r.details,/2025-26/);assert.deepEqual(r.ids,['certificate']);
});
test('different legal entity, metadata-only, income and unverified evidence cannot establish verified figures',()=>{
 assert.deepEqual(certificateFacts(d,'Other Limited'),[]);assert.deepEqual(certificateFacts({...d,extracted_text:'Total income 900000'},entity),[]);
 const r=renderFinancial({...state,documents:[{...d,verification_status:'pending'}]},'average turnover',new Date('2026-10-28'));
 assert.match(r.details,/Verified average: unresolved/);assert.match(r.details,/Unverified candidate/);
});
test('missing FY and conflicting originals never certify a combined average',()=>{
 const f={...certificateFacts(d,entity)[1],amount_inr:10777575};const r=renderFinancial({...state,facts:[f]},'average turnover',new Date('2026-10-28'));
 assert.match(r.details,/Conflicting annual evidence/);assert.match(r.details,/Verified average: unresolved/);
 assert.match(renderFinancial(state,'average turnover 2021-22 2022-23').details,/Missing verified annual evidence: 2021-22, 2022-23/);
});
test('explicit FY normalization and India April rollover',()=>{
 assert.deepEqual(financialYears('turnover 2024/2025'),['2024-25']);
 assert.deepEqual(financialYears('average turnover',new Date('2026-03-31T18:29:00Z')),['2022-23','2023-24','2024-25']);
 assert.deepEqual(financialYears('average turnover',new Date('2026-03-31T18:30:00Z')),['2023-24','2024-25','2025-26']);
});
test('permission denial performs no credential or document query',async()=>{
 const db=new Proxy({},{get(){throw Error('must not read');}});const r=await answerCompany(db,'company','turnover',new Set());assert.match(r.structured.details,/does not permit/);assert.deepEqual(r.documents,[]);
});
