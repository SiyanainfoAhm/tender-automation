export const RULE_VERSION = "VBDC_RULES_20261023_4";
const ok=(r:any)=>{if(r.error)throw r.error;return r.data};
export function financialYears(s:string):string[]{
 const out=new Set<string>();
 for(const m of String(s||"").matchAll(/\b(?:FY\s*)?(20\d{2}|2\d)\s*[-–/]\s*(20\d{2}|\d{2})\b/gi)){
  const start=Number(m[1].length===2?"20"+m[1]:m[1]),end=Number(m[2].length===2?"20"+m[2]:m[2]);
  if(end===start+1)out.add(start+"-"+String(end).slice(-2));
 }
 return [...out].sort();
}
export function annualFamily(s:string):string|null{
 if(/\bITR\b|income.?tax return/i.test(s))return "income_tax_return";
 if(/audit.*(?:account|financial|balance|report)|(?:account|financial).*audit/i.test(s))return "audited_accounts";
 if(/balance sheet/i.test(s))return "balance_sheet";
 if(/profit\s*(?:and|&)\s*loss account/i.test(s))return "profit_loss_account";
 return null;
}
export function packagingAction(i:any){return /(?:each|every|all) page.*sign|signed and printed.*sealed envelope|separate password.protected file|emailed for pre.bid|physical submission|submit.*sealed envelope/i.test(String(i.requirement_name||""));}
export async function applyChecklistRules(db:any,workspaceId:string){
 const rows=ok(await db.from("agenttender_bid_checklist_items").select("*").eq("workspace_id",workspaceId).eq("is_archived",false).order("created_at"))||[];
 const changes:any[]=[];
 const families=rows.filter((i:any)=>annualFamily(i.requirement_name));
 const sets=families.map((i:any)=>financialYears(i.source_text||"")).filter((a:any)=>a.length>=2&&a.length<=5);
 const common=[...new Set(sets.map((a:any)=>a.join(",")))];
 for(const i of rows){
  if(packagingAction(i)&&i.processing_type==="AI_DRAFT"){
   ok(await db.from("agenttender_go_workflow_events").insert({tender_id:i.tender_id,event_type:"CHECKLIST_RULE_REPAIR",details:{rule_version:RULE_VERSION,before:i,reason:"Submission action requires checking actual bid files; a standalone declaration cannot complete it."}}));
   ok(await db.from("agenttender_bid_checklist_items").update({requirement_kind:"MANUAL_ACTION",generation_allowed:false,completion_status:"ACTION_REQUIRED",evidence_review_status:"BID_PACKET_ACTION_REQUIRED",automation_last_error:"Verify the actual submission packet; do not generate a declaration claiming this action is done.",updated_at:new Date().toISOString()}).eq("id",i.id));
   changes.push({id:i.id,action:"PACKET_ACTION"});continue;
  }
  const family=annualFamily(i.requirement_name);if(!family||i.processing_type!=="COMPANY_DOC")continue;
  const named=financialYears(i.requirement_name);if(named.length===1)continue;
  let years=financialYears(i.source_text||"");
  if(years.length<2&&named.length>1)years=named;
  if(years.length<2&&common.length===1)years=common[0].split(",");
  if(years.length<2||years.length>5)continue;
  const ids=[];
  for(const year of years){
   let child=rows.find((r:any)=>r.id!==i.id&&annualFamily(r.requirement_name)===family&&financialYears(r.requirement_name).length===1&&financialYears(r.requirement_name)[0]===year);
   if(!child){
    const label=family==="income_tax_return"?"Income tax return":family==="audited_accounts"?"Audited annual accounts":family==="balance_sheet"?"Balance sheet":"Profit and Loss account";
    const key=RULE_VERSION+"_"+family+"_"+year;
    const {id,created_at,updated_at,processing_type,...base}=i;
    child=ok(await db.from("agenttender_bid_checklist_items").insert({...base,requirement_key:key,normalized_requirement_key:key,requirement_name:label+" — FY "+year,description:"Separate evidence for financial year "+year+". "+String(i.description||""),required_action:"Attach the actual "+label.toLowerCase()+" for FY "+year+"; distinguish assessment year from financial year. "+String(i.required_action||""),completion_status:"ACTION_REQUIRED",matched_company_document_id:null,matched_workspace_document_id:null,matched_document_source:null,matched_by:null,match_confidence:null,match_reason:null,manual_completed:false,manual_completed_at:null,manual_completed_by:null,evidence_review_status:"REVERIFY_REQUIRED",evidence_reviewed_at:null,generation_allowed:false,requirement_kind:"EXISTING_EVIDENCE",automation_attempts:0,automation_evidence_fingerprint:null,automation_last_attempt_at:null,automation_next_attempt_at:null,automation_last_error:null,requirement_origin:"RULE"}).select("*").single());rows.push(child);
   }
   ids.push(child.id);
  }
  ok(await db.from("agenttender_go_workflow_events").insert({tender_id:i.tender_id,event_type:"MULTI_YEAR_REQUIREMENT_EXPANDED",details:{rule_version:RULE_VERSION,before:i,years,child_item_ids:ids,original_documents_preserved:true}}));
  ok(await db.from("agenttender_bid_checklist_items").update({is_archived:true,archived_at:new Date().toISOString(),match_reason:"Replaced by separate financial-year requirements: "+ids.join(", "),updated_at:new Date().toISOString()}).eq("id",i.id));
  changes.push({id:i.id,action:"YEAR_SPLIT",years,children:ids});
 }
 return changes;
}

