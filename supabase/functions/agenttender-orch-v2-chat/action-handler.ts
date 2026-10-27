import {routeAction} from './action-router.mjs';
const STATUS_LABEL:Record<string,string>={GO:'GO (Will Bid)',NO_GO:'NO GO',CONDITIONAL_GO:'CONDITIONAL GO (May Bid)',REVIEW:'REVIEW',VERIFY:'VERIFY',SUBMITTED:'SUBMITTED',WON:'WON',LOST:'LOST',DISQUALIFIED:'DISQUALIFIED',TECHNICAL_REJECTED:'TECHNICAL REJECTED',FINANCIAL_REJECTED:'FINANCIAL REJECTED'};
const label=(s:any)=>STATUS_LABEL[String(s||'')]||String(s||'none');
const STATUS_HELP='Tell me which status to set, for example:\n- "change status to GO" (Will Bid)\n- "change status to NO GO because the scope is hardware supply"\n- "change status to CONDITIONAL GO" (May Bid)\n- "change status to REVIEW"\nI will show the change and ask you to reply YES before anything is updated.';
const FRIENDLY:Record<string,string>={INVALID_TRANSITION:'That status change is not allowed from the current status.',APPROVAL_PERMISSION_REQUIRED:'Your role cannot approve this decision.',PERMISSION_DENIED:'Your role cannot change tender status.',CONFIRMATION_EXPIRED:'The confirmation expired. Ask for the change again.',STATE_CHANGED_RECONFIRM:'The tender changed since this was proposed. Ask for the change again.',VERIFIED_SUBMISSION_REQUIRED:'SUBMITTED needs a recorded submission (reference and time) in the bid workspace first.',TRANSITION_REJECTED_BY_EXISTING_GUARD:'A safety rule on the tender blocked this change.',AUTHENTICATION_REQUIRED:'Your session expired. Please sign in again.'};
export async function handleAction(req:Request,input:any,db:any,URL:string,KEY:string,cors:any){
 const route:any=routeAction(input);if(!route)return null;
 const respond=(body:any,status=200)=>Response.json({route:'ORCHESTRATOR_V2_AUTHORIZED_ACTION',changed_business_statuses:0,...body},{status,headers:cors});
 // Plain YES / NO refers to the latest pending proposal on this tender; otherwise it is an ordinary chat message.
 if(route.latest){
  const {data:pending}=await db.from('agenttender_chat_actions').select('id').eq('tender_id',input.tender_id).eq('company_id',input.company_id).eq('state','PROPOSED').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(!pending?.id)return null;
  route.id=pending.id;
 }
 if(route.error==='STATUS_TARGET_NEEDED'||route.error==='STATUS_TARGET_UNKNOWN')return respond({ok:true,status:'NEEDS_DETAILS',error:route.error,answer:(route.error==='STATUS_TARGET_UNKNOWN'?'I did not recognise that status. ':'')+STATUS_HELP});
 if(route.error)return respond({ok:false,error:route.error,answer:'Specify the exact action and a reason. Examples: “Set tender status to REVIEW; reason: Recheck the eligibility evidence” or “Mark checklist <item UUID> as ACTION_REQUIRED; reason: Updated evidence is needed” or “Run checklist classifier; reason: Review the pending item routes”. Every action requires a separate CONFIRM reply.'},400);
 const token=req.headers.get('x-agenttender-session')?.trim()||'';
 const params={p_token:token,p_company:input.company_id,p_tender:input.tender_id,p_phase:route.phase,p_payload:route.payload||{},p_request_key:input.request_id||crypto.randomUUID(),p_action:route.id||null};
 const invoke=async(p:any)=>{const {data,error}=await db.rpc('agenttender_chat_action_v1',p);if(error)throw Error('ACTION_SERVICE_UNAVAILABLE');return data;};
 try{
  let result=await invoke(params);
  if(!result.ok){const code=String(result.error||'');const friendly=FRIENDLY[code]||'';return respond({...result,answer:'Action was not executed: '+(friendly?friendly+' ('+code+')':code)},/AUTHENTICATION/.test(result.error)?401:403);}
  let a=result.action;
  if(result.execute_worker===true){
   const classifier=a.payload.target==='checklist_classifier';
   const slug=classifier?'agenttender-checklist-classifier':'agenttender-bid-workspace-worker';
   let response:any;
   try{
    const res=await fetch(URL+'/functions/v1/'+slug,{method:'POST',headers:{Authorization:'Bearer '+KEY,apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({action:'chat_scoped',chat_action_id:a.id,tender_id:input.tender_id,company_id:input.company_id,workspace_id:result.workspace_id}),signal:AbortSignal.timeout(120000)});
    response=await res.json();
    if(!res.ok||response.ok!==true)throw Error('Worker reported failure');
    // Verify observable database output, not the model's statement of success.
    if(classifier){
     const ds=response.decisions;if(!Array.isArray(ds)||response.processed!==ds.length)throw Error('Invalid worker receipt');
     if(ds.length){const {data:rows,error}=await db.from('agenttender_bid_checklist_items').select('id,processing_type,ai_classification_checked').eq('company_id',input.company_id).eq('tender_id',input.tender_id).in('id',ds.map((d:any)=>d.id));
      if(error||rows.length!==ds.length||ds.some((d:any)=>!rows.some((r:any)=>r.id===d.id&&r.processing_type===d.class&&r.ai_classification_checked)))throw Error('Worker output verification failed');}
    }else{
     if(!Array.isArray(response.changes))throw Error('Invalid worker receipt');
     for(const change of response.changes){const {data:row,error}=await db.from('agenttender_bid_checklist_items').select('is_archived,completion_status,requirement_kind').eq('company_id',input.company_id).eq('tender_id',input.tender_id).eq('id',change.id).single();
      if(error||(change.action==='YEAR_SPLIT'?!row.is_archived:row.completion_status!=='ACTION_REQUIRED'||row.requirement_kind!=='MANUAL_ACTION'))throw Error('Worker output verification failed');
      if(change.children){const {count,error}=await db.from('agenttender_bid_checklist_items').select('id',{count:'exact',head:true}).eq('company_id',input.company_id).eq('tender_id',input.tender_id).in('id',change.children);if(error||count!==change.children.length)throw Error('Worker child verification failed');}
     }
    }
    result=await invoke({...params,p_phase:'finish',p_action:a.id,p_result:{verified:true,worker:slug,response}});a=result.action;
   }catch(e){
    // A timeout may leave a live worker. Do not dispatch again or claim failure is a rollback.
    return respond({ok:false,status:'EXECUTION_UNCERTAIN',action_id:a.id,answer:'The worker was dispatched, but completion could not be verified. It will not be retried automatically. Use ACTION STATUS '+a.id+' to inspect the recorded state.'},502);
   }
  }
  if(!a)return respond({ok:false,error:'ACTION_RESULT_UNAVAILABLE'},503);
  const isStatus=a.payload.kind==='tender_status';
  const warning=isStatus&&a.payload.target==='GO'?' GO (Will Bid) also starts the automated bid workflow: workspace, checklist and document matching.':'';
  const answer=a.state==='PROPOSED'?(isStatus?`Change tender status from ${label(a.snapshot.status)} to ${label(a.payload.target)}?\nReason: ${a.payload.reason}.${warning}\n\nReply YES to confirm or NO to cancel (valid until ${new Date(a.expires_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})} IST).`:`Proposed ${a.payload.kind}: ${a.snapshot.status||'current workspace'} → ${a.payload.target}${a.payload.item_id?' (item '+a.payload.item_id+')':''}. Reason: ${a.payload.reason}. Reply YES to confirm or NO to cancel.`):
   a.state==='SUCCEEDED'?(isStatus?`Done. Tender status changed to ${label(a.payload.target)}.`:`Verified ${a.payload.kind==='worker'?'worker execution':'status change'}: ${a.payload.target}.`):
   a.state==='CANCELLED'?'Cancelled. Nothing was changed.':
   `Action ${a.id}: ${a.state}. ${a.state==='RUNNING'?'Completion has not yet been verified; no duplicate execution will be started.':''}`;
  return respond({ok:true,status:a.state,action_id:a.id,action:a,answer,replayed:result.replayed||false,changed_business_statuses:a.state==='SUCCEEDED'&&a.payload.kind==='tender_status'&&!result.replayed?1:0});
 }catch{return respond({ok:false,error:'ACTION_SERVICE_UNAVAILABLE',answer:'The action service is unavailable. No success is claimed.'},503);}
}
