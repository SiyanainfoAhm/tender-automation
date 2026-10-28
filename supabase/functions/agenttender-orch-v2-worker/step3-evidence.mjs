import {reviewCoverage} from "./coverage.mjs";
import {activeRules} from "./policy.mjs";

export const isSummary=(x)=>x.document_kind==="AI_SUMMARY"||/ai[\s_-]*summary/i.test(x.file_name||"");
export const SCREEN_VERSION="FULL_COVERAGE_20261028_1";
const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
export function validateAssessment(raw,sources,rules){
 const evidence=(Array.isArray(raw.evidence)?raw.evidence:[]).filter(e=>{
  const s=sources.find(s=>s.ref===e.ref);
  return s && (norm(e.quote).length>=25 || (s.document_kind==="LISTING" && norm(e.quote).length>=8 && norm(e.quote)===norm(s.title) && norm(s.description)===norm(s.title))) && norm(s.text).includes(norm(e.quote));
 }).map(e=>({ref:e.ref,quote:String(e.quote),rule_code:String(e.rule_code||""),exceptions_checked:e.exceptions_checked===true||raw.exceptions_checked===true}));
 const exclusions=evidence.filter(e=>rules.some(r=>r.code===e.rule_code&&r.decision==="NO_GO"));
 const unresolved=Array.isArray(raw.unresolved_questions)?raw.unresolved_questions.map(String):["Assessment incomplete"];
 const requirements=(Array.isArray(raw.requirements)?raw.requirements:[]).filter(r=>sources.some(s=>s.ref===r.ref&&s.document_kind!=="AI_SUMMARY"&&norm(r.quote).length>=25&&norm(s.text).includes(norm(r.quote))));
 const scopeCodes=new Set(["HARDWARE","MANPOWER","NON_IT_SERVICES","TRAINING_ONLY","SOFTWARE_RESALE","STANDALONE_SOFTWARE_AMC","KIOSK","PROPRIETARY_ONLY","PAC_PROPRIETARY_PRODUCT","CCTV_GPS_CONTROL_ROOM","GIS_SURVEY_PROCESSING","TELECOM_NETWORK_INFRASTRUCTURE","SPEECH_DATA_COLLECTION_TRANSCRIPTION","CYBER_SECURITY","SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL","INDUSTRIAL_MONITORING_DATA_TRANSMISSION_AMC","ICCC_EXISTING_O_AND_M","READY_MADE_SOFTWARE"]);
 const scopeExclusions=exclusions.filter(e=>scopeCodes.has(e.rule_code)&&e.exceptions_checked===true&&(e.rule_code!=="MANPOWER"||/manpower|staffing|staff augmentation|resource.based|person.month|personnel deployment|deployment of.{0,30}(staff|personnel)/i.test(e.quote))&&(!["SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL","SOFTWARE_RESALE","READY_MADE_SOFTWARE"].includes(e.rule_code)||/software|licen[cs]e|SaaS|Microsoft|MS Office|Office 20/i.test(e.quote))&&(e.rule_code!=="KIOSK"||/kiosk|self[ -]?service/i.test(e.quote))&&(!["PROPRIETARY_ONLY","PAC_PROPRIETARY_PRODUCT"].includes(e.rule_code)||/proprietary|\bPAC\b|exclusiv|OEM.only|only.authori[sz]ed/i.test(e.quote))&&sources.some(s=>s.ref===e.ref&&s.document_kind!=="AI_SUMMARY"));
 const positive=evidence.some(e=>rules.some(r=>r.code===e.rule_code&&r.code.startsWith("FIT_")&&r.decision!=="NO_GO")&&sources.some(s=>s.ref===e.ref&&s.document_kind!=="AI_SUMMARY"));
 const disposition=raw.disposition==="CLEAR_EXCLUSION"&&scopeExclusions.length&&raw.primary_scope_clear===true&&raw.conflict!==true
  ?"CLEAR_EXCLUSION":raw.disposition==="SCOPE_ESTABLISHED"&&positive&&raw.primary_scope_clear===true&&raw.conflict!==true?"SCOPE_ESTABLISHED":raw.disposition==="REQUIREMENTS_SUFFICIENT"&&requirements.length&&evidence.length&&
  raw.requirements_complete===true&&positive&&raw.scope_present===true&&raw.conflict!==true&&unresolved.length===0?"REQUIREMENTS_SUFFICIENT":"NEED_MORE";
 return {disposition,primary_scope:String(raw.primary_scope||"").slice(0,800),decision_candidate:disposition==="CLEAR_EXCLUSION"?"NO_GO":disposition==="REQUIREMENTS_SUFFICIENT"?"PQ_EVALUATION":"VERIFY",explanation:String(raw.explanation||"More evidence required").slice(0,1800),
  evidence,confirmed_rule_codes:disposition==="CLEAR_EXCLUSION"?[...new Set(scopeExclusions.map(e=>e.rule_code))]:[],
  requirements,unresolved_questions:unresolved,next_document:String(raw.next_document||"Main RFP / eligibility clauses, relevant BOQ or corrigendum").slice(0,600)};
}

