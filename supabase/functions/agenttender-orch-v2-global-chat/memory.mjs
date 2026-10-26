
// Server-owned context: request bodies cannot inject recalled history.
export function boundedMemory(rows, question, maxChars=12000) {
 const ordered=[...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
 const recent=ordered.slice(-10);
 const terms=new Set((question.toLowerCase().match(/[a-z]{3,}/g)||[]));
 const older=ordered.slice(0,-10).map(x=>({...x,score:(x.content.toLowerCase().match(/[a-z]{3,}/g)||[]).reduce((n,w)=>n+(terms.has(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
 let remaining=maxChars;
 const clip=(x,max)=>{const content=String(x.content).slice(0,Math.min(max,remaining));remaining-=content.length;return {role:x.role,content,message_id:x.id};};
 const conversation=recent.slice().reverse().map(x=>clip(x,1600)).filter(x=>x.content).reverse();
 const relevant_older=older.map(x=>clip(x,1000)).filter(x=>x.content);
 return {conversation,relevant_older,history_truncated:ordered.length>recent.length+older.length,source:"AUTHORIZED_DATABASE_HISTORY",character_budget:maxChars};
}
export function retrievalQuestion(question, memory) {
 if(question.split(/\s+/).length>14 || /qualify|qualification|\bpq\b|turnover|scope|deadline|experience|checklist/i.test(question) || !/\b(we|our|this|that|it|those|these|exempt)\b/i.test(question))return question;
 const last=[...memory.conversation].reverse().find(x=>x.role==="user");
 return last?question+"\nPrevious user question for context: "+last.content.slice(0,600):question;
}
export async function durableChat(req, process, db, key, cors) {
 if(req.method!=="POST")return process(req);
 const input=await req.clone().json().catch(()=>null);
 if(!input||(input.operation&&input.operation!=='REGENERATE'))return process(req);
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
 let user;
 const token=req.headers.get("x-agenttender-session")?.trim()||"";
 // Prefer the AgentTender session even when an internal service-role bearer is
 // present. This prevents memory identity from depending on request-body user_id.
 const internal=req.headers.get("Authorization")==="Bearer "+key&&!token;
 if(internal)user=String(input.user_id||"");
 else {
  if(!token)return reply({ok:false,error:"AUTHENTICATION_REQUIRED"},401);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
  const {data:s,error}=await db.from("agenttender_user_sessions").select("user_id,expires_at,revoked_at").eq("token_hash",hash).maybeSingle();
  if(error||!s||s.revoked_at||s.expires_at<=new Date().toISOString())return reply({ok:false,error:"AUTHENTICATION_REQUIRED"},401);
  user=s.user_id;
 }
 if(!uuid.test(user||""))return reply({ok:false,error:"AUTHORIZED_USER_REQUIRED"},401);
 const {data:u,error:ue}=await db.from("agenttender_users").select("company_id,is_active,locked_until").eq("id",user).maybeSingle();
 if(ue||!u?.is_active||(u.locked_until&&u.locked_until>new Date().toISOString()))return reply({ok:false,error:"ACCESS_DENIED"},403);
 if(input.company_id&&input.company_id!==u.company_id)return reply({ok:false,error:"COMPANY_ACCESS_DENIED"},403);
 input.company_id=u.company_id;
 if(input.operation==='REGENERATE'){
  const {data:original,error}=await db.from('agenttender_ai_chat_messages').select('id,session_id,tender_id,request_id,role').eq('id',input.message_id).eq('user_id',user).eq('company_id',u.company_id).eq('role','assistant').maybeSingle();
  if(error||!original?.request_id)return reply({ok:false,error:'ORIGINAL_REQUEST_UNAVAILABLE'},404);
  const {data:prior,error:pe}=await db.from('agenttender_ai_chat_messages').select('content,action').eq('request_id',original.request_id).eq('user_id',user).eq('company_id',u.company_id).eq('role','user').maybeSingle();
  if(pe||!prior)return reply({ok:false,error:'ORIGINAL_QUESTION_UNAVAILABLE'},404);
  if(input.request_id===original.request_id)return reply({ok:false,error:'NEW_REQUEST_ID_REQUIRED'},400);
  input.question=prior.content;input.question_category=prior.action;input.session_id=original.session_id;input.tender_id=original.tender_id;input.regenerated_from=original.id;
  delete input.operation;
 }
 if(input.session_id){
  if(!uuid.test(input.session_id))return reply({ok:false,error:"INVALID_SESSION"},400);
  const {data:s,error}=await db.from("agenttender_ai_chat_sessions").select("tender_id").eq("id",input.session_id).eq("user_id",user).eq("company_id",u.company_id).eq("is_archived",false).maybeSingle();
  if(error||!s||input.tender_id&&input.tender_id!==s.tender_id)return reply({ok:false,error:"CONVERSATION_CONTEXT_MISMATCH"},403);
  input.tender_id=s.tender_id;
 }
 if(!uuid.test(input.tender_id||"")||!String(input.question||"").trim()||String(input.question).length>4000)return reply({ok:false,error:"VALID_TENDER_AND_QUESTION_REQUIRED"},400);
 if(input.request_id&&!uuid.test(input.request_id))return reply({ok:false,error:"INVALID_REQUEST_ID"},400);
 const request=input.request_id||crypto.randomUUID();
 const args={p_user:user,p_company:input.company_id,p_tender:input.tender_id,p_request:request};
 const {data:begin,error:be}=await db.rpc("agenttender_chat_exchange_begin",{...args,p_question:input.question.trim(),p_category:input.question_category||"GENERAL_TENDER_INFO",p_session:input.session_id||null});
 if(be)return reply({ok:false,error:/IDEMPOTENCY_CONFLICT/.test(be.message)?"IDEMPOTENCY_CONFLICT":"MEMORY_BEGIN_FAILED"},/IDEMPOTENCY_CONFLICT/.test(be.message)?409:503);
 if(begin.replayed)return begin.response?reply({...begin.response,replayed:true},begin.http_status):reply({ok:false,error:"REQUEST_IN_PROGRESS",request_id:request,session_id:begin.session_id},409);
 input.request_id=request;input.session_id=begin.session_id;
 let response;
 try {
  const {data:rows,error}=await db.from("agenttender_ai_chat_messages").select("id,role,content,created_at").eq("session_id",begin.session_id).eq("company_id",input.company_id).eq("tender_id",input.tender_id).eq("user_id",user).eq("status","complete").or("request_id.is.null,request_id.neq."+request).order("created_at",{ascending:false}).limit(250);
  if(error)throw Error("MEMORY_RECALL_FAILED");
  const memory=boundedMemory(rows||[],input.question,8000);
  const {data:recall,error:re}=await db.rpc('agenttender_chat_recall',{p_user:user,p_company:input.company_id,p_tender:input.tender_id,p_session:begin.session_id,p_query:input.question});
  if(re)throw Error('OLDER_MEMORY_UNAVAILABLE');
  memory.relevant_older=recall?.relevant_older||memory.relevant_older;
  memory.extractive_summary=recall?.extractive_summary||{};
  memory.regenerated_from=input.regenerated_from||null;
  const next=new Request(req.url,{method:"POST",headers:req.headers,body:JSON.stringify(input)});
  response=await process(next,memory);
 }catch (error) { console.error("V2 chat processing exception", { request_id: request, name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) }); response=reply({ok:false,error:"CHAT_PROCESSING_FAILED",request_id:request},500); }
 const body=await response.json().catch(()=>({ok:false,error:"INVALID_CHAT_RESPONSE"}));
 const {data:finished,error:fe}=await db.rpc("agenttender_chat_exchange_finish",{...args,p_response:body,p_http:response.status});
 if(fe)return reply({ok:false,error:"MEMORY_FINISH_FAILED",request_id:request,session_id:begin.session_id},503);
 return reply(finished,response.status);
}

export function exemptionConflict(question,sources){
 if(!/exempt|msme|udyam/i.test(question))return null;
 const records=new Map();
 for(const s of sources){
  const text=String(s.text||"");
  const id=text.match(/UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]+/i)?.[0]?.toUpperCase();
  const activity=text.match(/MAJOR\s+ACTIVITY\s*[:\-]?\s*(SERVICES|TRADING)/i)?.[1]?.toUpperCase();
  if(!id||!activity)continue;
  const row=records.get(id)||{};row[activity]=s.ref;records.set(id,row);
 }
 for(const [id,r] of records)if(r.SERVICES&&r.TRADING)return "RESULT: UNVERIFIED\n\nEMD exemption cannot yet be confirmed. Retrieved copies of Udyam registration "+id+" show conflicting major activities: SERVICES ["+r.SERVICES+"] and TRADING ["+r.TRADING+"]. Verify which certificate is current and valid, then apply the tender's exemption clause. Do not select a favorable copy without resolving the discrepancy.\n\nSuggested follow-ups: Which certificate is current? What is the exact exemption clause? Which supporting documents are required?";
 return null;
}

