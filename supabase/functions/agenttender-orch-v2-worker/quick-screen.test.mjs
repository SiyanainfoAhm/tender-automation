import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuick,pagesText,selectQuickText,docRank,buildSources} from './quick-screen.mjs';

const rules=[
 {code:'HARDWARE',decision:'NO_GO'},{code:'SOFTWARE_RESALE',decision:'NO_GO'},
 {code:'TURNOVER_ABOVE_COMPANY_LIMIT',decision:'NO_GO',parameters:{max_mandatory_average_annual_turnover_inr:30000000}},
 {code:'EMD_LIMIT',decision:'NO_GO',parameters:{max_payable_emd:500000}},
 {code:'COMPANY_MANDATORY_PQ_FAILURE',decision:'NO_GO'},{code:'FIT_WEB_PORTAL',decision:'VERIFY'}];
const tender={title:'Development of official website with 3 years AMC'};
const src=(text)=>[{ref:'L',kind:'LISTING',full:tender.title,text:tender.title},{ref:'D1',kind:'DOCUMENT',full:text,text}];

test('NO_GO needs an exact quote from the source',()=>{
 const text='The scope is supply, installation and commissioning of 200 desktop computers at district offices.';
 const ok=validateQuick({decision:'NO_GO',rule_code:'HARDWARE',evidence:[{ref:'D1',quote:'supply, installation and commissioning of 200 desktop computers',rule_code:'HARDWARE'}]},src(text),rules,tender);
 assert.equal(ok.decision,'NO_GO');
 const made_up=validateQuick({decision:'NO_GO',rule_code:'HARDWARE',evidence:[{ref:'D1',quote:'supply of 500 servers and storage arrays to the data centre',rule_code:'HARDWARE'}]},src(text),rules,tender);
 assert.equal(made_up.decision,'NEED_MORE');
});
test('turnover above 3 crore is NO_GO only without JV/consortium',()=>{
 const text='Average annual turnover of the bidder should be minimum Rs. 10 Crore during last three financial years.';
 const a={decision:'NO_GO',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT',turnover_required_inr:100000000,evidence:[{ref:'D1',quote:'Average annual turnover of the bidder should be minimum Rs. 10 Crore',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT'}]};
 assert.equal(validateQuick(a,src(text),rules,tender).decision,'NO_GO');
 assert.equal(validateQuick(a,src(text+' Consortium is allowed with maximum two members.'),rules,tender).decision,'CONDITIONAL_GO');
 assert.equal(validateQuick({...a,turnover_required_inr:20000000},src(text),rules,tender).decision,'NEED_MORE');
});
test('EMD NO_GO needs payable amount above cap inside the quote',()=>{
 const text='Earnest Money Deposit (EMD) of Rs. 12,00,000/- shall be submitted. No exemption is applicable.';
 const a={decision:'NO_GO',rule_code:'EMD_LIMIT',emd_payable_inr:1200000,evidence:[{ref:'D1',quote:'Earnest Money Deposit (EMD) of Rs. 12,00,000/- shall be submitted',rule_code:'EMD_LIMIT'}]};
 assert.equal(validateQuick(a,src(text),rules,tender).decision,'NO_GO');
 assert.equal(validateQuick({...a,emd_payable_inr:400000},src(text),rules,tender).decision,'NEED_MORE');
});
test('company-document rules are never used by the quick screen',()=>{
 const text='Bidder must have ISO 27001 certificate valid on the date of bid submission.';
 assert.equal(validateQuick({decision:'NO_GO',rule_code:'COMPANY_MANDATORY_PQ_FAILURE',evidence:[{ref:'D1',quote:'Bidder must have ISO 27001 certificate valid on the date',rule_code:'COMPANY_MANDATORY_PQ_FAILURE'}]},src(text),rules,tender).decision,'NEED_MORE');
});
test('CONDITIONAL_GO needs at least one verified scope quote',()=>{
 const text='Design, development and hosting of the official website with CMS and 3 years AMC.';
 assert.equal(validateQuick({decision:'CONDITIONAL_GO',rule_code:'FIT_WEB_PORTAL',evidence:[{ref:'D1',quote:'Design, development and hosting of the official website with CMS'}]},src(text),rules,tender).decision,'CONDITIONAL_GO');
 assert.equal(validateQuick({decision:'CONDITIONAL_GO',evidence:[]},src(text),rules,tender).decision,'NEED_MORE');
});
test('partial pages are read in page order and unreadable pages skipped',()=>{
 const p=pagesText({files:{'rfp.pdf':{done:false,total_pages:10,pages:{'2':{text:'second'},'1':{text:'first'},'3':{text:'x',readable:false}}}}});
 assert.equal(p.pages,2);assert.equal(p.total,10);assert.equal(p.done,false);
 assert.ok(p.text.indexOf('first')<p.text.indexOf('second'));
});
test('long documents keep opening, eligibility and EMD sections',()=>{
 const filler='lorem ipsum '.repeat(4000);
 const text='NOTICE INVITING TENDER '+filler+' ELIGIBILITY CRITERIA turnover 5 crore '+filler+' EMD Rs 50000 '+filler;
 const out=selectQuickText(text,20000);
 assert.ok(out.length<=20100);assert.ok(out.includes('NOTICE INVITING'));assert.ok(out.includes('ELIGIBILITY CRITERIA'));assert.ok(out.includes('EMD Rs 50000'));
});
test('turnover clause deep in a long RFP is always included',()=>{
 const filler='general terms and conditions apply. '.repeat(3000);
 const clause='The bidder shall have an average annual turnover of not less than Rs 10 Crore from IT services';
 const s=buildSources({title:'t'},[{document_id:'a',file_name:'rfp.pdf',text:filler+clause+filler,complete:true,pages:40,total:40}]);
 const k=s.find(x=>x.ref==='K');
 assert.ok(k&&k.text.includes(clause));
 const v=validateQuick({decision:'NO_GO',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT',turnover_required_inr:100000000,evidence:[{ref:'K',quote:'average annual turnover of not less than Rs 10 Crore',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT'}]},s,rules,{title:'t'});
 assert.equal(v.decision,'NO_GO');
});
test('amounts written in words, lakh and crore are understood',()=>{
 const text='The bidder must have average annual turnover of not less than Rupees Ten Crore. EMD of Rs. 10 Lakh only shall be paid.';
 assert.equal(validateQuick({decision:'NO_GO',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT',turnover_required_inr:100000000,evidence:[{ref:'D1',quote:'average annual turnover of not less than Rupees Ten Crore',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT'}]},src(text),rules,tender).decision,'NO_GO');
 assert.equal(validateQuick({decision:'NO_GO',rule_code:'EMD_LIMIT',emd_payable_inr:1000000,evidence:[{ref:'D1',quote:'EMD of Rs. 10 Lakh only shall be paid',rule_code:'EMD_LIMIT'}]},src(text),rules,tender).decision,'NO_GO');
});
test('turnover above cap with JV allowed becomes CONDITIONAL_GO with a note',()=>{
 const text='Average annual turnover of the bidder should be minimum Rs. 10 Crore. Consortium is allowed with maximum two members.';
 const v=validateQuick({decision:'NO_GO',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT',turnover_required_inr:100000000,evidence:[{ref:'D1',quote:'Average annual turnover of the bidder should be minimum Rs. 10 Crore',rule_code:'TURNOVER_ABOVE_COMPANY_LIMIT'}]},src(text),rules,tender);
 assert.equal(v.decision,'CONDITIONAL_GO');assert.match(v.review_notes[0],/JV/);
});
test('corrigendum is read first, listing mirrors last',()=>{
 assert.ok(docRank('Corrigendum-1.pdf')<docRank('RFP.pdf'));assert.ok(docRank('RFP.pdf')<docRank('listing.html'));
 const s=buildSources({title:'t'},[{document_id:'a',file_name:'a.pdf',text:'hello',complete:true,pages:1,total:1}]);
 assert.equal(s[1].coverage,'complete document');
});
