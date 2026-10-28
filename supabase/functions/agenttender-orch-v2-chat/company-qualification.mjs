// Shared deterministic credential arithmetic. Original-source facts, never summaries.
export const CREDENTIAL_VERSION='company-credentials-20261028-v3';
export const normalize=s=>String(s??'').replace(/\s+/g,' ').trim().toLowerCase();
export const entityKey=s=>normalize(s).replace(/\b(pvt|private)\.?/g,'private').replace(/\b(ltd|limited)\.?/g,'limited').replace(/\bsolutions?\b/g,'solution').replace(/[^a-z0-9]/g,'');
export const money=(s,unit='rupees')=>{
 if(typeof s==='number')return Number.isFinite(s)&&s>=0?s:null;
 const raw=String(s??'').trim();if(!/^(?:INR|Rs\.?|₹|USD)?\s*[\d,]+(?:\.\d{1,2})?(?:\s*\/-)?$/i.test(raw))return null;
 const n=Number(raw.replace(/INR|Rs\.?|₹|USD|,|\s|\/-/gi,''));
 const scale={rupees:1,inr:1,units:1,lakh:100000,lakhs:100000,crore:10000000,crores:10000000,cr:10000000,lac:100000,lacs:100000,million:1000000,thousand:1000,thousands:1000,hundreds:100}[normalize(unit)];
 return Number.isFinite(n)&&scale?n*scale:null;
};
export const fy=s=>{const m=String(s??'').match(/^(20\d{2})[-–/](?:20)?(\d{2})$/);return m&&Number(m[2])===(Number(m[1])+1)%100?m[1]+'-'+m[2]:null;};
export function pageText(text){const ms=[...String(text||'').matchAll(/--- PAGE (\d+) ---|\[Page (\d+)\]/gi)];return ms.length?ms.map((m,i)=>({page:Number(m[1]||m[2]),text:text.slice(m.index+m[0].length,ms[i+1]?.index??text.length)})):[{page:null,text:String(text||'')}];}
export function functionalTypes(scope){
 const s=normalize(scope);const types=[];
 if(/(?:website|web portal|content management system|content management)/.test(s)&&/develop|design|migration|build|implement|revamp|experience|working/.test(s))types.push('WEBSITE_CMS');
 if(/payroll|human resource|\bhrms\b/.test(s))types.push('PAYROLL_HRMS');
 if(/contract management/.test(s))types.push('CONTRACT_MANAGEMENT');
 if(/\bgis\b|geospatial/.test(s))types.push('GIS');
 if(/chatbot|conversational ai/.test(s))types.push('AI_CHATBOT');
 if(/learning management|\blms\b/.test(s))types.push('LMS');
 if(/annual maintenance|\bamc\b/.test(s)&&!types.length)types.push('MAINTENANCE_ONLY');
 return types;
}
export function extractFinancial(d,companyName){
 const text=d.extracted_text||'',entity=entityKey(companyName),pages=pageText(text),out=[];
 const identity=pages.find(p=>entityKey(p.text).includes(entity));
 // A filename cannot establish legal ownership. CA certificates without identity remain leads.
 if(!identity){
  const leads=[];
  if(/turnover/i.test(d.name))for(const p of pages)for(const m of p.text.matchAll(/(20\d{2}-\d{2})\s+([\d,]+(?:\.\d{1,2})?)/g))if(fy(m[1])&&money(m[2])!==null)leads.push({financial_year:m[1],amount_inr:money(m[2]),currency:'INR',unit:'rupees',raw_amount:m[2],metric:'turnover',legal_entity:companyName,entity_proven:false,audited:false,source_document_id:d.id,source_page:p.page,quote:m[0],source_fingerprint:d.source_fingerprint});
  return {facts:leads,issues:['LEGAL_ENTITY_UNPROVEN: '+d.name]};
 }
 for(const p of pages){
  const year=p.text.match(/year ended\s+March\s+31,?\s+(20\d{2})/i);
  const m=p.text.match(/Revenue\s+from\s+Operations\s+(\d{1,2})\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)/i);
  if(!entityKey(p.text.slice(0,600)).includes(entity)||!year||!m||!/amount in (?:rupess|rupees)/i.test(p.text))continue;
  const y=Number(year[1]);const quote=m[0];
  [m[2],m[3]].forEach((value,i)=>{const unit=/in\s*['’]00/.test(p.text)?'hundreds':/in\s+(?:lakhs?|crores?|millions?|thousands?)/i.test(p.text)?normalize(p.text.match(/in\s+(lakhs?|crores?|millions?|thousands?)/i)[1]):'rupees';const amount=money(value,unit);if(amount===null)return;
   out.push({financial_year:(y-1-i)+'-'+String(y-i).slice(2),amount_inr:amount,currency:'INR',unit,precision_inr:unit==='hundreds'?100:1,raw_amount:value,metric:'revenue_from_operations',legal_entity:companyName,audited:/independent auditor|auditor.s report|statutory audit/i.test(text),source_document_id:d.id,source_page:p.page,quote,year_quote:year[0],entity_quote:identity.text.match(/[^\n]*Siyana[^\n]*/i)?.[0]||companyName,source_fingerprint:d.source_fingerprint});
  });
 }
 // Tax-audit table with unambiguous inline ordering (not OCR-reordered columns).
 if(!out.length&&d.financial_year&&fy(d.financial_year))for(const p of pages){const m=p.text.match(/Total turnover of the assessee[\t ]+([\d,]+)[\t ]+([\d,]+)/i);if(!m)continue;
  const y=Number(d.financial_year.slice(0,4));[m[1],m[2]].forEach((v,i)=>out.push({financial_year:(y-i)+'-'+String(y+1-i).slice(2),amount_inr:money(v),currency:'INR',unit:'rupees',raw_amount:v,metric:'turnover',legal_entity:companyName,audited:true,source_document_id:d.id,source_page:p.page,quote:m[0],year_quote:d.financial_year,entity_quote:companyName,source_fingerprint:d.source_fingerprint}));
 }
 const preferred=out.filter(f=>!out.some(g=>g.financial_year===f.financial_year&&(g.precision_inr||1)<(f.precision_inr||1)));
 return {facts:preferred,issues:out.length?[]:['NO_UNAMBIGUOUS_TURNOVER_TABLE: '+d.name]};
}
export function turnover(facts,spec,entity){
 const years=[...new Set((spec.years||[]).map(fy))];
 const result={result:'UNKNOWN',method:spec.method,years,missing_years:[],contradictions:[],value_inr:null,evidence:[]};
 if(!years.length||years.includes(null)||!['average','each','cumulative','highest'].includes(spec.method))return {...result,explanation:'Required years and calculation method must be explicit.'};
 const values=[];
 for(const year of years){
  const candidates=facts.filter(x=>x.financial_year===year&&entityKey(x.legal_entity)===entityKey(entity)&&x.currency==='INR'&&['turnover','revenue_from_operations'].includes(x.metric));
  const valid=candidates.filter(x=>x.verification_state==='VERIFIED'&&x.audited===true&&Number.isFinite(x.amount_inr)&&x.amount_inr>=0&&x.source_page&&x.quote);
  const amounts=[...new Set(candidates.filter(x=>Number.isFinite(x.amount_inr)).map(x=>x.amount_inr))];
  if(amounts.length>1)result.contradictions.push({year,values:amounts});
  if(!valid.length)result.missing_years.push(year);else{values.push(valid[0].amount_inr);result.evidence.push(...valid);}
 }
 if(result.missing_years.length||result.contradictions.length)return {...result,explanation:'Missing or contradictory annual evidence prevents a verified calculation.'};
 const sum=values.reduce((a,b)=>a+b,0);result.value_inr=spec.method==='average'?sum/years.length:spec.method==='cumulative'?sum:spec.method==='highest'?Math.max(...values):Math.min(...values);
 result.result=Number.isFinite(spec.minimum_inr)&&spec.minimum_inr>=0?(result.value_inr>=spec.minimum_inr?'PASS':'FAIL'):'UNKNOWN';
 return {...result,annual_values:years.map((year,i)=>({year,amount_inr:values[i]})),explanation:`${spec.method}: ${values.join(' + ')}${spec.method==='average'?' / '+years.length:''} = INR ${result.value_inr}. Required INR ${spec.minimum_inr??'unspecified'}.`};
}
export function matchProjects(projects,spec,entity,validOn){
 const matches=[],excluded=[];const required=functionalTypes(spec.scope||'');
 for(const p of projects){const reasons=[];const q=p.qualification||{};
  if(entityKey(q.legal_entity)!==entityKey(entity))reasons.push('different/unproven legal entity');
  if(q.verification_state!=='VERIFIED')reasons.push('unverified original evidence');
  if(!required.length||required.some(t=>!functionalTypes([p.project_name,p.description].join(' ')).includes(t)))reasons.push('functional scope differs or is unspecified');
  if(!Number.isFinite(p.project_value_inr)||p.project_value_inr<spec.minimum_inr)reasons.push('contract value missing/below minimum');
  if(spec.completed!==false&&(p.project_status!=='completed'||!q.completion_evidence?.page||!q.completion_evidence?.quote||!p.end_date))reasons.push('completion not proven');
  if(spec.client_category==='government'&&!['Central Government','State Government','PSU','Local Body / Municipal Body','Autonomous Body'].includes(p.project_type))reasons.push('government client not proven');
  if(spec.client_category==='private'&&p.project_type!=='Private')reasons.push('private client not proven');
  if(spec.since&&(!p.end_date||p.end_date<spec.since)||spec.until&&(!p.end_date||p.end_date>spec.until))reasons.push('outside experience period');
  if(p.end_date&&p.end_date>validOn)reasons.push('future completion');
  if(!q.source_documents?.length)reasons.push('original source missing');
  (reasons.length?excluded:matches).push(reasons.length?{id:p.id,project_name:p.project_name,reasons}:p);
 }
 const distinct=[...new Map(matches.map(p=>[normalize(p.qualification?.contract_ref||p.client_name+'|'+p.project_name),p])).values()];
 return {result:required.length&&Number.isInteger(spec.count)&&spec.count>0&&Number.isFinite(spec.minimum_inr)&&distinct.length>=spec.count?'PASS':'UNKNOWN',required_count:spec.count,qualifying_count:distinct.length,projects:distinct,excluded,explanation:`${distinct.length} distinct source-backed projects qualify; ${spec.count??'unspecified'} required. Missing proof is UNKNOWN.`};
}
export function validateSpec(spec,quotes){
 const text=normalize(quotes.join(' ')),flat=text.replace(/,/g,'');if(!spec||!text)return false;
 if(spec.minimum_inr!==undefined){
  const numbers=[...text.matchAll(/(?:inr|rs\.?|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|millions?|thousands?)?/gi)].map(m=>money(m[1],m[2]||'rupees'));
  if(!numbers.includes(spec.minimum_inr))return false;
 }
 if(spec.years&&(!spec.years.length||spec.years.some(y=>!fy(y)||!text.includes(y)&&!text.includes(y.slice(0,5)+'20'+y.slice(5)))))return false;
 if(spec.method&&!({average:/average/,each:/each|every|per annum/,cumulative:/cumulative|aggregate|total/,highest:/highest|any one|at least one/}[spec.method]?.test(text)))return false;
 if(spec.count!==undefined&&!new RegExp('\\b'+spec.count+'\\b|\\b'+(['zero','one','two','three','four','five'][spec.count]||'___')+'\\b').test(flat))return false;
 if(spec.since&&!spec.period_source_verified&&!text.includes(spec.since))return false; // Relative windows need explicit original dates before use.
 if(spec.completed===false&&!/ongoing|on.going|in.progress/.test(text))return false;
 if(spec.client_category==='any'&&/government|public sector|\bpsu\b/.test(text)&&!/private|any (?:client|sector)/.test(text))return false;
 if(spec.scope&&functionalTypes(spec.scope).some(t=>!functionalTypes(text).includes(t)))return false;
 if(spec.client_category==='government'&&!/government|public sector|\bpsu\b/.test(text))return false;
 return true;
}

