import {financialDocumentAnswer,requestedFinancialYears} from './company-periods.mjs';
import {durableChat,retrievalQuestion,exemptionConflict} from './memory.mjs';
import {presentAnswer} from './presentation.mjs';
import {feedbackOperation,categoryFor} from './feedback.ts';
import {casualAnswer} from "./greetings.mjs";
import {responseMode,retrieve,analystPrompt,parseAnswer,questionCategoryInstructions} from "./analyst.ts";
import {handleAction} from "./action-handler.ts";
import {activeRules} from "./policy.mjs";
import {assessQualification,qualificationQuestion,companyFinancialAnswer} from './qualification.mjs';
import {loadOfficialEvaluation,noGoAnswer,evaluationContext,chatQualificationAnswer,focusedCheckAnswer,OFFICIAL_EVALUATION_INSTRUCTION} from './official-evaluation.mjs';
import {getCompanyCheck,companyCheckContext,COMPANY_CHECK_INSTRUCTION} from './company-check.mjs';
// Edge runtime globals are supplied by Supabase; no runtime type-only registry import.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const URL = Deno.env.get("SUPABASE_URL") || "";
const AIKEY = Deno.env.get("DEEPSEEK_API_KEY") || Deno.env.get("DEEPSEEK_KEY") || Deno.env.get("DEEPSEEK") || "";
const MODEL = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-agenttender-session",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function words(text: string) {
  return [...new Set((text.toLowerCase().match(/[a-z]{3,}|[0-9]+/g) || []))].slice(0, 40);
}

function rankEvidence(items: any[], question: string, max: number, fallbackTerms: string[] = []) {
  const terms = [...new Set([...words(question), ...fallbackTerms])].slice(0, 60);
  return (items || [])
    .map((x: any) => {
      const text = String(x?.content || x?.text || "").trim();
      const hay = text.toLowerCase();
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      return { ...x, __text: text, __score: score };
    })
    .filter((x: any) => x.__text.length > 20)
    .sort((a: any, b: any) => b.__score - a.__score || b.__text.length - a.__text.length)
    .slice(0, max);
}

function displayDocumentName(value:any) { let name=String(value||"Source document").replace(/[\r\n]/g," ").trim().split(/[\/\\]/).filter(Boolean).at(-1)||"Source document"; name=name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_ ]*/i,"").replace(/^[0-9a-f]{24,}[-_ ]*/i,"").trim(); return name||"Source document";}

function slim(items: any[], prefix: string, type: string):any[] {
  return items.map((x: any, i: number) => ({
    ref: `${prefix}${i + 1}`,
    chunk_id: x.id || x.chunk_id || null,
    source_type: type,
    document_url:x.document_url||null,
    source_id:x.source_id||x.document_id||null,
    document: displayDocumentName(x.document_name || x.source_title || x.file_name || type),
    metadata: x.metadata || null,
    page: x.page_number ?? null,
    section: x.section ?? null,
    text: String(x.__text || x.content || x.text || "").slice(0, 2600),
  }));
}

function cleanConversation(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item: any) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: String(item?.content || item?.text || "").slice(0, 2000),
  })).filter((x: any) => x.content.trim().length > 0);
}

