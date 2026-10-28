// Code-only extraction: SharePoint (Microsoft Graph) download + pdfjs/docx/xlsx parsing.
// No AI here. Scanned/image-only pages are flagged OCR_REQUIRED for a later, optional AI stage.
import {processPageBatch} from "./checkpoint.mjs";
import {getDocument,OPS} from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import {unzipSync,strFromU8} from "npm:fflate@0.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import {admin,authorized,checked,clean,substantive,env,request} from "./common.ts";
import {pdfLayout,quality,PARSER_VERSION} from "./structure.ts";
const MAX_BYTES=18_000_000;
const graphRoot="https://graph.microsoft.com/v1.0";
async function graphToken(){
 const tenant=env("MICROSOFT_GRAPH_TENANT_ID")||env("MS_GRAPH_TENANT_ID"),client=env("MICROSOFT_GRAPH_CLIENT_ID")||env("MS_GRAPH_CLIENT_ID"),secret=env("MICROSOFT_GRAPH_CLIENT_SECRET")||env("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("GRAPH_NOT_CONFIGURED: Microsoft Graph tenant/client/secret missing");
 const r=await request(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{method:"POST",body:new URLSearchParams({client_id:client,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"})});
 const j=await r.json();if(!r.ok||!j.access_token)throw Error(`Graph token HTTP ${r.status}: ${j.error||"missing token"}`);return j.access_token;
}
async function graphJson(path:string,token:string){const r=await request(graphRoot+path,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error(`Graph metadata HTTP ${r.status}`);return r.json();}
async function driveId(token:string){
 const configured=env("MS_GRAPH_DRIVE_ID")||env("MICROSOFT_GRAPH_DRIVE_ID");if(configured)return configured;
 const host=env("SHAREPOINT_SITE_HOSTNAME")||"it1stop.sharepoint.com",path=env("SHAREPOINT_SITE_PATH")||"/sites/SiyanaTenderDocumentRepository";
 const site=await graphJson(`/sites/${host}:${path}`,token),drives=await graphJson(`/sites/${site.id}/drives`,token);
 const name=(env("SHAREPOINT_LIBRARY_NAME")||"TenderDocs").toLowerCase(),drive=drives.value?.find((x:any)=>x.name?.toLowerCase()===name);
 if(!drive)throw Error("SharePoint TenderDocs library missing");return drive.id;
}
async function download(d:any,token:string,drive:string){
 let path:string;
 if(d.sharepoint_item_id)path=`/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(d.sharepoint_item_id)}/content`;
 else {const u=new URL(d.storage_url);if(u.hostname!==(env("SHAREPOINT_SITE_HOSTNAME")||"it1stop.sharepoint.com"))throw Error("Unexpected SharePoint host");const marker=`/${env("SHAREPOINT_LIBRARY_NAME")||"TenderDocs"}/`,i=u.pathname.toLowerCase().indexOf(marker.toLowerCase());if(i<0)throw Error("SharePoint item ID required for this document URL");path=`/drives/${encodeURIComponent(drive)}/root:/${u.pathname.slice(i+marker.length).split("/").map(decodeURIComponent).map(encodeURIComponent).join("/")}:/content`;}
 let r=await request(graphRoot+path,{headers:{Authorization:`Bearer ${token}`},redirect:"manual"});
 if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location||new URL(location).protocol!=="https:")throw Error("Invalid SharePoint redirect");r=await request(location,{redirect:"follow"});}
 if(!r.ok)throw Error(`Graph content HTTP ${r.status}`);
 if(Number(r.headers.get("content-length")||0)>MAX_BYTES)throw Error("DOCUMENT_TOO_LARGE: exceeds 18MB edge limit");
 const reader=r.body!.getReader(),parts:Uint8Array[]=[],size={value:0};
 for(;;){const {value,done}=await reader.read();if(done)break;size.value+=value.length;if(size.value>MAX_BYTES){await reader.cancel();throw Error("DOCUMENT_TOO_LARGE: exceeds 18MB edge limit");}parts.push(value);}
 const out=new Uint8Array(size.value);let p=0;for(const b of parts){out.set(b,p);p+=b.length;}return out;
}
function files(name:string,bytes:Uint8Array,depth=0,budget={bytes:0,count:0}):Array<{name:string;bytes:Uint8Array}>{
 if(!/\.zip$/i.test(name)){budget.bytes+=bytes.length;budget.count++;if(budget.bytes>40_000_000||budget.count>100)throw Error("ARCHIVE_RESOURCE_LIMIT: split large archive");return [{name,bytes}];}
 if(depth>=3)throw Error("ARCHIVE_RESOURCE_LIMIT: archive nesting exceeds 3 levels");
 const entries=unzipSync(bytes,{filter:f=>{if(f.originalSize>MAX_BYTES)throw Error("ARCHIVE_RESOURCE_LIMIT: member exceeds 18MB");return !f.name.endsWith("/");}});
 const out:Array<{name:string;bytes:Uint8Array}>=[];
 for(const [n,b] of Object.entries(entries))out.push(...files(`${name}/${n}`,b,depth+1,budget));return out;
}
async function extractFile(file:{name:string;bytes:Uint8Array},state:any,budget:{native:number},checkpoint:()=>Promise<void>){
 const name=file.name.toLowerCase();
 if(name.endsWith(".pdf")){
  const task=getDocument({data:file.bytes.slice(),useSystemFonts:true,disableFontFace:true,isEvalSupported:false});const pdf=await task.promise;
  try {
   await processPageBatch(state,pdf.numPages,budget,async(n:number)=>{
    const page=await pdf.getPage(n);try{
     const c=await page.getTextContent(),layout=pdfLayout(c.items),text=clean(layout.text);
     const operators=await page.getOperatorList();const hasImages=operators.fnArray.some((op:number)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op));
     const chars=substantive(text),replacement=(text.match(/\uFFFD/g)||[]).length;const readable=chars>20&&!(hasImages&&chars<120)&&replacement/Math.max(chars,1)<0.05;
     return {...layout,text,has_images:hasImages,method:"PDF_TEXT",readable,reason:readable?null:chars<=20?"NO_OR_SPARSE_TEXT_LAYER":hasImages&&chars<120?"POSSIBLE_SCANNED_PAGE_WITH_HEADER_ONLY":"CORRUPT_TEXT_LAYER"};
    }finally{page.cleanup();}
   },checkpoint);
   if(state.done){
    state.text=Object.keys(state.pages).map(Number).sort((a,b)=>a-b).map(n=>`--- PAGE ${n} ---\n${state.pages[n].text}`).join("\n\n");
    const scanned=Object.keys(state.pages).filter(n=>!state.pages[n].readable);
    state.status=Object.values(state.pages).some((p:any)=>p.readable)?"SUCCESS":"EMPTY";
    state.quality=quality(state.pages,pdf.numPages);
    state.ocr_pages=scanned.map(Number);
    state.error=scanned.length?`OCR_REQUIRED: ${scanned.length} of ${pdf.numPages} pages have missing, sparse or corrupt text (${scanned.slice(0,40).join(",")}${scanned.length>40?",...":""})`:null;
   }
  }finally{await task.destroy();}
 }else{
  let text="";
  if(name.endsWith(".docx")){const z=unzipSync(file.bytes);if(!z["word/document.xml"])throw Error("Invalid DOCX: document.xml missing");text=strFromU8(z["word/document.xml"]).replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");}
  else if(/\.(xlsx|xls|xlsm)$/.test(name)){
   const head=new TextDecoder().decode(file.bytes.subarray(0,512)).trimStart().toLowerCase();
   if(head.startsWith("<")){text=new TextDecoder().decode(file.bytes).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<\/(tr|p|div|br)>/gi,"\n").replace(/<[^>]+>/g," ");}
   else {const w=XLSX.read(file.bytes,{type:"array"});text=w.SheetNames.map(n=>`--- SHEET ${n} ---\n${XLSX.utils.sheet_to_csv(w.Sheets[n])}`).join("\n\n");}
  }
  else if(/\.(txt|csv|json|xml|html|htm)$/.test(name)){text=new TextDecoder().decode(file.bytes);if(/\.html?$/.test(name))text=text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ");}
  else {state.done=true;state.text="";state.status="UNSUPPORTED";state.error="Unsupported document format";return;}
  state.text=clean(text);state.status=substantive(state.text)>20?"SUCCESS":"EMPTY";state.done=true;state.error=state.status==="EMPTY"?"No substantive document text":null;
 }
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({ok:false,error:"POST required"},{status:405});
 try {
  if(!authorized(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const sb=admin(),input=await req.json().catch(()=>({}));
  const token=await graphToken(),drive=await driveId(token);
  const jobs=input.document_id?await checked(sb.rpc("agenttender_claim_sharepoint_document",{p_document:input.document_id})):await checked(sb.rpc("agenttender_claim_sharepoint_ingestion",{p_limit:Math.min(3,Math.max(1,Number(input.limit)||2))}));
  const results:any[]=[];
  for(const d of jobs||[]){
   const eligible=await checked(sb.from("agenttender_tenders").select("id,status,qualification_status,prescreen_status").eq("id",d.tender_id).eq("source_region","INDIAN").maybeSingle());
   // 2026-10-27: CONDITIONAL_GO and tenders asked about in the chatbot are also extracted.
   const chatPrep=eligible?!!(await checked(sb.rpc("agenttender_chat_prep_active",{p_tender:eligible.id}))):false;
   if(!eligible||!(eligible.qualification_status==="GO"||eligible.qualification_status==="CONDITIONAL_GO"||(eligible.qualification_status==="VERIFY"&&eligible.prescreen_status==="NEEDS_DOCUMENTS")||String(eligible.status||"").toLowerCase()==="will-bid"||chatPrep)){
     await checked(sb.from("agenttender_document_ingestion_jobs").update({status:"SKIPPED",last_error:"Not eligible for document processing: tender not GO, CONDITIONAL_GO, VERIFY/NEEDS_DOCUMENTS, manually will-bid or chat-requested",lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq("document_id",d.document_id).eq("lease_token",d.lease_token));
     results.push({document_id:d.document_id,status:"SKIPPED"});continue;
   }
   const progress=d.progress||{};progress.files??={};
   const save=async(values:any)=>{const data=await checked(sb.from("agenttender_document_ingestion_jobs").update({...values,updated_at:new Date().toISOString(),lease_token:null,lease_expires_at:null}).eq("document_id",d.document_id).eq("lease_token",d.lease_token).select("document_id"));if(!data?.length)throw Error("Document lease lost");};
   try {
    const bytes=await download(d,token,drive),members=files(d.file_name||"document",bytes),budget={native:4};
    for(const member of members){const state=progress.files[member.name]??={};progress.files[member.name]=state;if(!state.done)await extractFile(member,state,budget,async()=>{const rows=await checked(sb.from("agenttender_document_ingestion_jobs").update({progress,updated_at:new Date().toISOString()}).eq("document_id",d.document_id).eq("lease_token",d.lease_token).select("document_id"));if(!rows?.length)throw Error("Document lease lost");});if(budget.native<=0)break;}
    const complete=members.every(x=>progress.files[x.name]?.done);
    if(!complete){await save({status:"PENDING",progress,last_error:null,next_attempt_at:new Date(Date.now()+1000).toISOString()});results.push({document_id:d.document_id,status:"IN_PROGRESS",pages_processed:Object.values(progress.files).reduce((n:number,f:any)=>n+Object.keys(f.pages||{}).length,0)});continue;}
    const now=new Date().toISOString(),records=members.map(m=>{const s=progress.files[m.name];return {document_id:d.document_id,tender_id:d.tender_id,scraped_date:d.scraped_date,source_tender_id:d.source_tender_id,document_kind:"ORIGINAL",file_name:`sp-${d.document_id}-${m.name}`,source_url:d.storage_url,extraction_status:s.status,extracted_text:s.text||null,content_bytes:m.bytes.length,extraction_error:s.error||null,extraction_metadata:s.quality||{parser:PARSER_VERSION,format:"non_pdf",completeness:"unverified"},extracted_at:now,updated_at:now};});
    await checked(sb.from("agenttender_document_extractions").upsert(records,{onConflict:"scraped_date,source_tender_id,document_kind,file_name"}));
    const success=records.some(x=>x.extraction_status==="SUCCESS");
    const status=success?"EXTRACTED":records.every(x=>x.extraction_status==="UNSUPPORTED")?"UNSUPPORTED":"EMPTY";
    const notes=records.filter(x=>x.extraction_error).map(x=>`${x.file_name}: ${x.extraction_error}`).join("; ")||null;
    await save({status,progress:{files:Object.fromEntries(Object.entries(progress.files).map(([n,s]:[string,any])=>[n,{done:s.done,status:s.status,total_pages:s.total_pages,ocr_pages:s.ocr_pages,quality:s.quality,error:s.error}]))},last_error:notes});
    results.push({document_id:d.document_id,status,files:records.length,chars:records.reduce((n,x)=>n+(x.extracted_text?.length||0),0),notes});
   }catch(e){const message=e instanceof Error?e.message:String(e);const failures=d.failure_count+1;const status=failures>=8?"FAILED":"RETRY";await save({status,progress,failure_count:failures,last_error:message,next_attempt_at:new Date(Date.now()+Math.min(86400000,60000*2**failures)).toISOString()});console.error(JSON.stringify({stage:"extract",document_id:d.document_id,error:message}));results.push({document_id:d.document_id,status,error:message});}
  }
  const failed=results.filter(x=>x.error).length;
  return Response.json({ok:failed===0,processed:results.length,failed,results},{status:failed?207:200});
 }catch(e){console.error(e);return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}
});
