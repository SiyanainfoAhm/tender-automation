import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import * as XLSX from "./xlsx-0.20.3.mjs";
import {unzipSync} from "npm:fflate@0.8.2";
const env=(n:string)=>Deno.env.get(n)?.trim()||"";
const pick=(...names:string[])=>names.map(env).find(Boolean)||"";
const graphConfig=()=>({tenant:pick("MICROSOFT_GRAPH_TENANT_ID","MS_GRAPH_TENANT_ID"),client:pick("MICROSOFT_GRAPH_CLIENT_ID","MS_GRAPH_CLIENT_ID"),secret:pick("MICROSOFT_GRAPH_CLIENT_SECRET","MS_GRAPH_CLIENT_SECRET"),drive:pick("MS_GRAPH_DRIVE_ID","MICROSOFT_GRAPH_DRIVE_ID")});
const decodeEntities=(s:string)=>s.replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const MAX_TEXT=200000;
const dec=new TextDecoder();
// Minimal .xlsx reader (shared strings + sheet cells) so spreadsheets are searchable without a heavy dependency.
function xlsxText(bytes:Uint8Array):string{
 const files:any=unzipSync(bytes,{filter:(f:any)=>f.name==="xl/sharedStrings.xml"||/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)});
 const shared:string[]=[];
 if(files["xl/sharedStrings.xml"])for(const m of dec.decode(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g))shared.push(decodeEntities(m[1].replace(/<[^>]+>/g,"")));
 const names=Object.keys(files).filter(n=>n.startsWith("xl/worksheets/")).sort((a,b)=>Number(a.match(/(\d+)\.xml/)![1])-Number(b.match(/(\d+)\.xml/)![1]));
 const out:string[]=[];
 for(const name of names){
  out.push("## Sheet "+name.match(/(\d+)\.xml/)![1]);
  for(const row of dec.decode(files[name]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
   const cells:string[]=[];
   for(const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const type=(c[1].match(/\bt="([^"]+)"/)||[])[1],body=c[2]||"";
    const v=(body.match(/<v>([\s\S]*?)<\/v>/)||[])[1];
    let val="";
    if(type==="s")val=shared[Number(v)]??"";
    else if(type==="inlineStr")val=decodeEntities(body.replace(/<[^>]+>/g,""));
    else val=decodeEntities(v??"");
    cells.push(val.replace(/[\r\n,]+/g," ").trim());
   }
   if(cells.some(Boolean))out.push(cells.join(","));
  }
  if(out.join("\n").length>MAX_TEXT)break;
 }
 return out.join("\n").slice(0,MAX_TEXT);
}
Deno.serve(async req=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!key||req.headers.get("Authorization")!=="Bearer "+key)return Response.json({error:"Unauthorized"},{status:401});
 const started=Date.now();

 if(new URL(req.url).pathname.endsWith("/health")){
  const graph=graphConfig();
  const missing=Object.entries(graph).filter(([k,v])=>!v).map(([k])=>k);
  if(missing.length)return Response.json({status:"BLOCKED_CONFIGURATION",missing,token_verified:false,drive_verified:false},{status:503});
  try{
   const form=new URLSearchParams({client_id:graph.client,client_secret:graph.secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"});
   const tokenResponse=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(graph.tenant)+"/oauth2/v2.0/token",{method:"POST",body:form});
   if(!tokenResponse.ok)return Response.json({status:"AUTH_FAILED",http_status:tokenResponse.status,token_verified:false,drive_verified:false},{status:502});
   const accessToken=(await tokenResponse.json()).access_token;
   const driveResponse=await fetch("https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(graph.drive)+"?$select=id,driveType",{headers:{Authorization:"Bearer "+accessToken}});
   return Response.json({status:driveResponse.ok?"CONNECTED":"DRIVE_ACCESS_FAILED",token_verified:true,drive_verified:driveResponse.ok,drive_http_status:driveResponse.status},{status:driveResponse.ok?200:502});
  }catch(e){return Response.json({status:"CONNECTION_ERROR",error:e instanceof Error?e.message:JSON.stringify(e),token_verified:false,drive_verified:false},{status:502});}
 }
 const db=createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false}});
 try{
 const input=await req.json().catch(()=>({}));
 const tenderId=String(input.tender_id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenderId))return Response.json({error:"Valid tender_id required"},{status:400});
 const {data:work,error:we}=await db.rpc("agenttender_orch_document_worklist",{p_tender_id:tenderId});if(we)throw we;
 const {data:t,error:te}=await db.from("agenttender_tenders").select("source_tender_id,scraped_date").eq("id",tenderId).single();if(te)throw te;
 const maxDocs=Math.min(6,Math.max(1,Number(input.max_documents)||3));
 const allPending=(work.documents||[]).filter((d:any)=>d.requires_extraction&&d.sharepoint_drive_item_id);
 const noDriveItem=(work.documents||[]).filter((d:any)=>d.requires_extraction&&!d.sharepoint_drive_item_id).length;
 const pending=(input.document_id?allPending.filter((d:any)=>String(d.document_id)===String(input.document_id)):allPending).slice(0,maxDocs);
 if(!pending.length)return Response.json({status:noDriveItem?"BLOCKED_UPLOAD_INCOMPLETE":"READY_FOR_INDEX",tender_id:tenderId,processed:0,documents_without_storage:noDriveItem});
 const graph=graphConfig();
 const missing=Object.entries(graph).filter(([k,v])=>!v).map(([k])=>k);
 if(missing.length)return Response.json({status:"BLOCKED_CONFIGURATION",missing,pending_documents:pending.length,tender_id:tenderId},{status:503});
 const form=new URLSearchParams({client_id:graph.client,client_secret:graph.secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"});
 const auth=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(graph.tenant)+"/oauth2/v2.0/token",{method:"POST",body:form});
 if(!auth.ok)throw Error("Microsoft Graph token request failed: "+auth.status);
 const token=(await auth.json()).access_token;
 const results:any[]=[];
 for(const d of pending){
  if(Date.now()-started>80000){results.push({document_id:d.document_id,status:"DEFERRED_TIME_BUDGET"});continue;}
  try{
   const url="https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(graph.drive)+"/items/"+encodeURIComponent(d.sharepoint_drive_item_id)+"/content";
   const response=await fetch(url,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(35000)});
   if(!response.ok)throw Error("Graph download failed: "+response.status);
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>40_000_000)throw Error("Document exceeds 40 MB extraction limit");
   const isPdf=bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70;
   const ext=((d.file_name||"").toLowerCase().match(/\.([a-z0-9]+)$/)||[])[1]||"";
   if(!isPdf){
    let text="",method="",unsupported=false;
    if(ext==="html"||ext==="htm"){
     const html=dec.decode(bytes);
     text=decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();method="HTML_TEXT";
    }else if(ext==="csv"){
     text=dec.decode(bytes).slice(0,MAX_TEXT).trim();method="CSV_TEXT";
    }else if(ext==="xls"){
     const workbook=XLSX.read(bytes,{type:"array",cellDates:false,cellFormula:false});
     text=workbook.SheetNames.map(name=>"## Sheet "+name+"\\n"+XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\\n\\n").trim();
     if(text.length>MAX_TEXT)throw Error("SPREADSHEET_TEXT_EXCEEDS_LIMIT");
     method="XLS_BIFF_TEXT";
    }else if(ext==="xlsx"){
     text=xlsxText(bytes).trim();method="XLSX_TEXT";
    }else if(ext==="docx"){
     const files:any=unzipSync(bytes,{filter:(f:any)=>f.name==="word/document.xml"});
     const xml=files["word/document.xml"]?dec.decode(files["word/document.xml"]):"";
     text=decodeEntities(xml.replace(/<\/w:p>/g,"\n").replace(/<w:tab\/>/g,"\t").replace(/<[^>]+>/g,"")).replace(/[ \t]+\n/g,"\n").trim().slice(0,MAX_TEXT);method="DOCX_TEXT";
    }else{
     // Legacy binary formats (xls/doc) are not parsed: record an explicit placeholder so the gap is visible instead of blocking the tender silently.
     text="[Attachment not text-extracted: unsupported "+(ext||"unknown")+" format ("+d.file_name+"). Its content has NOT been reviewed.]";method="UNSUPPORTED_PLACEHOLDER";unsupported=true;
    }
    if(!unsupported&&text.length<50)throw Error(method+" has insufficient readable text");
    const now=new Date().toISOString();
    const {error:docError}=await db.from("agenttender_document_extractions").upsert({scraped_date:t.scraped_date||now.slice(0,10),source_tender_id:t.source_tender_id,document_kind:"ORIGINAL",file_name:"sp-"+d.document_id+"-"+d.file_name,source_url:null,extraction_status:"SUCCESS",extracted_text:text,content_bytes:bytes.length,extraction_error:null,extracted_at:now,updated_at:now,document_id:d.document_id,tender_id:tenderId,extraction_metadata:{source:"orchestrator-graph",method,unsupported_type:unsupported,pages:1}},{onConflict:"scraped_date,source_tender_id,document_kind,file_name"});if(docError)throw docError;
    results.push({document_id:d.document_id,status:"SUCCESS",characters:text.length,method});continue;
   }
   const pdf=await pdfjs.getDocument({data:bytes,useSystemFonts:true,disableFontFace:true}).promise;
   let pages:string[]=[];
   try{
    if(pdf.numPages>350)throw Error("PDF exceeds 350 page extraction limit");
    for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(content.items.map((x:any)=>"str" in x?x.str:"").join(" "));page.cleanup();}
   }finally{await pdf.destroy();}
   let extracted=pages.map((p,i)=>"[Page "+(i+1)+"]\n"+p).join("\n\n");
   let extractionMethod="PDF_TEXT";
   const lowTextPages=pages.filter(p=>p.trim().length<50).length;
   if(lowTextPages>0){
    const now=new Date().toISOString(),weak=pages.map((p,i)=>p.trim().length<50?i+1:null).filter(Boolean);
    const detected={scraped_date:t.scraped_date,source_tender_id:t.source_tender_id,document_kind:"ORIGINAL",file_name:"sp-"+d.document_id+"-"+d.file_name,source_url:null,extraction_status:"EMPTY",extracted_text:extracted,content_bytes:bytes.length,extraction_error:"OCR_REQUIRED: scanned or sparse pages detected",extracted_at:now,updated_at:now,document_id:d.document_id,tender_id:tenderId,extraction_metadata:{method:"PDF_TEXT",ocr_required_pages:weak,total_pages:pages.length,completeness:"partial"}};
    const {error:scanWriteError}=await db.from("agenttender_document_extractions").upsert(detected,{onConflict:"scraped_date,source_tender_id,document_kind,file_name"});if(scanWriteError)throw scanWriteError;
    results.push({document_id:d.document_id,status:"OCR_REQUIRED",pages:pages.length,low_text_pages:lowTextPages});continue;
   }
   const now=new Date().toISOString();
   const row={scraped_date:t.scraped_date||now.slice(0,10),source_tender_id:t.source_tender_id||tenderId,document_kind:"ORIGINAL",file_name:"sp-"+d.document_id+"-"+d.file_name,source_url:null,extraction_status:"SUCCESS",extracted_text:extracted,content_bytes:bytes.length,extraction_error:null,extracted_at:now,updated_at:now,document_id:d.document_id,tender_id:tenderId,extraction_metadata:{source:"orchestrator-graph-pdf",pages:pages.length,method:extractionMethod,low_text_pages:lowTextPages}};
   const {data:existing,error:ee}=await db.from("agenttender_document_extractions").select("document_id").eq("document_id",d.document_id).eq("tender_id",tenderId).limit(1);if(ee)throw ee;
   const write=existing?.length?await db.from("agenttender_document_extractions").update(row).eq("document_id",d.document_id).eq("tender_id",tenderId):await db.from("agenttender_document_extractions").insert(row);
   if(write.error)throw write.error;
   results.push({document_id:d.document_id,status:"SUCCESS",pages:pages.length,characters:extracted.length,method:extractionMethod});
  }catch(e){results.push({document_id:d.document_id,status:"BLOCKED",error:e instanceof Error?e.message:JSON.stringify(e)});}
 }
 const remaining=allPending.length-results.filter(r=>r.status==="SUCCESS"||r.status==="OCR_REQUIRED").length;
 return Response.json({tender_id:tenderId,status:results.every(r=>r.status==="SUCCESS")?"EXTRACTED":"PARTIAL_OR_BLOCKED",results,remaining_pending:remaining,documents_without_storage:noDriveItem,business_status_changed:false});
 }catch(e){return Response.json({error:e instanceof Error?e.message:JSON.stringify(e)},{status:500});}
});
