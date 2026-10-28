// Pure adapters for legacy extraction identity and bounded evidence review.
// Callers must scope documents, chunks and extractions to the same tender/company.
export function extractionDocumentId(extraction, documents) {
 if (extraction.document_id) return documents.some(d=>d.id===extraction.document_id)?extraction.document_id:null;
 const matches=documents.filter(d=>extraction.file_name===`sp-${d.id}-${d.file_name}`);
 return matches.length===1?matches[0].id:null;
}
export function extractionUsable(e) {
 const q=e.extraction_metadata||{};
 return e.extraction_status==='SUCCESS' && q.unsupported_type!==true &&
  !['partial','failed'].includes(q.completeness) && !q.ocr_unreadable_pages?.length &&
  !q.ocr_required_pages?.length && !(q.total_pages && q.processed_pages<q.total_pages);
}
export function selectCompanyExcerpts(sources, budget=100000) {
 // Fair allocation keeps late certificates/registrations in the prompt instead
 // of letting the first long audit exhaust the entire review budget.
 const groups=new Map();
 for(const source of sources){const key=source.source_id||source.ref;const group=groups.get(key)||[];group.push(source);groups.set(key,group);}
 const ordered=[];
 for(let i=0;ordered.length<sources.length;i++)for(const group of groups.values())if(group[i])ordered.push(group[i]);
 const quota=Math.floor(budget/Math.max(1,ordered.length));
 return ordered.map(s=>({...s,text:s.text.slice(0,quota),excerpted:s.text.length>quota})).filter(s=>s.text);
}
export function qualificationConfidence(requirements, coverage, decision) {
 // Evidence completion score, not a probability of winning or model certainty.
 if(decision==='NO_GO')return 0;
 if(decision==='GO')return 100;
 const mandatory=requirements.filter(r=>r.mandatory===true);
 if(!mandatory.length)return 0;
 const score=Math.round(100*mandatory.filter(r=>r.result==='PASS').length/mandatory.length);
 return Math.min(coverage.complete?99:49,score);
}
// Submission instructions often sit outside the eligibility table. Preserve
// these explicit obligations even when the model omits them; never infer FAIL.
export function uncoveredSubmissionRequirements(rfp, requirements) {
 const normalize=s=>String(s||'').replace(/\s+/g,' ').toLowerCase();
 const checks=[
  {pattern:/income tax paid receipts|income.tax returns? (?:for|of)|filing acknowledg/,label:'Required income-tax receipts / filings'},
  {pattern:/authenticate.{0,80}digital certificate|bids not authenticated by digital/,label:'Bidder digital-signature authentication'},
  {pattern:/register themselves.{0,100}e.procurement|registration with e.procurement platform/,label:'Registration on the specified e-procurement platform'},
  {pattern:/pay.{0,100}(?:transaction fee|non.refundable transaction)/,label:'Mandatory e-procurement transaction fee'},
 ];
 const cited=requirements.flatMap(r=>r.rfp_evidence||[]).map(e=>normalize(e.quote)).join(' ');
 return checks.flatMap(check=>{
  if(check.pattern.test(cited))return [];
  const source=rfp.find(s=>check.pattern.test(normalize(s.text)));
  if(!source)return [];
  return [{category:'Other mandatory PQ / TQ',requirement:check.label,mandatory:true,result:'UNKNOWN',basis:'COMPANY_COMPARISON',rfp_evidence:[{ref:source.ref,quote:source.text}],company_evidence:[],explanation:'The original bid instructions require this item. Matching current company/submission proof has not been verified; missing proof is not a confirmed failure.',action:'Verify the cited instruction and corresponding original evidence.'}];
 });
}
