export const POLICY_VERSION='approved-evidence-v1';
// A pure advisory decision shared by both chats and the existing rules evaluator.
// Historical statuses and proposal checklist completion are deliberately absent.
export function qualificationDecision({requirements=[],softwareFit=false,coverageComplete=false,requirementsComplete=false}){
 if(requirements.some(r=>r.mandatory===true&&r.result==='FAIL'&&r.rfp_evidence?.length))return 'NO_GO';
 if(softwareFit&&coverageComplete&&requirementsComplete&&requirements.length&&requirements.every(r=>r.mandatory!==null&&(r.mandatory===false||r.result==='PASS')))return 'GO';
 return 'NOT_VERIFIED';
}
export function screen(t,rules){
 const text=[t.title,t.description].filter(Boolean).join(' ').toLowerCase();
 const matches=rules.filter(r=>(r.match_patterns||[]).some(p=>String(p).trim().length>=4&&text.includes(String(p).toLowerCase())));
 const emd=rules.find(r=>r.code==='EMD_LIMIT');
 const limit=emd?.parameters?.max_payable_emd;
 const amount=t.emd_amount;
 const emdCandidate=emd && typeof limit==='number' && amount!==null && amount!==undefined && amount!=='' && Number.isFinite(Number(amount)) && Number(amount)>limit;
 const hard=matches.filter(r=>r.decision==='NO_GO').map(r=>r.code);
 if(emdCandidate&&!hard.includes('EMD_LIMIT'))hard.push('EMD_LIMIT');
 return {status:'RULES_SCREENED',decision_candidate:hard.length?'NO_GO_CANDIDATE':'MORE_EVIDENCE',confirmed_rule_codes:[],hard_rule_candidates:hard,positive_rule_candidates:matches.filter(r=>r.decision!=='NO_GO').map(r=>r.code),matched_rule_codes:matches.map(r=>r.code),rule_versions:Object.fromEntries(rules.map(r=>[r.code,r.version])),rule_count:rules.length,policy_version:POLICY_VERSION,requires_document_verification:true,emd_review:{threshold:limit??null,listed_amount:amount??null,payable_verified:false,exemptions_reviewed:false},evidence_needed:['Verify original RFP scope, mandatory PQ, actual payable EMD and applicable exemptions'],explanation:'Pattern matches are retrieval candidates only; missing evidence remains VERIFY.',ai_calls:0};
}
export async function activeRules(db){const {data,error}=await db.rpc('agenttender_active_eligibility_rules');if(error)throw error;if(!Array.isArray(data)||!data.length)throw Error('APPROVED_RULES_UNAVAILABLE');return data;}