export function selectEvidenceText(value,maxChars=26000){
 const text=String(value||"");
 if(text.length<=maxChars)return {text,truncated:false};
 const ranges=[[0,Math.min(4000,text.length)]];
 const patterns=[/closing date|bid closing|submission|critical dates|time schedule|last date/ig,/eligibility|pre[ -]?qualification|qualification criteria/ig,/scope of work|statement of work|deliverables/ig,/mandatory|bidder (?:must|shall)|minimum turnover/ig,/exemption|waiver|corrigendum|amendment/ig,/licen[cs]e|hardware|bill of quantities|\\bBOQ\\b/ig];
 for(const pattern of patterns){let m,n=0;while((m=pattern.exec(text))&&n++<4)ranges.push([Math.max(0,m.index-500),Math.min(text.length,m.index+1600)]);}
 ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
 for(const [start,end] of ranges){const last=merged.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else merged.push([start,end]);}
 let selected="",remaining=maxChars;
 for(const [start,end] of merged){const part=text.slice(start,Math.min(end,start+remaining));if(!part)break;selected+=(selected?"\n[... omitted document text ...]\n":"")+part;remaining-=part.length;if(remaining<=0)break;}
 return {text:selected,truncated:true};
}

export async function inspectStep3({db,tender,aiKey,allowAI,allowPrepare,call,url,key,checkpoint={},leaseToken}){
 const id=tender.id;
 const rules=await activeRules(db);
 const {data:work,error:workError}=await db.rpc("agenttender_orch_document_worklist",{p_tender_id:id});if(workError)throw workError;
 const load=async()=>{
  const direct=await allRows(()=>db.from("agenttender_document_extractions").select("document_id,document_kind,file_name,source_url,extracted_text,extraction_status,extraction_metadata").eq("tender_id",id).eq("extraction_status","SUCCESS"));
  let legacy=[];
  if(tender.scraped_date&&tender.source_tender_id){
   const data=await allRows(()=>db.from("agenttender_document_extractions").select("document_id,document_kind,file_name,source_url,extracted_text,extraction_status,extraction_metadata").eq("scraped_date",tender.scraped_date).eq("source_tender_id",tender.source_tender_id).eq("extraction_status","SUCCESS"));
   legacy=data||[];
  }
  const owned=(work?.documents||[]);
  const resolved=[...(direct||[]),...legacy].map(x=>{
   const matches=owned.filter(d=>String(d.document_id)===String(x.document_id)||x.file_name==="sp-"+d.document_id+"-"+d.file_name);
   return matches.length===1?{...x,document_id:matches[0].document_id}:x.document_kind==="AI_SUMMARY"?x:null;
  }).filter(Boolean);
  return [...new Map(resolved.filter(x=>x.extraction_metadata?.unsupported_type!==true&&String(x.extracted_text||"").trim().length>0).map(x=>[String(x.document_id||x.source_url)+"|"+x.file_name,x])).values()];
 };
 let docs=await load(),summaryFetch=null;

 const {data:verifiedCorrections,error:learningError}=await db.rpc("agenttender_orch_verified_examples",{p_tender_id:id,p_limit:8});if(learningError)throw learningError;
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({version:SCREEN_VERSION,title:tender.title,description:tender.description,emd:tender.emd_amount,organization:tender.organization,rules,verifiedCorrections,manifest:work.documents,docs:docs.map(d=>[d.document_kind,d.file_name,d.document_id,d.extraction_metadata,d.extracted_text]).sort((a,b)=>String(a[0]+a[1]).localeCompare(String(b[0]+b[1])))})));
 const fingerprint=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
 const cached=checkpoint.step3_screen_cache;
 const cacheValid=cached?.fingerprint===fingerprint&&cached?.result?.policy===SCREEN_VERSION&&cached?.result?.coverage?.synthesis_version==="sections-v4"&&cached?.result;
 const reviewed=cacheValid?{result:{...cached.result,screen_cache_hit:true,ai_calls:0}}:await reviewCoverage({db,tender,docs,work,rules,verifiedCorrections,checkpoint,leaseToken,fingerprint,version:SCREEN_VERSION,aiKey,allowAI,validateAssessment});
 let result=reviewed.result,assessment=result.assessment;
 const sources=result.evidence_sources;
 if(reviewed.pending)throw Error("DEPENDENCY_PENDING:COVERAGE_PROGRESS");
 if(!cacheValid&&leaseToken){
  const {data:saved,error}=await db.from("agenttender_orch_v2_tasks").update({checkpoint:{...checkpoint,step3_coverage:reviewed.coverage,step3_screen_cache:{fingerprint,result}}}).eq("tender_id",id).eq("lease_token",leaseToken).eq("state","RUNNING").select("tender_id");
  if(error)throw error;if(!saved?.length)throw Error("STALE_LEASE_BEFORE_CACHE");
  checkpoint={...checkpoint,step3_coverage:reviewed.coverage};
 }
 if(!result.coverage?.complete&&allowPrepare)throw Error("DEPENDENCY_PENDING:AI_SCREENING_REQUIRED");
 if(assessment.disposition==="CLEAR_EXCLUSION")return {...result,reason:"CLEAR_EXCLUSION",scope_decision_ready:true,evidence_exclusion_candidate:true,operational_reason:null,downloads_avoided:1,embedding_jobs_avoided:1};
 if(assessment.disposition==="REQUIREMENTS_SUFFICIENT"&&sources.some(s=>s.document_kind!=="AI_SUMMARY"&&s.document_id))return {...result,readiness:"READY",review_required:false,scope_decision_ready:false,reason:"REQUIREMENTS_SUFFICIENT",progressive_evidence:true,selected_document_ids:sources.filter(s=>s.document_kind!=="AI_SUMMARY"&&s.document_id).map(s=>s.document_id),embedding_jobs_avoided:1};
 const questions=assessment.unresolved_questions.length?assessment.unresolved_questions:[assessment.disposition==="SCOPE_ESTABLISHED"?"What are all mandatory PQ requirements, payable EMD and applicable exemptions?":"What is the primary contracted scope?"];
 const request={questions,next_document:assessment.next_document,requested_at:new Date().toISOString(),version:SCREEN_VERSION};
 result={...result,operational_reason:"EVIDENCE_PENDING",evidence_request:request};
 if(!allowPrepare)return {...result,reason:"MORE_EVIDENCE_REQUIRED"};
 if(!allowAI||!aiKey)throw Error("DEPENDENCY_PENDING:AI_SCREENING_REQUIRED");
 // Persist a question-bound request under the current lease before any acquisition.
 const {data:saved,error:saveError}=await db.from("agenttender_orch_v2_tasks").update({checkpoint:{...checkpoint,step3_screen_cache:{fingerprint,result},progressive_evidence_request:request}}).eq("tender_id",id).eq("lease_token",leaseToken).eq("state","RUNNING").select("tender_id");
 if(saveError)throw saveError;if(!saved?.length)throw Error("STALE_LEASE_BEFORE_ACQUISITION");
 const pending=(work?.documents||[]).filter(d=>d.requires_extraction&&d.extraction_status==="MISSING"&&d.sharepoint_drive_item_id&&!docs.some(x=>String(x.document_id)===String(d.document_id)));
 const words=(request.next_document+" "+questions.join(" ")).toLowerCase().match(/[a-z]{4,}/g)||[];
 const candidates=pending.map(d=>({...d,score:words.reduce((n,w)=>n+(String(d.file_name).toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score);
 if(candidates.length){
  const selected=candidates[0];
  const {error:selectionError}=await db.from("agenttender_orch_v2_tasks").update({checkpoint:{...checkpoint,step3_screen_cache:{fingerprint,result},progressive_evidence_request:{...request,selected_document_id:selected.document_id}}}).eq("tender_id",id).eq("lease_token",leaseToken).eq("state","RUNNING");if(selectionError)throw selectionError;
  // Existing ingestion worker owns ZIP extraction; do not send archives to the PDF/Word worker.
  if(/\.zip$/i.test(selected.file_name||""))throw Error("DEPENDENCY_PENDING:TARGETED_SOURCE_ACQUISITION");
  const prep=await call("agenttender-orch-document-worker",{tender_id:id,document_id:selected.document_id,max_documents:1,evidence_question:questions.join("; ")},90000);
  const {error:eventError}=await db.from("agenttender_orch_v2_events").insert({tender_id:id,step:3,event_type:"TARGETED_EVIDENCE_REQUEST",details:{...request,document_id:selected.document_id,output:prep}});if(eventError)throw eventError;
  if(prep.processed===0||String(prep.status).startsWith("BLOCKED")||prep.results?.every(r=>["BLOCKED","OCR_REQUIRED"].includes(r.status)))throw Error("DEPENDENCY_PENDING:TARGETED_EXTRACTION_BLOCKED");
  if(prep.results?.some(r=>r.status==="QUEUED_RESUMABLE"))throw Error("DEPENDENCY_PENDING:EXTRACTION_WAIT");
  throw Error("DEPENDENCY_PENDING:EVIDENCE_REFRESH_REQUIRED");
 }
 // A summary is fetched only when existing listing/text did not answer the questions.
 if(!docs.some(isSummary)&&tender.ai_summary_url&&tender.scraped_date&&/^\d{6,15}$/.test(String(tender.source_tender_id))&&!checkpoint.summary_fetch_attempted){
  const {error:markError}=await db.from("agenttender_orch_v2_tasks").update({checkpoint:{...checkpoint,step3_screen_cache:{fingerprint,result},progressive_evidence_request:request,summary_fetch_attempted:true}}).eq("tender_id",id).eq("lease_token",leaseToken);if(markError)throw markError;
  const endpoint=url+"/functions/v1/tender-ai-summary-extract?date="+encodeURIComponent(tender.scraped_date)+"&tender_id="+encodeURIComponent(tender.source_tender_id);
  const res=await fetch(endpoint,{headers:{Authorization:"Bearer "+key,apikey:key},signal:AbortSignal.timeout(45000)});await res.body?.cancel();
  if(res.ok)throw Error("DEPENDENCY_PENDING:EVIDENCE_REFRESH_REQUIRED");
 }
 if(result.coverage?.gaps?.some(g=>g.reason==="OCR_REQUIRED"))throw Error("DEPENDENCY_PENDING:OCR_REQUIRED");
 if(result.coverage?.complete&&!result.coverage.gaps.length&&docs.some(d=>!isSummary(d))&&!(result.missing_documents||[]).length)throw Error("DEPENDENCY_PENDING:EVIDENCE_CLARIFICATION_REQUIRED");
 const {data:acq,error:acqError}=await db.from("agenttender_document_acquisition_jobs").select("status,last_error,evidence").eq("tender_id",id).maybeSingle();if(acqError)throw acqError;
 if(acq?.status==="BLOCKED")throw Error("DEPENDENCY_PENDING:SOURCE_ACQUISITION_BLOCKED:"+String(acq.last_error||"Authorized source required"));
 if(acq&&["PENDING","RETRY","PROCESSING"].includes(acq.status))throw Error("DEPENDENCY_PENDING:TARGETED_SOURCE_ACQUISITION");
 throw Error("DEPENDENCY_PENDING:MISSING_SOURCE_EVIDENCE:"+request.next_document);
}

async function allRows(make){
 const rows=[];for(let start=0;;start+=100){const {data,error}=await make().order("file_name").range(start,start+99);if(error)throw error;rows.push(...(data||[]));if((data||[]).length<100)return rows;}
}