export function resolveSpec(spec,quotes,referenceDate){
 if(!spec)return null;
 const q=normalize(quotes.join(' '));
 if(spec.scope&&(/government\s+educational|multiple\s+purchase\s+order/i.test(q)))return null;
 const period=q.match(/(?:last|past|preceding)\s+(one|two|three|four|five|six|seven|ten|[1-9]\d?)\s+(?:completed\s+)?(?:financial\s+)?years?/);
 const n=period?({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,ten:10}[period[1]]||Number(period[1])):null;
 if(n&&(!referenceDate||!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)))return null;
 if(spec.method&&n&&!/20\d{2}[-–/](?:20)?\d{2}/.test(q)){
  const y=Number(referenceDate.slice(0,4))-(Number(referenceDate.slice(5,7))<4?1:0);
  const years=Array.from({length:n},(_,i)=>(y-n+i)+'-'+String(y-n+i+1).slice(2));
  const resolved={...spec,years,period_source_verified:true};
  return validateSpec({...resolved,years:undefined},quotes)?resolved:null;
 }
 if(spec.scope&&n){const d=new Date(referenceDate+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-n);if(/financial\s+years?/.test(q)){const y=Number(referenceDate.slice(0,4))-(Number(referenceDate.slice(5,7))<4?1:0);spec={...spec,since:(y-n)+'-04-01',until:y+'-03-31',period_source_verified:true};}else spec={...spec,since:d.toISOString().slice(0,10),until:referenceDate,period_source_verified:true};}
 if(spec.scope&&/(?:last|past|preceding).{0,30}years?/.test(q)&&!spec.since)return null;
 return validateSpec(spec,quotes)?spec:null;
}
export function certificateValidity(text,metadataExpiry,validOn){
 const n=normalize(text);const match=n.match(/(?:certificate expiry|expiry date|valid (?:up to|until|till))[^\d]{0,180}(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-./ ]\s*([a-z]{3,9}|\d{1,2})\s*[-./ , ]\s*(20\d{2})/i);
 let originalExpiry=null;
 if(match){const month=/^\d+$/.test(match[2])?Number(match[2]):['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3))+1;if(month>=1&&month<=12)originalExpiry=match[3]+'-'+String(month).padStart(2,'0')+'-'+match[1].padStart(2,'0');}
 const expiry=[metadataExpiry,originalExpiry].filter(Boolean).sort()[0];
 return {valid:!!expiry&&expiry>=validOn,expiry_date:expiry||null,source_expiry:originalExpiry,explanation:expiry?(expiry<validOn?'Original certificate expired on '+expiry+'.':'Certificate valid through '+expiry+'.'):'Certificate validity is not proven.'};
}
export function certificationAssessment(clause,documents,entity,validOn){
 const n=normalize(clause),requirements=[];
 for(const m of n.matchAll(/iso\s*(?:\/\s*iec\s*)?(\d{4,5})(?::(\d{4}))?/g))requirements.push({kind:'ISO',code:m[1],edition:m[2]||null});
 if(/cmmi/.test(n))requirements.push({kind:'CMMI',levels:[...n.matchAll(/(?:level\s*)?\b([35])\b/g)].map(m=>m[1])});
 if(/firm registration certificate|registrar of companies|certificate of incorporation/.test(n))requirements.push({kind:'INCORPORATION'});
 if(/\bpan\b/.test(n))requirements.push({kind:'PAN'});
 if(/\bgst\b|\bgstin\b/.test(n))requirements.push({kind:'GST'});
 if(!requirements.length)return {result:'UNKNOWN',explanation:'Mandatory registration/empanelment requires explicit original proof; this credential type is not automatically verified.'};
 const evidence=[],missing=[];
 for(const req of requirements){
  const matches=documents.flatMap(d=>pageText(d.extracted_text).map(page=>({...d,extracted_text:page.text,source_page:page.page,expiry_date:pageText(d.extracted_text).length===1?d.expiry_date:null}))).filter(d=>d.extraction_status==='READY'&&d.verification_status==='verified'&&entityKey(d.extracted_text).includes(entityKey(entity))).filter(d=>{
   const t=normalize(d.extracted_text);
   if(req.kind==='INCORPORATION')return /certificate of incorporation|hereby certify.{0,150}incorporat/s.test(t)&&/companies act/.test(t)&&/\b[UL][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}\b/.test(d.extracted_text);
   if(req.kind==='PAN')return /\b[A-Z]{5}[0-9]{4}[A-Z]\b/.test(d.extracted_text)&&/\bpan\b|permanent account number/.test(t);
   if(req.kind==='GST')return /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/.test(d.extracted_text)&&/registration certificate|gstin/.test(t);
   if(!/certif|iso|cmmi/i.test(d.name+' '+d.document_category))return false;
   if(!certificateValidity(d.extracted_text,d.expiry_date,validOn).valid)return false;
   if(req.kind==='ISO')return new RegExp('iso\\s*(?:/\\s*iec\\s*)?'+req.code+(req.edition?':'+req.edition:'')).test(t);
   return req.levels.some(level=>new RegExp('cmmi\\s+(?:maturity\\s+)?level\\s+'+level).test(t));
  });
  if(matches.length)evidence.push(...matches.map(d=>({source_document_id:d.id,document:d.name,source_fingerprint:d.source_fingerprint,source_page:d.source_page,validity:certificateValidity(d.extracted_text,d.expiry_date,validOn)})));else missing.push(req.kind+(req.code?' '+req.code+(req.edition?':'+req.edition:''):''));
 }
 return {result:missing.length?'UNKNOWN':'PASS',evidence,missing,explanation:missing.length?'Current original evidence is missing, expired or mismatched for: '+missing.join(', ')+'. Recertification due dates do not extend an expired certificate.':'All listed credential identifiers, legal entity and required validity are supported by current original documents.'};
}
