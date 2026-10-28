import {loadCredentials} from '../agenttender-orch-v2-chat/company-credentials-store.mjs';
import {extractFinancial,entityKey,fy,turnover,pageText} from '../agenttender-orch-v2-chat/company-qualification.mjs';
export function companyQuestion(q){
 if(/qualif|eligib|\bpq\b|\btq\b|which tenders|this tender|this rfp|requirement/i.test(q))return false;
 return /turnover|company|our profile|about us|certificat|\biso\b|\bgst\b|incorporat|our experience|similar projects|our projects|projects (?:have we|we have)|net worth/i.test(q);
}
const clean=s=>String(s??'').replace(/[|<>]/g,' ').trim();
const fmt=n=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n);
const checked=async q=>{const {data,error}=await q;if(error)throw Error('Company records unavailable');return data;};
export function financialYears(q,now=new Date()){
 q=q.replace(/\bavg\b/gi,'average');
 const explicit=[...new Set((q.match(/20\d{2}[-–/](?:20)?\d{2}/g)||[]).map(fy).filter(Boolean))];if(explicit.length===2&&/\bto\b|through|between|–/.test(q)){const a=Number(explicit[0].slice(0,4)),b=Number(explicit[1].slice(0,4));if(b>=a&&b-a<=10)return Array.from({length:b-a+1},(_,i)=>(a+i)+'-'+String(a+i+1).slice(-2));}if(explicit.length)return explicit;
 const india=new Date(now.getTime()+330*60000),y=india.getUTCFullYear()-(india.getUTCMonth()<3?1:0);
 const m=q.match(/(?:last|past|previous)\s+(one|two|three|four|five|[1-5])\s+(?:completed\s+)?(?:financial\s+)?years?/i);
 const n=m?({one:1,two:2,three:3,four:4,five:5}[m[1].toLowerCase()]||Number(m[1])):/average/i.test(q)?3:0;
 return Array.from({length:n},(_,i)=>(y-n+i)+'-'+String(y-n+i+1).slice(-2));
}
// Only explicit, identity-bearing CA table rows; never tax income or filenames.
export function certificateFacts(d,entity){
 if(!/certificate|turnover/i.test(d.name)||d.extraction_status!=='READY')return [];
 const out=[];
 for(const p of pageText(d.extracted_text)){
  if(!p.page||!entityKey(p.text).includes(entityKey(entity))||!/chartered accountants/i.test(p.text)||!/financial year\s+total turnover/i.test(p.text))continue;
  const table=p.text.split(/financial year\s+total turnover/i)[1]?.split(/average annual turnover/i)[0]||'';
  for(const m of table.matchAll(/(20\d{2}[-–/]\d{2})\s+(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/g))if(fy(m[1]))out.push({financial_year:fy(m[1]),amount_inr:Number(m[2].replace(/,/g,'')),currency:'INR',metric:'turnover',legal_entity:entity,audited:true,source_document_id:d.id,source_document_name:d.name,source_page:p.page,quote:m[0],verification_state:d.verification_status==='verified'?'VERIFIED':'CANDIDATE'});
 }
 return out;
}
export function renderFinancial(state,q,now=new Date()){
 q=q.replace(/\bavg\b/gi,'average');
 const extracted=state.documents.filter(d=>d.extraction_status==='READY').flatMap(d=>[...extractFinancial(d,state.entity).facts,...certificateFacts(d,state.entity)].filter(f=>f.entity_proven!==false).map(f=>({...f,source_document_name:d.name,verification_state:d.verification_status==='verified'&&f.audited&&f.source_page?'VERIFIED':'CANDIDATE'})));
 const facts=[...state.facts.filter(f=>f.entity_proven!==false),...extracted],years=financialYears(q,now);
 const selected=years.length?years:[...new Set(facts.map(f=>f.financial_year).filter(Boolean))].sort();
 const relevant=facts.filter(f=>selected.includes(f.financial_year)&&entityKey(f.legal_entity)===entityKey(state.entity));
 const lines=['**'+clean(state.entity)+' — annual turnover**','',years.length?'Requested financial years: '+years.join(', ')+'.':'Available source years; not a substituted eligibility window.','','| Financial year | Amount (INR) | Evidence status | Source |','| --- | ---: | --- | --- |'];
 const seen=new Set();
 for(const f of relevant){const key=[f.financial_year,f.amount_inr,f.source_document_id].join('|');if(seen.has(key))continue;seen.add(key);lines.push(`| ${f.financial_year} | ₹${fmt(f.amount_inr)} | ${f.verification_state==='VERIFIED'?'Source-backed; document verified':'Unverified candidate'} | ${clean(f.source_document_name||f.source_document_id)}, p. ${f.source_page||'unknown'} |`);}
 if(!relevant.length)lines.push('| — | Unknown | No annual amount retrieved | — |');
 const method=/cumulative/i.test(q)?'cumulative':/highest/i.test(q)?'highest':'average';const c=turnover(facts,{years:selected,method},state.entity);
 if(c.contradictions.length)lines.push('','**Conflicting annual evidence:** '+c.contradictions.map(x=>x.year+': '+x.values.map(n=>'₹'+fmt(n)).join(' versus ')).join('; ')+'. Reconcile originals before certifying a combined calculation.');
 if(c.missing_years.length)lines.push('','Missing verified annual evidence: '+c.missing_years.join(', ')+'.');
 if(/average|cumulative|highest/i.test(q))lines.push('',c.value_inr===null?'**Verified '+method+': unresolved.** '+c.explanation:'**Calculated '+method+': ₹'+fmt(c.value_inr)+'**. Inputs: '+c.annual_values.map(x=>x.year+' = ₹'+fmt(x.amount_inr)).join('; ')+'.');
 for(const d of state.documents){const fs=certificateFacts(d,state.entity).filter(f=>!years.length||years.includes(f.financial_year));if(fs.length>1&&/average/i.test(q)&&(!years.length||years.every(y=>fs.some(f=>f.financial_year===y))))lines.push('','Certificate-specific average ('+clean(d.name)+', p. '+fs[0].source_page+'): ('+fs.map(f=>'₹'+fmt(f.amount_inr)).join(' + ')+') / '+fs.length+' = **₹'+fmt(fs.reduce((s,f)=>s+f.amount_inr,0)/fs.length)+'**. Document status: '+clean(d.verification_status)+'. This does not resolve conflicting evidence.');}
 lines.push('','Amounts come from extracted original annual evidence, not tax income or filenames. Source-backed figures are not an independent audit or tender eligibility decision.');
 return {details:lines.join('\n'),ids:[...new Set(relevant.map(f=>f.source_document_id))]};
}
export async function answerCompany(db,companyId,q,permissions){
 const followups=['What is our turnover by financial year?','Show our certifications.','Show our similar projects.'];
 if(!permissions.has('documents.view'))return {structured:{summary:'Company evidence access is restricted.',details:'Your role does not permit viewing company documents and credentials.',tender_ids:[],document_ids:[],followups},documents:[]};
 const state=await loadCredentials(db,companyId);
 const profile=await checked(db.from('agenttender_companies').select('name,description,industry_type,business_location,year_established,website').eq('id',companyId).maybeSingle());
 const documents=state.documents.map(d=>({source_id:d.id,document_name:d.name,metadata:{verification_status:d.verification_status,financial_year:d.financial_year}}));
 let details,ids=[];
 if(/turnover/i.test(q)){const r=renderFinancial(state,q);details=r.details;ids=r.ids;}
 else if(/experience|projects|work orders/i.test(q)){
  const terms=q.toLowerCase().match(/website|cms|payroll|hrms|gis|chatbot|drupal|wordpress|lms|software|portal/g)||[];
  const projects=state.projects.filter(p=>!p.qualification?.legal_entity||entityKey(p.qualification.legal_entity)===entityKey(state.entity)).filter(p=>!terms.length||terms.some(t=>(p.project_name+' '+p.description+' '+JSON.stringify(p.nature_of_work)).toLowerCase().includes(t)));
  details='**'+clean(state.entity)+' — experience**\n\n'+(projects.slice(0,40).map(p=>{const refs=p.qualification?.source_documents||[];ids.push(...refs.map(e=>e.source_document_id));return '- **'+clean(p.project_name)+'**; client: '+clean(p.client_name||'unknown')+'; value: '+(p.project_value_inr!=null?'₹'+fmt(p.project_value_inr):'unverified')+'; status: '+clean(p.project_status||'unknown')+'; period: '+clean(p.start_date||'?')+' to '+clean(p.end_date||'?')+'. Scope: '+clean(p.description||'unavailable')+'. Sources: '+(refs.map(e=>clean(e.source_document_name)+', p. '+e.source_page).join('; ')||'No verified original reference')+'. Verification: '+clean(p.qualification?.verification_state||'CANDIDATE')+'.';}).join('\n')||'No matching active experience record retrieved.')+'\n\nScope matches are leads, not tender qualification. Candidate records do not prove completion, value or legal ownership. Showing up to 40 active records.';
 }else if(/certificat|\biso\b|\bgst\b|incorporat/i.test(q)){
  const topic=q.match(/\b(?:ISO|GST|MSME|PAN|incorporation)\b/i)?.[0];
  const docs=state.documents.filter(d=>/certificate|registration|incorporat|\biso\b|\bgst\b/i.test(d.name+' '+d.document_category)).filter(d=>!topic||new RegExp(topic,'i').test(d.name+' '+d.extracted_text));ids=docs.slice(0,40).map(d=>d.id);
  details='**'+clean(state.entity)+' — certification sources**\n\n'+(docs.slice(0,40).map(d=>'- '+clean(d.name)+'; document verification: '+clean(d.verification_status)+'; extraction: '+clean(d.extraction_status)+'; expiry: '+clean(d.expiry_date||'not recorded')+(d.expiry_date&&d.expiry_date<new Date().toISOString().slice(0,10)?' (expired)':'')+'.'+pageText(d.extracted_text).filter(p=>entityKey(p.text).includes(entityKey(state.entity))&&/certificate|registration/i.test(p.text)).slice(0,1).map(p=>' Original excerpt, p. '+(p.page||'unknown')+': '+clean(p.text.slice(0,900))).join('')).join('\n')||'No certification source retrieved.')+'\n\nCatalogue candidates: names and document verification alone do not establish current certification scope, legal ownership or tender compliance. Inspect the cited originals. Showing up to 40 sources.';
 }else if(/net worth/i.test(q)){
  details='Net worth remains unverified. No deterministic source-backed net-worth extraction is available; turnover, income and contract values cannot substitute for net worth.';
 }else{
  details='**'+clean(state.entity)+' — company profile**\n\n'+Object.entries(profile||{}).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>'- '+k.replace(/_/g,' ')+': '+clean(v)).join('\n')+'\n\nSource: current company profile (company-maintained). '+state.projects.length+' active experience records; '+state.documents.length+' eligible extracted document sources.\n\nAsk for turnover, certifications or similar projects for source-specific evidence. Missing fields remain unverified.';
 }
 return {structured:{summary:'Company information for '+clean(state.entity)+'.',details,tender_ids:[],document_ids:ids,followups},documents};
}
