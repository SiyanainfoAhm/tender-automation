export async function feedbackOperation(req:Request,input:any,db:any,key:string,cors:any){
 if(!['SUBMIT_FEEDBACK','FEEDBACK_STATUS','HISTORY','MEMORY_STATUS'].includes(input.operation))return null;
 const reply=(x:any,status=200)=>Response.json(x,{status,headers:cors});
 try{
  const company=String(input.company_id||''),tender=String(input.tender_id||'');
  let userId='';
  const token=req.headers.get('x-agenttender-session')?.trim()||'';
  const internal=req.headers.get('Authorization')==='Bearer '+key&&!token;
  if(internal)userId=String(input.user_id||'');
  else{
   if(!token)return reply({ok:false,error:'Authentication required'},401);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
   const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
   const {data:s,error}=await db.from('agenttender_user_sessions').select('user_id,expires_at,revoked_at').eq('token_hash',hash).maybeSingle();
   if(error||!s||s.revoked_at||s.expires_at<=new Date().toISOString())return reply({ok:false,error:'Authentication required'},401);
   userId=s.user_id;
  }
  const {data:u,error:ue}=await db.from('agenttender_users').select('company_id,is_active,role').eq('id',userId).maybeSingle();
  if(ue||!u?.is_active||u.company_id!==company)return reply({ok:false,error:'Access denied'},403);
  const {data:membership,error:me}=await db.from('agenttender_company_memberships').select('id').eq('user_id',userId).eq('company_id',company).eq('status','active').maybeSingle();
  if(me||!membership)return reply({ok:false,error:'Access denied'},403);
  if(input.operation==='MEMORY_STATUS'){
   if(u.role!=='ADMIN')return reply({ok:false,error:'Admin access required'},403);
   const {data,error}=await db.rpc('agenttender_chat_memory_health');if(error)throw error;
   return reply({ok:true,memory:data});
  }
  if(input.operation==='HISTORY'){
   const {data,error}=await db.from('agenttender_ai_chat_messages').select('id,session_id,role,content,action,sources,model,created_at')
    .eq('company_id',company).eq('tender_id',tender).eq('user_id',userId).order('created_at',{ascending:false}).limit(100);
   if(error)throw error;return reply({ok:true,messages:(data||[]).reverse()});
  }
  if(input.operation==='FEEDBACK_STATUS'){
   const {data,error}=await db.from('agenttender_chat_corrections').select('id,message_id,feedback_type,verification_status,created_at,verified_at,processed_at,knowledge_id,rule_proposal_id')
    .eq('company_id',company).eq('tender_id',tender).eq('user_id',userId).eq('id',input.feedback_id).maybeSingle();
   if(error||!data)return reply({ok:false,error:'Feedback unavailable'},404);
   return reply({ok:true,feedback:data});
  }
  const {data,error}=await db.rpc('agenttender_submit_chat_correction',{
   p_user:userId,p_company:company,p_tender:tender,p_message:input.message_id,p_request:input.request_id,
   p_kind:({THUMBS_UP:'HELPFUL',THUMBS_DOWN:'UNHELPFUL',CORRECT:'HELPFUL',EDIT:'CORRECTION',EXPLAIN_WHAT_IS_WRONG:'UNHELPFUL',SUBMIT_CORRECTED_ANSWER:'CORRECTION'} as any)[input.feedback_type]||input.feedback_type,p_correction:input.corrected_answer||null,p_reason:input.correction_reason||null,
   p_evidence:Array.isArray(input.evidence_references)?input.evidence_references:[],
  });
  if(error)return reply({ok:false,error:'Feedback could not be submitted. Check the message, request ID and correction.'},400);
  return reply({ok:true,feedback:data,rules_changed:0,tender_decisions_changed:0});
 }catch{return reply({ok:false,error:'Feedback service unavailable'},503);}
}

export function categoryFor(q:string,requested:any){
 const categories=['GENERAL_TENDER_INFO','ELIGIBILITY','EMD','TURNOVER','EXPERIENCE','GOVERNMENT_EXPERIENCE','CERTIFICATIONS','REQUIRED_DOCUMENTS','DO_WE_QUALIFY','CHECKLIST_STATUS','TENDER_STATUS','WORKFLOW_TROUBLESHOOTING','KNOWLEDGE_BASE','GENERAL_CONVERSATION','SCOPE_OF_WORK','PROJECT_COST','SUBMISSION_READINESS'];
 if(categories.includes(requested))return requested;
 if(/\b(scope of work|deliverables|what (?:do we|must we) (?:build|deliver))\b/i.test(q))return 'SCOPE_OF_WORK';
 if(/\b(submission|how to submit|ready to bid)\b/i.test(q))return 'SUBMISSION_READINESS';
 if(/\b(profit|margin|delivery cost|project cost|bid price)\b/i.test(q))return 'PROJECT_COST';
 if(/qualify|we eligible|meet.*criteria/i.test(q))return 'DO_WE_QUALIFY';
 if(/government.*experience|govt.*experience/i.test(q))return 'GOVERNMENT_EXPERIENCE';
 if(/emd|exempt|msme/i.test(q))return 'EMD';
 if(/turnover/i.test(q))return 'TURNOVER';
 if(/experience/i.test(q))return 'EXPERIENCE';
 if(/certif|iso\b/i.test(q))return 'CERTIFICATIONS';
 if(/checklist/i.test(q))return 'CHECKLIST_STATUS';
 if(/eligib|\bpq\b/i.test(q))return 'ELIGIBILITY';
 return 'GENERAL_TENDER_INFO';
}