async function processChatRequest(req: Request, memory:any=null): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405, headers: cors });
  if (!KEY || !URL) return Response.json({ error: "Service unavailable" }, { status: 503, headers: cors });

  const db = createClient(URL, KEY, { auth: { persistSession: false } });
  const input = await req.json().catch(() => ({}));

  const feedback=await feedbackOperation(req,input,db,KEY,cors);if(feedback)return feedback;
  let authenticatedUserId:string|null=null;
  const tenderId = String(input.tender_id || "");
  const companyId = String(input.company_id || "");
  const question = String(input.question || "").trim();
  const conversation = memory?.conversation || [];
  const searchQuestion = retrievalQuestion(question,memory||{conversation:[]});
  const question_category=categoryFor(question,input.question_category);
  const requestedMode=input.response_mode==='SHORT'?'QUICK':input.response_mode==='DETAILED'?(question_category==='DO_WE_QUALIFY'?'ELIGIBILITY':'ANALYSIS'):input.response_mode;
  const inferredMode=question_category==='SUBMISSION_READINESS'?'BID_REVIEW':question_category==='DO_WE_QUALIFY'?'ELIGIBILITY':'ANALYSIS';
  const response_mode=responseMode(requestedMode||inferredMode);

  if (!uuid.test(tenderId) || !uuid.test(companyId) || !question || question.length > 4000) {
    return Response.json({ ok: false, error: "Valid tender_id, company_id and question required" }, { status: 400, headers: cors });
  }



  const token = req.headers.get("x-agenttender-session")?.trim() || "";
  // A forwarded AgentTender session always wins over an internal service-role
  // header, so V2 resolves the principal from agenttender_user_sessions.
  const internal = req.headers.get("Authorization") === `Bearer ${KEY}` && !token;
  if(internal && uuid.test(String(input.user_id||''))){
    const {data:u,error}=await db.from('agenttender_users').select('id,company_id,is_active,locked_until,must_change_password').eq('id',input.user_id).maybeSingle();
    if(error||!u?.is_active||u.company_id!==companyId||u.must_change_password||(u.locked_until&&Date.parse(u.locked_until)>Date.now()))return Response.json({error:'Company access denied'},{status:403,headers:cors});
    authenticatedUserId=u.id;
  }
  if (!internal) {
    if (!token) return Response.json({ error: "Authentication required" }, { status: 401, headers: cors });

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hashed = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
    const { data: session, error: sessionError } = await db.from("agenttender_user_sessions")
      .select("user_id,expires_at,revoked_at").eq("token_hash", hashed).maybeSingle();
    if (sessionError || !session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at)<=Date.now()) {
      return Response.json({ error: "Invalid session" }, { status: 401, headers: cors });
    }

    const { data: user, error: userError } = await db.from("agenttender_users")
      .select("company_id,is_active,locked_until,must_change_password").eq("id", session.user_id).maybeSingle();
    if (userError || !user?.is_active || !user.company_id || user.must_change_password || (user.locked_until&&Date.parse(user.locked_until)>Date.now())) {
      return Response.json({ error: "Inactive user" }, { status: 401, headers: cors });
    }
    authenticatedUserId=session.user_id;
    if (String(user.company_id) !== companyId) {
      return Response.json({ error: "Company access denied" }, { status: 403, headers: cors });
    }
  }

  let canReadCompanyDocuments=internal;
  if(authenticatedUserId){const {data:membership,error}=await db.from('agenttender_company_memberships').select('id,role').eq('user_id',authenticatedUserId).eq('company_id',companyId).eq('status','active').maybeSingle();if(error||!membership)return Response.json({error:'Company access denied'},{status:403,headers:cors});const grants=await db.from('agenttender_role_permissions').select('agenttender_permissions!inner(key)').eq('role',membership.role);if(grants.error)return Response.json({error:'Permissions unavailable'},{status:503,headers:cors});const permissions=new Set((grants.data||[]).map((g:any)=>g.agenttender_permissions.key));if(!permissions.has('tenders.view'))return Response.json({error:'Tender access denied'},{status:403,headers:cors});canReadCompanyDocuments=permissions.has('documents.view');}
  const greeting=casualAnswer(question);
  if(greeting){let saved:any=null;if(authenticatedUserId && !memory){const r=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:greeting,p_model:'deterministic-greeting',p_category:'GENERAL_CONVERSATION',p_sources:[]});if(!r.error)saved=r.data;}return Response.json({message_id:saved?.message_id||null,session_id:saved?.session_id||null,ok:true,status:"ANSWERED",route:"ORCHESTRATOR_V2_LIGHT_CHAT",answer:greeting,evidence:[],company_evidence:[],orchestration_steps_run:0,extraction_triggered:false,indexing_triggered:false,embedding_triggered:false,ocr_triggered:false,changed_business_statuses:0},{headers:cors});}

  // Internal: the V2 decision worker asks for the same company check in this isolate.
  if(internal&&input.action==='company_check'){
   const {data:ct,error:cte}=await db.from('agenttender_tenders').select('id,source_tender_id,title,closing_date,emd_amount,status,qualification_status').eq('id',tenderId).maybeSingle();
   if(cte||!ct)return Response.json({ok:false,error:'Tender not found'},{status:404,headers:cors});
   const c=await getCompanyCheck({db,tender:ct,companyId,allowCompany:true,aiKey:AIKEY,signal:undefined,refresh:input.refresh===true});
   return Response.json({ok:true,...c},{headers:cors});
  }
  const actionResponse=await handleAction(req,input,db,URL,KEY,cors);
  if(actionResponse)return actionResponse;

  const [{ data: tender, error: tenderError }, { data: ownedDocs, error: ownedError }, { data: ownedChunks, error: chunkError }] = await Promise.all([
    db.from("agenttender_tenders")
      .select("id,source_tender_id,title,description,organization,department,authority,emd_amount,tender_value,closing_date,status,qualification_status,prescreen_status,prescreen_reason")
      .eq("id", tenderId).maybeSingle(),
    db.from("agenttender_tender_documents").select("id").eq("tender_id", tenderId).eq("company_id", companyId).limit(1),
    db.from("agenttender_ai_document_chunks").select("id").eq("tender_id", tenderId).eq("company_id", companyId).limit(1),
  ]);

  if (tenderError || !tender) return Response.json({ ok: false, error: "Tender not found" }, { status: 404, headers: cors });
  // Tender records are shared under tenders.view. Missing company-scoped RFPs
  // must produce an explicitly limited report rather than blocking that report.
  // Document retrieval below still applies company_id on every original source.
  if (ownedError || chunkError) {
    return Response.json({ ok: false, error: "Tender not available for company" }, { status: 403, headers: cors });
  }

  // The chatbot speaks from the evaluation TenderFlow already made (V2 orchestrator +
  // recorded status), so its answers match the GO / NO_GO / CONDITIONAL_GO users see.
  let official:any=null;
  try{official=await loadOfficialEvaluation(db,tender);}catch(e){console.warn('Official evaluation unavailable',String(e));}
  const QUICK_CATEGORIES=['SCOPE_OF_WORK','GENERAL_TENDER_INFO','EMD','DO_WE_QUALIFY','ELIGIBILITY','REQUIRED_DOCUMENTS','TURNOVER','EXPERIENCE','GOVERNMENT_EXPERIENCE','CERTIFICATIONS','PROJECT_COST','SUBMISSION_READINESS','TENDER_STATUS'];
  if(official?.available&&official.family==='NO_GO'&&(QUICK_CATEGORIES.includes(question_category)||qualificationQuestion(question))){
   const answer=noGoAnswer(official,tender,question_category);
   const response:any={ok:true,status:'ANSWERED',route:'ORCHESTRATOR_V2_OFFICIAL_DECISION',question_category,answer,result:'NOT CONFIRMED',evidence_state:'HIGH',official_decision:official.decision,evidence:[],company_evidence:[],sources:[],readiness_warnings:[],partial_document_evidence:false,model:'official-evaluation',changed_business_statuses:0,orchestration_steps_run:0,extraction_triggered:false,indexing_triggered:false,embedding_triggered:false,ocr_triggered:false};
   if(authenticatedUserId&&!memory&&!(internal&&input.read_only===true)){
    const saved=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:answer,p_model:'official-evaluation',p_category:question_category,p_sources:[]});
    if(saved.error)throw saved.error;
    return Response.json({...response,message_id:saved.data?.message_id,session_id:saved.data?.session_id},{headers:cors});
   }
   return Response.json(response,{headers:cors});
  }

  const directFinancial=['TURNOVER','DO_WE_QUALIFY','ELIGIBILITY'].includes(question_category)?null:await companyFinancialAnswer(db,companyId,question,canReadCompanyDocuments);
  if(directFinancial){
   const response={ok:true,answer:directFinancial.answer,calculation:directFinancial.calculation,company_evidence:directFinancial.documents,changed_business_statuses:0};
   if(authenticatedUserId&&!memory&&!(internal&&input.read_only===true)){
    const saved=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:response.answer,p_model:'deterministic-company-credentials',p_category:'FINANCIAL',p_sources:directFinancial.documents});if(saved.error)throw saved.error;
    return Response.json({...response,...saved.data},{headers:cors});
   }
   return Response.json(response,{headers:cors});
  }
  // One cached requirement check (RFP vs verified company documents) feeds every answer.
  let check:any=null;
  try{check=await getCompanyCheck({db,tender,companyId,allowCompany:canReadCompanyDocuments,aiKey:AIKEY,signal:undefined});}catch(e){console.warn('Company check unavailable',String(e));}
  const focused=check?.report&&['TURNOVER','EXPERIENCE','GOVERNMENT_EXPERIENCE','CERTIFICATIONS'].includes(question_category)?focusedCheckAnswer(check.report,official,question_category):null;
  if(focused){
   const response:any={ok:true,status:'ANSWERED',route:'ORCHESTRATOR_V2_COMPANY_CHECK',question_category,answer:focused,result:'CHECKED',evidence_state:'MEDIUM',official_decision:official?.decision||null,evidence:[],company_evidence:[],sources:(check.sources||[]).filter((s:any)=>String(s.ref||'').startsWith('C')).slice(0,12).map((s:any)=>({id:s.ref,documentName:s.document,pageNumber:s.page,section:s.section})),readiness_warnings:[],partial_document_evidence:false,model:'company-check',changed_business_statuses:0,extraction_triggered:false,indexing_triggered:false,embedding_triggered:false};
   if(authenticatedUserId&&!memory&&!(internal&&input.read_only===true)){
    const saved=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:focused,p_model:'company-check',p_category:question_category,p_sources:response.sources});
    if(saved.error)throw saved.error;
    return Response.json({...response,message_id:saved.data?.message_id,session_id:saved.data?.session_id},{headers:cors});
   }
   return Response.json(response,{headers:cors});
  }
  if((question_category==='DO_WE_QUALIFY'||question_category==='ELIGIBILITY'||qualificationQuestion(question))&&check?.report){
   const evaluated:any={report:check.report,sources:(check.sources||[]).map((s:any)=>({...s,text:''}))};
   const result=evaluated.report.recommendation==='GO'?'CONFIRMED':evaluated.report.recommendation==='NO_GO'?'NOT CONFIRMED':'UNVERIFIED';
   evaluated.answer=chatQualificationAnswer(evaluated.report,official);
   const response={ok:true,status:'ANSWERED',route:'ORCHESTRATOR_V2_LIGHT_CHAT',official_decision:official?.decision||null,answer:evaluated.answer,qualification:evaluated.report,result,evidence_state:evaluated.report.coverage.complete?'MEDIUM':'LOW',sources:evaluated.sources.map((s:any)=>({id:s.ref,documentName:s.document,pageNumber:s.page,section:s.section})),changed_business_statuses:0,extraction_triggered:false,indexing_triggered:false,embedding_triggered:false};
   const sourceCards=evaluated.sources.map(({text,metadata,...s}:any)=>s);
   Object.assign(response,{evidence:sourceCards.filter((s:any)=>s.ref.startsWith('R')),company_evidence:sourceCards.filter((s:any)=>s.ref.startsWith('C')),model:MODEL,readiness_warnings:official?.available?[]:evaluated.report.coverage.warnings});
   if(authenticatedUserId&&!memory&&!(internal&&input.read_only===true)){
    const saved=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:response.answer,p_model:MODEL,p_category:'DO_WE_QUALIFY',p_sources:response.sources});
    if(saved.error)throw saved.error;
    return Response.json({...response,message_id:saved.data?.message_id,session_id:saved.data?.session_id},{headers:cors});
   }
   return Response.json(response,{headers:cors});
  }

  // Prior screening outcomes are not evidence for a fresh analyst decision.
  // Keep them available for explicit status questions only.
  const analystTender:any={...tender};
  if(!["TENDER_STATUS","WORKFLOW_TROUBLESHOOTING"].includes(question_category)){
    delete analystTender.prescreen_reason;
    delete analystTender.prescreen_status;
    delete analystTender.qualification_status;
  }
  let ctx: any = {};
  try {
    const { data, error } = await db.rpc("agenttender_orch_v2_adjudication_context", { p_tender_id: tenderId });
    if (error) throw error;
    ctx = data || {};
  } catch (e) {
    console.warn("V2 context unavailable", String(e));
  }

  // Diagnostics run only after authentication/ownership, and never for greetings.
  const chunksQuery = () => db.from("agenttender_ai_document_chunks").select("id",{count:"exact",head:true}).eq("company_id",companyId).eq("tender_id",tenderId).eq("source_type","TENDER_DOCUMENT").eq("is_active",true);
  const [chunkState,embeddedState,indexState]=await Promise.all([
    chunksQuery(),chunksQuery().not("embedding_local","is",null),
    db.from("agenttender_ai_document_index_status").select("status,chunk_count").eq("company_id",companyId).eq("tender_id",tenderId).eq("source_type","TENDER_DOCUMENT").limit(201),
  ]);
  const readinessWarnings:string[]=[];
  if(chunkState.error||embeddedState.error||indexState.error)readinessWarnings.push("Document indexing readiness could not be verified. Verify the source document or use Retry Indexing.");
  if(chunkState.count===0)readinessWarnings.push("No active extracted RFP chunks are available. Upload the missing RFP or use Retry Indexing for stored documents.");
  if(typeof chunkState.count==="number"&&typeof embeddedState.count==="number"&&embeddedState.count<chunkState.count)readinessWarnings.push(`${chunkState.count-embeddedState.count} of ${chunkState.count} active RFP chunks lack local semantic embeddings. Lexical retrieval may still work; use Retry Indexing to repair the index.`);
  const pending=(indexState.data||[]).filter((x:any)=>x.status!=="INDEXED"||!x.chunk_count);
  if(pending.length)readinessWarnings.push(`${pending.length} inspected document index entries are incomplete or failed. Use Retry Indexing; verify/upload the source RFP if extraction fails.`);
  if((indexState.data||[]).length>200)readinessWarnings.push("Document indexing diagnostics are limited to 201 entries; full readiness remains unverified.");

  // Missing semantic vectors alone do not mean the RFP is missing: lexical evidence remains usable.
  const userReadinessWarnings = readinessWarnings.filter(w => !w.includes("lack local semantic embeddings"));
  const retrievalMode=['SCOPE_OF_WORK','SUBMISSION_READINESS','GENERAL_TENDER_INFO','ELIGIBILITY','EMD','TURNOVER','EXPERIENCE','GOVERNMENT_EXPERIENCE','CERTIFICATIONS','REQUIRED_DOCUMENTS','DO_WE_QUALIFY','PROJECT_COST'].includes(question_category)?'ELIGIBILITY':response_mode;
  const retrieved = await retrieve(db,tenderId,companyId,searchQuestion,retrievalMode,question_category,canReadCompanyDocuments);
  const tenderEvidence = slim(retrieved.tender,"R","TENDER_DOCUMENT");
  tenderEvidence.push({ref:`R${tenderEvidence.length+1}`,source_type:"TENDER_METADATA",document:"Current tender metadata (not RFP)",page:null,section:null,text:JSON.stringify(analystTender)});
  if(response_mode==="BID_REVIEW"||["SUBMISSION_READINESS","REQUIRED_DOCUMENTS"].includes(question_category)){
    const {data:items,error} = await db.from("agenttender_bid_checklist_items")
      .select("requirement_name,mandatory,description,completion_status,processing_type,evidence_review_status,matched_document_source,matched_company_document_id,matched_workspace_document_id,required_action")
      .eq("company_id",companyId).eq("tender_id",tenderId).eq("is_archived",false).limit(200);
    if(!error&&items?.length){
      const counts:any={};for(const x of items)counts[x.completion_status]=(counts[x.completion_status]||0)+1;
      tenderEvidence.push({ref:`R${tenderEvidence.length+1}`,source_type:"CHECKLIST_STATE",document:"Live checklist statuses (not attachment/content verification)",page:null,section:null,
        text:JSON.stringify({counts,read_limit:200,items:items.slice(0,60),limitation:"Recorded completion statuses only. Attachments, signatures and substantive compliance were not verified. List may be partial."})});
    }
  }
  const companyEvidence = slim(retrieved.company,"C","COMPANY_DOCUMENT");
  const useHistory = retrieved.companyNeeded && /experience|similar|eligib|previous|histor|project/i.test(question);
  const historicalEvidence = slim(useHistory ? rankEvidence(ctx?.submitted_bid_chunks||[],question,6) : [],"H","SUBMITTED_BID_DOCUMENT");
  const positiveEvidence = slim(useHistory ? rankEvidence(ctx?.historical_positive_rfp_chunks||[],question,6) : [],"P","HISTORICAL_POSITIVE_RFP");

  const {data:learning,error:learningError}=await db.rpc("agenttender_learning_context",{p_company_id:companyId,p_tender_id:tenderId});
  if(learningError)return Response.json({ok:false,error:"VERIFIED_LEARNING_UNAVAILABLE"},{status:503,headers:cors});
  const corrections=(learning?.eligibility_intelligence||[]).filter((k:any)=>k.source_table==='agenttender_chat_corrections');
  const relevant=corrections.filter((k:any)=>words(question).some(w=>String(k.content?.original_question||'').toLowerCase().includes(w))).slice(0,6);
  const learnedIds=[...new Set(relevant.flatMap((k:any)=>(k.evidence?.source_chunks||[]).filter((c:any)=>c.source_type==='TENDER_DOCUMENT').map((c:any)=>c.chunk_id)))];
  if(learnedIds.length){
   const {data:originals,error}=await db.from('agenttender_ai_document_chunks').select('id,content,document_name,page_number,section').in('id',learnedIds).eq('company_id',companyId).eq('tender_id',tenderId).eq('source_type','TENDER_DOCUMENT').eq('is_active',true);
   if(error)return Response.json({ok:false,error:'LEARNING_SOURCE_UNAVAILABLE'},{status:503,headers:cors});
   for(const c of originals||[])if(!tenderEvidence.some((x:any)=>x.chunk_id===c.id))tenderEvidence.push({...slim([c],'R','TENDER_DOCUMENT')[0],ref:'R'+(tenderEvidence.length+1)});
  }
  const learnedCompanyIds=[...new Set(relevant.flatMap((k:any)=>(k.evidence?.source_chunks||[]).filter((c:any)=>c.source_type==='COMPANY_DOCUMENT').map((c:any)=>c.chunk_id)))];
  if(learnedCompanyIds.length&&canReadCompanyDocuments){
   const {data:originals,error}=await db.from('agenttender_ai_document_chunks').select('id,content,document_name,page_number,section').in('id',learnedCompanyIds.filter(id=>retrieved.company.some((c:any)=>c.id===id))).eq('company_id',companyId).eq('source_type','COMPANY_DOCUMENT').eq('is_active',true);
   if(error)return Response.json({ok:false,error:'LEARNING_SOURCE_UNAVAILABLE'},{status:503,headers:cors});
   for(const c of originals||[])if(!companyEvidence.some((x:any)=>x.chunk_id===c.id))companyEvidence.push({...slim([c],'C','COMPANY_DOCUMENT')[0],ref:'C'+(companyEvidence.length+1)});
  }
  const ownerRules = await activeRules(db);
  const wonProjects = Array.isArray(ctx?.won_projects) ? ctx.won_projects.slice(0, 12) : [];
  const companyPreferences = ctx?.company_preferences || null;

  if (!AIKEY) return Response.json({ ok: false, error: "DEEPSEEK_NOT_CONFIGURED" }, { status: 503, headers: cors });

  const evidenceAvailable = retrieved.tender.length > 0;
  const adaptiveCategory = question_category;
  const {data:answerConfig,error:answerConfigError} = await db.from("agenttender_chat_ui_config").select("config").eq("config_key","tender_v2").eq("is_active",true).maybeSingle();
  if(answerConfigError) console.error("Adaptive chat config read failed");
  const adaptivePolicy=answerConfig?.config?.adaptive_answer_policy;
  const adaptiveInstructions = adaptivePolicy ? "\nStyle: concise natural paragraphs; tables only for useful comparisons. Category decision guidance governs content. End with exactly three relevant next questions. Never add generic task lists." : "";
  const system = (check?.report?COMPANY_CHECK_INSTRUCTION+"\n":"")+(official?.available&&!official.pending?OFFICIAL_EVALUATION_INSTRUCTION+"\n":official?.pending?"\nThe daily automatic evaluation for this tender has not finished yet (documents still being collected). Decide from the RFP evidence, start with \"Decision: GO / NO-GO / CONDITIONAL GO / VERIFY\", and if a mandatory eligibility condition clearly excludes Siyana, say NO-GO. Never show internal error codes.\n":"")+analystPrompt(response_mode)+"\nVerified corrections are tender-scoped interpretations, never original evidence. Current RFP wins. The following category guidance controls the business decision and visible format; JSON result remains an evidence-sufficiency label for compatibility. Question category: "+adaptiveCategory+"\n"+questionCategoryInstructions(adaptiveCategory)+adaptiveInstructions;

  const payload = {
    question,
    question_category,
    // Only the trusted application server can supply already authorized guidance.
    user_corrections: internal && Array.isArray(input.user_corrections) ? input.user_corrections.slice(0,5) : [],
    response_mode,
    retrieval_warnings: retrieved.warnings,
    document_readiness_warnings: official?.available?[]:userReadinessWarnings,
    conversation,
    relevant_older_conversation:memory?.relevant_older||[],
    conversation_history_truncated:memory?.history_truncated||false,
    conversation_summary_untrusted:memory?.extractive_summary||{},
    current_tender: analystTender,
    current_time_utc:new Date().toISOString(),
    current_time_india:new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",hour12:false}),
    deadline_evaluation:{
      recorded_closing_date:tender.closing_date,
      date_only:/^\d{4}-\d{2}-\d{2}$/.test(String(tender.closing_date||"")),
      guidance:"A date-only field does not establish a closing time. On the closing date, do not declare expired without a verified time and timezone. Compare RFP times in their declared timezone; flag conflicting deadline evidence. Never infer no submitted bid from absence of supplied submission evidence."
    },
    official_evaluation: official?.available&&!official.pending?evaluationContext(official):null,
    company_check: companyCheckContext(check?.report,official),
    recorded_decisions_are_not_evidence: !official?.available,
    tender_evidence: tenderEvidence,
    company_evidence: companyEvidence,
    requested_financial_years:requestedFinancialYears(question),
    submitted_bid_evidence: historicalEvidence,
    historical_positive_rfp_evidence: positiveEvidence,
    owner_rules: ownerRules,
    verified_continuous_learning: {version:learning?.version,status:learning?.status,policy:learning?.policy,note:"Learning assertions are policy context only; original source evidence must be retrieved to prove facts."},
    verified_decision_knowledge: relevant,
    company_preferences: companyPreferences,
    won_projects: [],
    evidence_note: evidenceAvailable
      ? "Current extracted tender text is available."
      : "No current extracted tender chunks were available; answer only from tender metadata and clearly state the limitation.",
  };

  // Keep the transport contract explicit after the adaptive answer policy.
  // Retry one malformed response with the same authorized evidence; never
  // display a malformed model fragment or relax citation validation.
  const refs = new Set([...tenderEvidence,...companyEvidence,...historicalEvidence,...positiveEvidence].map(x=>x.ref));
  let aiJson:any = {};
  let rawAnswer = "";
  let parsed = parseAnswer("", refs);
  for (let attempt = 0; attempt < 2; attempt++) {
    const checkDecision = companyCheckContext(check?.report,official)?.decision;
    const officialCheck = official?.available&&!official.pending ? '\nOFFICIAL DECISION CHECK: The first line must be "Decision: '+official.label+'". Any recommendation, fit or verdict you state must equal '+official.label+'; explain the official reason instead of re-deciding.' : checkDecision ? '\nDECISION CHECK: The first line must be "Decision: '+checkDecision+'" (from company_check). Explain it with the company_check rows; do not re-decide.' : '';
    const formatInstruction = officialCheck + '\nFINAL DECISION CHECK: Use only facts proven by the supplied original evidence. A listed EMD is not the actual payable EMD. If exemption applicability is conflicting or unverified, summarize it as payable EMD NOT VERIFIED and do not use the listed amount to assert a binding EMD exclusion. A poor-fit recommendation may instead rely on proven scope exclusions, explaining the scope reason. Missing company evidence is not a proven failure. Keep scope and summary to about 180 words before the three follow-up questions; EMD to about 100 words before follow-ups. Avoid unrelated policy commentary in narrow checks.\nOUTPUT CONTRACT: Return exactly one valid JSON object with "answer" (non-empty string), "result" (CONFIRMED, PARTIALLY CONFIRMED, NOT CONFIRMED, UNVERIFIED, or null), and "evidence_state" (HIGH, MEDIUM, or LOW). Put all prose, citations and suggested questions inside the answer string. Escape newlines inside JSON strings. Do not output Markdown fences or any text outside the JSON object.';
    const aiRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${AIKEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 2400,
        response_format: {type:"json_object"},
        messages: [
          { role: "system", content: system + formatInstruction + (attempt ? '\nA prior completion failed JSON validation. Generate a fresh answer strictly following this JSON contract.' : '') },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(attempt ? 30000 : 50000),
    });
    aiJson = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) return Response.json({ ok: false, error: `DEEPSEEK_HTTP_${aiRes.status}` }, { status: 502, headers: cors });
    rawAnswer = String(aiJson.choices?.[0]?.message?.content || "").trim();
    parsed = parseAnswer(rawAnswer, refs);
    if (parsed.structured) break;
  }
  if(!parsed.structured)return Response.json({ok:false,error:'MODEL_RESPONSE_FORMAT_INVALID',model:aiJson.model||MODEL,response_trace:{raw_model_output:rawAnswer,usage:aiJson.usage||null}},{status:502,headers:cors});
  const financialAnswer=financialDocumentAnswer(question,retrieved.company.map((d:any,i:number)=>({...d,ref:"C"+(i+1)})));
  if(financialAnswer){parsed.answer=financialAnswer;parsed.result='UNVERIFIED';parsed.evidence_state='MEDIUM';}
  const conflictAnswer=exemptionConflict(question,companyEvidence);
  if(conflictAnswer){parsed.answer=conflictAnswer;parsed.result='UNVERIFIED';parsed.evidence_state='LOW';}
  const {result,evidence_state} = parsed;
  const {answer,response_trace}=presentAnswer(parsed,[...tenderEvidence,...companyEvidence,...historicalEvidence,...positiveEvidence],{model:aiJson.model||MODEL,response_mode,question_category,retrieval:{strategy:retrieved.semantic?'LOCAL_SEMANTIC_FTS_RRF':'FTS_RRF',warnings:retrieved.warnings},readiness_warnings:userReadinessWarnings});
  response_trace.raw_model_output=rawAnswer;
  response_trace.usage=aiJson.usage||null;
  if (!answer) return Response.json({ ok: false, error: "EMPTY_AI_RESPONSE" }, { status: 502, headers: cors });

  let saved:any=null;
  if(authenticatedUserId && !memory){
   const {data,error}=await db.rpc('agenttender_record_v2_chat_answer',{p_user:authenticatedUserId,p_company:companyId,p_tender:tenderId,p_session:input.session_id||null,p_question:question,p_answer:answer,p_model:aiJson.model||MODEL,p_category:question_category,p_sources:[...tenderEvidence,...companyEvidence,...historicalEvidence,...positiveEvidence].map((x:any)=>({id:x.ref,fileName:x.document,pageCount:null,sourceType:x.source_type,sourceId:x.chunk_id,documentName:x.document,pageNumber:x.page,section:x.section,tenderId,companyId}))});
   if(error)return Response.json({ok:false,error:'ANSWER_HISTORY_SAVE_FAILED'},{status:503,headers:cors});
   saved=data;
  }
  return Response.json({
    ok: true,
    message_id:saved?.message_id||null,
    session_id:saved?.session_id||null,
    question_category,
    learning:{knowledge_ids:relevant.map((k:any)=>k.id),scope:'TENDER_ONLY',policy_changes:0},
    route: "ORCHESTRATOR_V2_LIGHT_CHAT",
    status: "ANSWERED",
    answer,
    response_trace,
    response_mode,
    result,
    evidence_state,
    retrieval: {strategy:retrieved.semantic?"LOCAL_SEMANTIC_FTS_RRF":"FTS_RRF",warnings:retrieved.warnings},
    evidence: tenderEvidence.map(({ ref, document, page, section, ...rest }:any) => ({ ref, document, page, section,chunk_id:rest.chunk_id||null,document_url:rest.document_url||null,source_id:rest.source_id||null })),
    company_evidence: companyEvidence.map(({ ref, document, page, section, ...rest }:any) => ({ ref, document, page, section,chunk_id:rest.chunk_id||null,document_url:rest.document_url||null,source_id:rest.source_id||null })),
    historical_evidence: historicalEvidence.map(({ ref, document, page, section, ...rest }:any) => ({ ref, document, page, section,chunk_id:rest.chunk_id||null,document_url:rest.document_url||null,source_id:rest.source_id||null })),
    historical_positive_evidence: positiveEvidence.map(({ ref, document, page, section, ...rest }:any) => ({ ref, document, page, section,chunk_id:rest.chunk_id||null,document_url:rest.document_url||null,source_id:rest.source_id||null })),
    readiness_warnings: official?.available?[]:userReadinessWarnings,
    partial_document_evidence: official?.available?false:!evidenceAvailable,
    official_decision: official?.decision||null,
    model: aiJson.model || MODEL,
    changed_business_statuses: 0,
    orchestration_steps_run: 0,
    extraction_triggered: false,
    ocr_triggered: false,
    embedding_triggered: false,
    indexing_triggered: false,
  }, { headers: cors });
}

Deno.serve(async(req:Request)=>{
 if(!URL||!KEY)return Response.json({ok:false,error:"SERVICE_UNAVAILABLE"},{status:503,headers:cors});
 const db=createClient(URL,KEY,{auth:{persistSession:false}});
 // Administrative production probes use the identical authenticated evaluator
 // without creating conversations or audit exchanges. Public clients cannot opt out.
 const probe=await req.clone().json().catch(()=>({}));
 if(req.headers.get('Authorization')==='Bearer '+KEY&&!req.headers.get('x-agenttender-session')&&probe.read_only===true&&uuid.test(String(probe.user_id||'')))return processChatRequest(req);
 // Service-only: the V2 decision worker requests the shared company check (no conversation).
 if(req.headers.get('Authorization')==='Bearer '+KEY&&!req.headers.get('x-agenttender-session')&&probe.action==='company_check')return processChatRequest(req);
 return durableChat(req,processChatRequest,db,KEY,cors);
});
