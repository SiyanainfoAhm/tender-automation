const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// 2026-10-27: plain-language status changes ("change status to will bid", "mark this no go because ...")
const STATUS_WORDS=[
 [/^(?:go|will[\s_-]*bid|bid|pursue|go[\s_-]*for[\s_-]*(?:it|bid))$/i,'GO'],
 [/^(?:no[\s_-]*go|nogo|no[\s_-]*bid|not[\s_-]*bid(?:ding)?|reject(?:ed)?|drop(?:ped)?)$/i,'NO_GO'],
 [/^(?:conditional[\s_-]*go|may[\s_-]*bid|maybe)$/i,'CONDITIONAL_GO'],
 [/^(?:review|under[\s_-]*review)$/i,'REVIEW'],[/^verify$/i,'VERIFY'],[/^submitted$/i,'SUBMITTED'],[/^won$/i,'WON'],[/^lost$/i,'LOST'],
 [/^disqualified$/i,'DISQUALIFIED'],[/^technical(?:ly)?[\s_-]*rejected$/i,'TECHNICAL_REJECTED'],[/^financial(?:ly)?[\s_-]*rejected$/i,'FINANCIAL_REJECTED']];
export function normalizeStatus(v){
 const s=String(v||'').trim().replace(/^["'`]+|["'`.!?]+$/g,'').replace(/^(?:status\s+)?/i,'').replace(/\s+(?:status|please|pls|now)$/i,'').trim();
 for(const [r,t] of STATUS_WORDS)if(r.test(s))return t;
 return null;
}
function reasonText(r){r=String(r||'').trim();return (r?'Changed via tender chatbot: '+r:'Changed via tender chatbot on user request').slice(0,1000);}
export function routeAction(input){
 const q=String(input.question||'').trim();
 const control=q.match(new RegExp('^(CONFIRM|CANCEL|ACTION STATUS)\\s+('+UUID+')$','i'));
 if(control)return {phase:control[1].toUpperCase()==='CONFIRM'?'confirm':control[1].toUpperCase()==='CANCEL'?'cancel':'status',id:control[2]};
 const quick=q.replace(/[.!\s]+$/,'').toLowerCase();
 if(/^(?:yes|y|ok|okay|confirm|confirmed|yes confirm|yes,? confirm|go ahead|proceed|do it|yes please)$/.test(quick))return {phase:'confirm',latest:true};
 if(/^(?:cancel|no|don'?t|do not|stop)$/.test(quick))return {phase:'cancel',latest:true};
 if(input.action_request){
  const x=input.action_request;
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['kind','target','item_id','reason'].includes(k)))return {error:'INVALID_ACTION_SCHEMA'};
  if(!['tender_status','checklist_status','worker'].includes(x.kind)||typeof x.target!=='string'||typeof x.reason!=='string')return {error:'INVALID_ACTION_SCHEMA'};
  if(x.kind==='checklist_status'&&!new RegExp('^'+UUID+'$','i').test(x.item_id||''))return {error:'CHECKLIST_ID_REQUIRED'};
  return {phase:'propose',payload:x};
 }
 const text=q.replace(/^please\s+/i,'');
 let m=text.match(/^(?:set|change|move|mark)\s+(?:this\s+)?tender(?:\s+status)?\s+(?:to|as)\s+([a-z_ -]+?)\s*(?:;\s*reason:|because)\s*(.{10,1000})$/i);
 if(m)return {phase:'propose',payload:{kind:'tender_status',target:normalizeStatus(m[1])||m[1].trim().toUpperCase().replace(/[ -]+/g,'_'),reason:m[2].trim()}};
 m=text.match(new RegExp('^(?:set|change|mark)\\s+checklist(?:\\s+item)?\\s+('+UUID+')\\s+(?:to|as)\\s+([a-z_ -]+?)\\s*(?:;\\s*reason:|because)\\s*(.{10,1000})$','i'));
 if(m)return {phase:'propose',payload:{kind:'checklist_status',item_id:m[1],target:m[2].trim().toUpperCase().replace(/[ -]+/g,'_'),reason:m[3].trim()}};
 m=text.match(/^(?:run|execute|apply)\s+(?:the\s+)?checklist\s+(classifier|rules)\s*(?:;\s*reason:|because)\s*(.{10,1000})$/i);
 if(m)return {phase:'propose',payload:{kind:'worker',target:'checklist_'+m[1].toLowerCase(),reason:m[2].trim()}};
 // Natural language tender status change.
 m=text.match(/^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+|pls\s+|kindly\s+)?(?:set|change|move|mark|convert|update|make|put|turn)\s+(?:the\s+|this\s+|it\s+)?(?:tender\s*)?(?:status\s*)?(?:of\s+(?:this|the)\s+tender\s*)?(?:to|as|into|in)\s+(.+?)(?:\s*(?:[;,.\-]\s*)?(?:reason\s*:?|because|since|as)\s+(.{3,1000}))?\s*[?.!]*$/i);
 if(m){const target=normalizeStatus(m[1]);if(target)return {phase:'propose',payload:{kind:'tender_status',target,reason:reasonText(m[2])}};return {error:'STATUS_TARGET_UNKNOWN'};}
 m=text.match(/^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+|pls\s+|kindly\s+)?(?:mark|make)\s+(?:it|this|this\s+tender)\s+(.+?)(?:\s*(?:[;,.\-]\s*)?(?:reason\s*:?|because|since)\s+(.{3,1000}))?\s*[?.!]*$/i);
 if(m){const target=normalizeStatus(m[1]);if(target)return {phase:'propose',payload:{kind:'tender_status',target,reason:reasonText(m[2])}};}
 if(/^(?:(?:can|could|would)\s+(?:you|u)\s+|please\s+|pls\s+|kindly\s+)*(?:change|convert|set|update|mark|move|make)\b.*\b(?:status|go|no[\s-]?go|will[\s-]?bid)\b/i.test(q))return {error:'STATUS_TARGET_NEEDED'};
 if(/^(?:please\s+)?(?:set|change|move|mark|run|execute|apply|confirm|cancel)\b/i.test(q))return {error:'ACTION_NEEDS_DETAILS'};
 return null;
}
