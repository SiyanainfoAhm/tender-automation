
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import {pdfLayout,structuredChunks} from "./structure.ts";
import {readable as readText,mergeOcrPages,ocrBudget} from "./ocr-core.mjs";
const env=(n:string)=>Deno.env.get(n)?.trim()||"";
const pick=(...names:string[])=>names.map(env).find(Boolean)||"";
const KEY=env("SUPABASE_SERVICE_ROLE_KEY");
const endpoint=()=>pick("AZURE_DI_ENDPOINT","AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT","AZURE_FORM_RECOGNIZER_ENDPOINT","DOCUMENT_INTELLIGENCE_ENDPOINT","AZURE_OCR_ENDPOINT","AZURE_ENDPOINT").replace(/\/+$/,"");
const azureKey=()=>pick("AZURE_DI_KEY","AZURE_DOCUMENT_INTELLIGENCE_KEY","AZURE_FORM_RECOGNIZER_KEY","DOCUMENT_INTELLIGENCE_KEY","AZURE_OCR_KEY","AZURE_KEY","AZURE_DI_API_KEY");
async function sha(s:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function shaBytes(b:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(x=>x.toString(16).padStart(2,"0")).join("");}
const norm=(s:string)=>s.replace(/\u0000/g,"").replace(/[ \t]+\n/g,"\n").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,"");
const MAX_CHUNKS=3000;
Deno.serve(async req=>{
 if(req.method!=="POST")return Response.json({ok:false,error:"POST required"},{status:405});
 if(!KEY||req.headers.get("Authorization")!=="Bearer "+KEY)return Response.json({ok:false,error:"Unauthorized"},{status:401});
 const db=createClient(env("SUPABASE_URL"),KEY,{auth:{persistSession:false}});
 let actualOcrSubmissions=0;
 const done=(value:any)=>Response.json({...value,external_ocr_submissions:actualOcrSubmissions,external_ai_calls:0,business_status_changed:false});
 try{
  const input=await req.json(),id=String(input.tender_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return done({ok:false,error:"Valid tender_id required"});
  const {data:readiness,error:re}=await db.rpc("agenttender_tender_data_readiness",{p_tender_id:id});if(re)throw re;
  const ids=readiness.ocr_document_ids||[];
  if(!ids.length)return done({ok:true,status:"NO_OCR_REQUIRED",readiness});
  const docId=input.document_id?String(input.document_id):ids[0];
  if(!ids.includes(docId))return done({ok:false,error:"Document is not a scanned target for this tender"});
  const {data:d,error:de}=await db.from("agenttender_tender_documents").select("*").eq("id",docId).eq("tender_id",id).single();if(de)throw de;
  const {data:job,error:je}=await db.from("agenttender_document_ingestion_jobs").select("progress").eq("document_id",docId).maybeSingle();if(je)throw je;
  const detected=[...new Set(Object.values(job?.progress?.files||{}).flatMap((f:any)=>f.ocr_pages||[]))].sort((a:any,b:any)=>a-b);
  const plan={document_id:docId,file_name:d.file_name,detected_pages:detected,max_ocr_pages:ocrBudget(input.max_ocr_pages),provider:"AZURE_DOCUMENT_INTELLIGENCE",configured:!!endpoint()&&!!azureKey()};
  if(input.dry_run===true||input.allow_external_ocr!==true)return done({ok:true,status:input.dry_run?"OCR_PREFLIGHT":"OCR_COST_AUTHORIZATION_REQUIRED",plan,readiness});
  if(!/\.pdf$/i.test(d.file_name||""))return done({ok:false,status:"UNSUPPORTED_SCAN_CONTAINER",plan});
  if(!endpoint()||!azureKey())return done({ok:false,status:"OCR_PROVIDER_NOT_CONFIGURED",plan});
  const {data:t,error:te}=await db.from("agenttender_tenders").select("source_tender_id,scraped_date,qualification_status,status").eq("id",id).single();if(te)throw te;
  const {data:chatActive,error:chatError}=await db.rpc('agenttender_chat_prep_active',{p_tender:id});if(chatError)throw chatError;
  if(!["VERIFY","REVIEW","GO","CONDITIONAL_GO"].includes(t.qualification_status)&&!['VERIFY','REVIEW','GO','WILL-BID'].includes(String(t.status||'').toUpperCase())&&!chatActive)return done({ok:false,status:"INDEX_COMMIT_STATUS_NOT_SUPPORTED",existing_status:t.qualification_status});
  const tenant=pick("MICROSOFT_GRAPH_TENANT_ID","MS_GRAPH_TENANT_ID"),client=pick("MICROSOFT_GRAPH_CLIENT_ID","MS_GRAPH_CLIENT_ID"),secret=pick("MICROSOFT_GRAPH_CLIENT_SECRET","MS_GRAPH_CLIENT_SECRET"),drive=pick("MS_GRAPH_DRIVE_ID","MICROSOFT_GRAPH_DRIVE_ID");
  if(!tenant||!client||!secret||!drive||!d.sharepoint_drive_item_id)return done({ok:false,status:"GRAPH_DOCUMENT_ACCESS_NOT_CONFIGURED",document_id:docId});
  const tokenR=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",body:new URLSearchParams({client_id:client,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"}),signal:AbortSignal.timeout(15000)});
  const tokenJ=await tokenR.json();if(!tokenR.ok||!tokenJ.access_token)throw Error("GRAPH_TOKEN_HTTP_"+tokenR.status);
  const driveBytes=async(itemId:string)=>{
   const download=await fetch("https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(drive)+"/items/"+encodeURIComponent(itemId)+"/content",{headers:{Authorization:"Bearer "+tokenJ.access_token},signal:AbortSignal.timeout(20000)});
   if(!download.ok)throw Error("GRAPH_DOWNLOAD_HTTP_"+download.status);
   if(Number(download.headers.get("content-length")||0)>40000000)throw Error("PDF_EXCEEDS_40MB");
   const reader=download.body!.getReader(),parts:Uint8Array[]=[];let size=0;
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>40000000){await reader.cancel();throw Error("PDF_EXCEEDS_40MB");}parts.push(value);}
   const out=new Uint8Array(size);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}
   return out;
  };
  const bytes=await driveBytes(d.sharepoint_drive_item_id);
  const bytesSha=await shaBytes(bytes);
  const {data:sibs}=await db.from("agenttender_document_extractions").select("document_id,extraction_metadata").eq("tender_id",id).neq("document_id",docId).eq("extraction_status","SUCCESS").eq("content_bytes",bytes.length).limit(3);
  let dupOf:string|null=null;
  for(const s of sibs||[]){
   if(!s.extraction_metadata?.ocr_complete)continue;
   let h=s.extraction_metadata?.content_sha256;
   if(!h){
    const {data:sd}=await db.from("agenttender_tender_documents").select("sharepoint_drive_item_id").eq("id",s.document_id).maybeSingle();
    if(!sd?.sharepoint_drive_item_id)continue;
    h=await shaBytes(await driveBytes(sd.sharepoint_drive_item_id));
    await db.from("agenttender_document_extractions").update({extraction_metadata:{...s.extraction_metadata,content_sha256:h}}).eq("document_id",s.document_id).eq("extraction_status","SUCCESS");
   }
   if(h===bytesSha){dupOf=s.document_id;break;}
  }
  if(dupOf){
   const now=new Date().toISOString(),fileName="sp-"+docId+"-"+d.file_name;
   const text="[Duplicate attachment: file content is byte-identical to document "+dupOf+"; its OCR text is indexed under that document.]";
   const metadata={parser:"structure-v3",method:"DUPLICATE_OF_OCR_DOCUMENT",duplicate_of:dupOf,content_sha256:bytesSha,ocr_complete:true,completeness:"duplicate_of_complete_document"};
   const {error:dupWrite}=await db.from("agenttender_document_extractions").upsert({scraped_date:t.scraped_date,source_tender_id:t.source_tender_id,document_kind:"ORIGINAL",file_name:fileName,source_url:d.storage_url,extraction_status:"SUCCESS",extracted_text:text,content_bytes:bytes.length,extraction_error:null,extraction_metadata:metadata,extracted_at:now,updated_at:now,document_id:docId,tender_id:id},{onConflict:"scraped_date,source_tender_id,document_kind,file_name"});if(dupWrite)throw dupWrite;
   const piece={content:text,page_number:1,page_start:1,page_end:1,section:"other",metadata:{parser:"structure-v3",duplicate_of:dupOf,page_references:[1],clause_references:[],duplicate_page_references:[]},chunk_index:0,content_hash:await sha(text)};
   const sourceId=t.scraped_date+":"+t.source_tender_id+":ORIGINAL:"+fileName;
   const {data:count,error:dupCommit}=await db.rpc("agenttender_commit_document_text_chunks",{p_tender_id:id,p_document_id:docId,p_source_id:sourceId,p_document_name:fileName,p_document_url:d.storage_url,p_document_type:"pdf",p_content_hash:await sha(norm(text)),p_chunks:[piece],p_metadata:{tender_document_id:docId,extraction_quality:metadata,ocr_complete:true,embedding_model:null}});if(dupCommit)throw dupCommit;
   return done({ok:true,status:"OCR_TEXT_INDEXED",duplicate_of:dupOf,document_id:docId,chunks:count,remaining_document_ids:ids.filter((x:string)=>x!==docId)});
  }
  const {data:priorRows}=await db.from("agenttender_document_extractions").select("extraction_metadata").eq("document_id",docId).eq("tender_id",id).limit(1);
  const prior:any=priorRows?.[0]?.extraction_metadata||{};
  const priorTotal=Number(prior.total_pages||0),priorWeak=(prior.ocr_required_pages||[]).map(Number);
  const native:any[]=[];
  if(priorTotal>0&&priorWeak.length===priorTotal){
   for(let n=1;n<=priorTotal;n++)native.push({page:n,text:"",readable:false});
  }else{
   const task=pdfjs.getDocument({data:bytes.slice(),useSystemFonts:true,disableFontFace:true,isEvalSupported:false});const pdf=await task.promise;
   try{
    if(pdf.numPages>350)throw Error("PDF_EXCEEDS_350_PAGES");
    for(let n=1;n<=pdf.numPages;n++){
     const p=await pdf.getPage(n),content=await p.getTextContent(),layout=pdfLayout(content.items);
     const ops=await p.getOperatorList();const images=ops.fnArray.some((o:number)=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageXObjectRepeat].includes(o));
     const text=layout.text||"";native.push({page:n,text,readable:readText(text)&&!(images&&text.replace(/\s/g,"").length<120)});p.cleanup();
    }
   }finally{await task.destroy();}
  }
  const pages=native.filter(p=>!p.readable).map(p=>p.page);
  if(pages.length>plan.max_ocr_pages)return done({ok:false,status:"OCR_PAGE_BUDGET_EXCEEDED",required_pages:pages,plan});
  if(!pages.length)return done({ok:false,status:"NATIVE_TEXT_RECOVERED_REEXTRACTION_REQUIRED",plan});
  let {data:operation,error:oe}=await db.from("agenttender_tender_ocr_operations").select("*").eq("document_id",docId).maybeSingle();if(oe)throw oe;
  if(operation&&operation.source_updated_at!==d.updated_at)return done({ok:false,status:"OCR_SOURCE_CHANGED_REVIEW_REQUIRED",plan});
  if(operation?.status==="FAILED"||operation?.status==="SUBMITTING")return done({ok:false,status:"OCR_OPERATION_REVIEW_REQUIRED",document_id:docId});
  let operationUrl=operation?.operation_url;
  if(!operationUrl){
   const {error:claimError}=await db.from("agenttender_tender_ocr_operations").insert({document_id:docId,tender_id:id,source_updated_at:d.updated_at,status:"SUBMITTING",pages});
   if(claimError)return done({ok:true,status:"OCR_ALREADY_CLAIMED",document_id:docId});
   const submitUrl=endpoint()+"/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&pages="+encodeURIComponent(pages.join(","));
   actualOcrSubmissions++;
   const submitted=await fetch(submitUrl,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":azureKey(),"Content-Type":"application/pdf"},body:bytes,signal:AbortSignal.timeout(25000)});
   if(submitted.status!==202)throw Error("OCR_SUBMIT_HTTP_"+submitted.status);
   operationUrl=submitted.headers.get("operation-location");
   if(!operationUrl||new URL(operationUrl).origin!==new URL(endpoint()).origin)throw Error("INVALID_OCR_OPERATION_URL");
   const {error:saveError}=await db.from("agenttender_tender_ocr_operations").update({status:"PENDING",operation_url:operationUrl,updated_at:new Date().toISOString()}).eq("document_id",docId);if(saveError)throw saveError;
  }
  if(new URL(operationUrl).origin!==new URL(endpoint()).origin)throw Error("INVALID_OCR_OPERATION_ORIGIN");
  let output:any=null;
  for(let i=0;i<10;i++){
   const polled=await fetch(operationUrl,{headers:{"Ocp-Apim-Subscription-Key":azureKey()},signal:AbortSignal.timeout(10000)});
   if(!polled.ok)throw Error("OCR_POLL_HTTP_"+polled.status);
   const state=await polled.json();
   if(state.status==="succeeded"){output=state.analyzeResult;break;}
   if(state.status==="failed"){await db.from("agenttender_tender_ocr_operations").update({status:"FAILED",last_error:"PROVIDER_FAILED",updated_at:new Date().toISOString()}).eq("document_id",docId);throw Error("OCR_PROVIDER_FAILED");}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!output)return done({ok:true,status:"OCR_PENDING",document_id:docId,remaining_document_ids:ids.filter((x:string)=>x!==docId)});
  const merged=mergeOcrPages(native,output,pages);
  const unreadable=pages.filter((n:number)=>!readText(merged.find((p:any)=>p.page===n)?.text||""));
  const text=merged.map(p=>"--- PAGE "+p.page+" ---\n"+p.text).join("\n\n"),now=new Date().toISOString();
  const metadata={parser:"structure-v3",method:"NATIVE_PLUS_AZURE_OCR",ocr_complete:true,content_sha256:bytesSha,ocr_pages_processed:pages,ocr_unreadable_pages:unreadable,azure_pages_returned:(output.pages||[]).length,total_pages:native.length,source_document_updated_at:d.updated_at,completeness:unreadable.length?"ocr_text_checked_with_unreadable_pages":"ocr_text_checked",pages:merged.map(p=>({page:p.page,chars:p.text.length,readable:readText(p.text)}))};
  const fileName="sp-"+docId+"-"+d.file_name;
  const pieces=structuredChunks(text,metadata,null);if(!pieces.length)throw Error("OCR_EMPTY");if(pieces.length>MAX_CHUNKS)throw Error("OCR_CHUNK_LIMIT_"+pieces.length);
  const row={scraped_date:t.scraped_date,source_tender_id:t.source_tender_id,document_kind:"ORIGINAL",file_name:fileName,source_url:d.storage_url,extraction_status:"SUCCESS",extracted_text:text,content_bytes:bytes.length,extraction_error:null,extraction_metadata:metadata,extracted_at:now,updated_at:now,document_id:docId,tender_id:id};
  const {error:writeError}=await db.from("agenttender_document_extractions").upsert(row,{onConflict:"scraped_date,source_tender_id,document_kind,file_name"});if(writeError)throw writeError;
  const prepared=[];for(let i=0;i<pieces.length;i++)prepared.push({...pieces[i],chunk_index:i,content_hash:await sha(pieces[i].content)});
  const sourceId=t.scraped_date+":"+t.source_tender_id+":ORIGINAL:"+fileName;
  const {data:count,error:ce}=await db.rpc("agenttender_commit_document_text_chunks",{p_tender_id:id,p_document_id:docId,p_source_id:sourceId,p_document_name:fileName,p_document_url:d.storage_url,p_document_type:"pdf",p_content_hash:await sha(norm(text)),p_chunks:prepared,p_metadata:{tender_document_id:docId,extraction_quality:metadata,ocr_complete:true,embedding_model:null}});if(ce)throw ce;
  const {error:finishError}=await db.from("agenttender_tender_ocr_operations").update({status:"SUCCEEDED",last_error:null,updated_at:now}).eq("document_id",docId);if(finishError)throw finishError;
  return done({ok:true,status:"OCR_TEXT_INDEXED",document_id:docId,pages_processed:pages,unreadable_pages:unreadable.length,chunks:count,remaining_document_ids:ids.filter((x:string)=>x!==docId),embedding_status:"PENDING_EXISTING_LOCAL_EMBEDDING_PIPELINE",next_action:"Rerun readiness before any DeepSeek call"});
 }catch(e){const message=e instanceof Error?e.message:String(e);return done({ok:false,status:"OCR_BLOCKED",error:message||"OCR worker failed",retryable:/timed out|timeout|abort|network|fetch failed/i.test(message)});}
});
