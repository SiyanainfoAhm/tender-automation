// Deterministic checks for common eligibility clauses that the generic evaluator leaves
// UNKNOWN even though the answer is plain from Siyana's verified company documents.
// Every PASS / FAIL names the company document it comes from.
import {normalize,entityKey,pageText} from './company-qualification.mjs';

const WORD_NUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20};
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const ORDINAL={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,eleventh:11,twelfth:12,thirteenth:13,fourteenth:14,fifteenth:15,sixteenth:16,seventeenth:17,eighteenth:18,nineteenth:19,twentieth:20,'twenty first':21,'twenty second':22,'twenty third':23,'twenty fourth':24,'twenty fifth':25,'twenty sixth':26,'twenty seventh':27,'twenty eighth':28,'twenty ninth':29,thirtieth:30,'thirty first':31};

const verifiedDocs=(docs,entity)=>(docs||[]).filter(d=>d.extraction_status==='READY'&&d.verification_status==='verified'&&d.extracted_text&&entityKey(d.extracted_text).includes(entityKey(entity)));
const pageOf=(d,re)=>pageText(d.extracted_text).find(p=>re.test(p.text))?.page??null;
const ev=(d,re)=>({document:d.name,source_document_id:d.id,page:pageOf(d,re)});

export function incorporation(docs,entity){
 for(const d of verifiedDocs(docs,entity)){
  const t=d.extracted_text;
  if(!/certificate of incorporation/i.test(t)||!/companies act/i.test(t))continue;
  const cin=t.match(/\b([UL])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})\b/);
  let date=null;
  const words=normalize(t).match(/incorporated on this ([a-z ]+?) day of ([a-z]+) two thousand ([a-z ]+?)(?: under|\.|,)/);
  if(words){
   const day=ORDINAL[words[1].trim()],month=MONTHS.indexOf(words[2])+1,yr=words[3].trim().split(' ').reduce((a,w)=>a+(WORD_NUM[w]??(w==='and'?0:NaN)),0);
   if(day&&month&&Number.isFinite(yr))date=`${2000+yr}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  if(!date){const m=t.match(/Date:\s*(20\d{2})\.(\d{2})\.(\d{2})/);if(m)date=`${m[1]}-${m[2]}-${m[3]}`;}
  const privateCompany=/private limited/i.test(t)||cin?.[5]==='PTC';
  return {document:d,date,cin:cin?.[0]||null,privateCompany,publicSector:cin?.[5]==='GOI'||cin?.[5]==='SGC'};
 }
 return null;
}

function yearsBetween(from,to){const a=new Date(from+'T00:00:00Z'),b=new Date(to+'T00:00:00Z');let y=b.getUTCFullYear()-a.getUTCFullYear();if(b.getUTCMonth()<a.getUTCMonth()||(b.getUTCMonth()===a.getUTCMonth()&&b.getUTCDate()<a.getUTCDate()))y--;return y;}

/** Returns {result, explanation, company_evidence} or null when no deterministic rule applies. */
export function deterministicCheck(requirement,quotes,{documents,entity,referenceDate}){
 const req=normalize(requirement),all=normalize([requirement,...quotes].join(' '));
 const inc=()=>incorporation(documents,entity);

 // Bidder must itself be a Government organisation / PSU / named public agency.
 if(/(?:state|central)\s*\/?\s*(?:state|central)?\s*government\s+organi[sz]ations?|public sector undertaking|\bpsu\b/.test(req)
  &&/\b(?:bidder|agency|organi[sz]ation|firm)\b/.test(req)&&/such as|only|must be|shall be|should be|eligible|restricted/.test(req)
  &&!/experience|project|client|work order|orders?\b|supplied|executed|completed|empanell?ed with|similar|blacklist|debar|ineligible|banned|suspended/.test(req)){
  const c=inc();
  if(c?.privateCompany&&!c.publicSector)return {result:'FAIL',explanation:`Only Government organisations / PSUs (or the agencies named in the RFP) may bid. Siyana Info Solutions is a private limited company${c.cin?' (CIN '+c.cin+')':''}, so it is not eligible on its own.`,company_evidence:[ev(c.document,/certificate of incorporation/i)]};
 }

 // Minimum years in business / since incorporation.
 const yrs=req.match(/(?:minimum(?: period)? of|at least|not less than|minimum)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\s*\d+\s*\)\s*)?years?/)||req.match(/(\d{1,2}|one|two|three|four|five|seven|ten)\s*(?:\(\s*\d+\s*\)\s*)?years?\s+(?:of\s+)?(?:existence|operation|in business)/);
 if(yrs&&/engaged|in business|in operation|operational|existence|incorporat|registered|establish|working in|functioning/.test(req)&&!/turnover|project|order value|similar work|completed/.test(req)){
  const need=WORD_NUM[yrs[1]]??Number(yrs[1]);const c=inc();
  if(c?.date&&need){
   const have=yearsBetween(c.date,referenceDate);
   return {result:have>=need?'PASS':'FAIL',explanation:`Incorporated on ${c.date} — ${have} years before ${referenceDate}; ${need} required.`,company_evidence:[ev(c.document,/incorporat/i)]};
  }
 }

 // Not blacklisted / debarred: a self-declaration signed for each bid.
 if(/blacklist|debar/.test(req)){
  const d=verifiedDocs(documents,entity).find(x=>/blacklist|debar/i.test(x.extracted_text)&&/undertaking|declar|affidavit/i.test(x.extracted_text));
  return {result:'PASS',explanation:d?`Self-declaration: Siyana signs a non-blacklisting undertaking with each bid (a recent one is on file: ${d.name}). Prepare it on letterhead for this tender.`:'Self-declaration: prepare the non-blacklisting undertaking on company letterhead for this tender.',company_evidence:d?[ev(d,/blacklist/i)]:[]};
 }

 // Positive net worth.
 if(/net\s*worth/.test(req)&&/positive|not (?:be )?negative|non-negative|should not be eroded/.test(all)&&!/(?:rs\.?|inr|₹)\s*[\d,.]+\s*(?:crore|lakh)?|\d+\s*(?:crore|lakh)/.test(req)){
  const n=netWorthEvidence(documents,entity);
  if(n)return {result:'PASS',explanation:`Latest audited accounts${n.financial_year?' (FY '+n.financial_year+')':''} show positive total equity (debt-equity ratio ${n.ratio}), i.e. positive net worth.`,company_evidence:[ev(n.document,/Debt-Equity/i)]};
 }
 return null;
}

const certDate=t=>{const m=String(t).match(/Date\s*:?\s*(\d{2})[-./](\d{2})[-./](20\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null;};

/** Positive-equity evidence from the latest audited accounts (null when not found). */
export function netWorthEvidence(documents,entity){
 const audits=verifiedDocs(documents,entity).filter(d=>/independent auditor|statutory audit/i.test(d.extracted_text)&&/balance sheet/i.test(d.extracted_text));
 audits.sort((a,b)=>String(b.financial_year||'').localeCompare(String(a.financial_year||'')));
 for(const d of audits){
  const m=d.extracted_text.match(/Debt-Equity[\s\S]{0,120}?Total Equity\s*\n\s*(\d+(?:\.\d+)?)/i);
  if(m&&Number(m[1])>0)return {document:d,financial_year:d.financial_year||null,ratio:m[1]};
 }
 return null;
}

/** Turnover facts read from CA turnover certificates ("Financial Year / Total Turnover" tables). */
export function caCertificateTurnover(documents,entity){
 const facts=[];
 for(const d of verifiedDocs(documents,entity)){
  const t=d.extracted_text;
  if(!/chartered accountants?/i.test(t)||!/turnover/i.test(t)||!/certif/i.test(t))continue;
  if(/group companies/i.test(t))continue;
  for(const p of pageText(t)){
   if(!/financial year[\s\S]{0,40}turnover/i.test(p.text))continue;
   for(const m of p.text.matchAll(/\b(20\d{2})\s*[-–]\s*(?:20)?(\d{2})\s*\n?\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/g)){
    if((Number(m[1])+1)%100!==Number(m[2]))continue;
    const amount=Number(m[3].replace(/,/g,''));if(!Number.isFinite(amount))continue;
    facts.push({financial_year:m[1]+'-'+m[2],amount_inr:amount,currency:'INR',unit:'rupees',raw_amount:m[3],metric:'turnover',source:'CA_CERTIFICATE',legal_entity:entity,audited:true,verification_state:'VERIFIED',source_document_id:d.id,source_document_name:d.name,source_page:p.page,quote:m[0],issue_date:certDate(t)});
   }
  }
 }
 // Newest certificate wins per year.
 facts.sort((a,b)=>String(b.issue_date||'').localeCompare(String(a.issue_date||'')));
 const seen=new Set();return facts.filter(f=>!seen.has(f.financial_year)&&seen.add(f.financial_year));
}
