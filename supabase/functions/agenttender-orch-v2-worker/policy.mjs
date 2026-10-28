export const POLICY_VERSION='progressive-approved-evidence-v3';
export function screen(t,rules){
 const text=[t.title,t.description,t.organization,t.category,t.tender_type].filter(Boolean).join(' ').toLowerCase();
 const matches=rules.filter(r=>(r.match_patterns||[]).some(p=>String(p).trim().length>=4&&text.includes(String(p).toLowerCase())));
 const emd=rules.find(r=>r.code==='EMD_LIMIT');
 const limit=emd?.parameters?.max_payable_emd;
 const amount=t.emd_amount;
 const emdCandidate=emd && typeof limit==='number' && amount!==null && amount!==undefined && amount!=='' && Number.isFinite(Number(amount)) && Number(amount)>limit;
 const explicitExclusions=[];
 if(/\b(?:expression of interest|eoi)\b/i.test(text))explicitExclusions.push('EOI_ONLY');
 if(/\brugged laptops?\b/i.test(text)&&/\bsoftware development\b/i.test(text))explicitExclusions.push('HARDWARE_BUNDLE');
 const hard=matches.filter(r=>r.decision==='NO_GO').map(r=>r.code);
 if(emdCandidate&&!hard.includes('EMD_LIMIT'))hard.push('EMD_LIMIT');
 for(const code of explicitExclusions)if(!hard.includes(code))hard.push(code);
 return {status:'RULES_SCREENED',decision_candidate:hard.length?'NO_GO_CANDIDATE':'MORE_EVIDENCE',confirmed_rule_codes:[],hard_rule_candidates:hard,positive_rule_candidates:matches.filter(r=>r.decision!=='NO_GO').map(r=>r.code),matched_rule_codes:[...new Set([...matches.map(r=>r.code),...explicitExclusions])],rule_versions:Object.fromEntries(rules.map(r=>[r.code,r.version])),rule_count:rules.length,policy_version:POLICY_VERSION,requires_evidence_verification:true,requires_document_verification:hard.length>0,emd_review:{threshold:limit??null,listed_amount:amount??null,payable_verified:false,exemptions_reviewed:false},evidence_needed:['Assess listing and existing text first; request only unresolved scope, mandatory PQ or payable EMD evidence'],explanation:explicitExclusions.length?'High-specificity exclusion detected in listing; verify against procurement documents before final decision.':'Pattern matches are retrieval candidates only; missing evidence remains VERIFY.',ai_calls:0};
}
export async function activeRules(db){const {data,error}=await db.rpc('agenttender_active_eligibility_rules');if(error)throw error;if(!Array.isArray(data)||!data.length)throw Error('APPROVED_RULES_UNAVAILABLE');return data;}
