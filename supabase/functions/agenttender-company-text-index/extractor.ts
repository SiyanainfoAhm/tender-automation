// Code-only extraction: SharePoint (Microsoft Graph) download + pdfjs/docx/xlsx parsing.
// No AI here. Scanned/image-only pages are flagged OCR_REQUIRED for a later, optional AI stage.
import {getDocument,OPS} from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import {unzipSync,strFromU8} from "npm:fflate@0.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import {admin,authorized,checked,clean,substantive,env,request} from "./common.ts";
import {pdfLayout,quality,PARSER_VERSION,needsFullOcr} from "./structure.ts";
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
 else {const u=new URL(d.storage_url);if(u.hostname!==(env("SHAREPOINT_SITE_HOSTNAME")||"it1stop.sharepoint.com"))throw Error("Unexpected SharePoint host");const marker=`/${env("SHAREPOINT_LIBRARY_NAME")||"TenderDocs"}/`,i=u.pathname.toLowerCase().indexOf(marker.toLowerCase());if(i<0){const blob=String(d.storage_blob_name||"");if(!blob||blob.includes("://")||blob.split("/").includes(".."))throw Error("SharePoint item ID required for this document URL");path="/drives/"+encodeURIComponent(drive)+"/root:/"+blob.split("/").map(decodeURIComponent).map(encodeURIComponent).join("/")+":/content";}else path=`/drives/${encodeURIComponent(drive)}/root:/${u.pathname.slice(i+marker.length).split("/").map(decodeURIComponent).map(encodeURIComponent).join("/")}:/content`;}
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
async function extractFile(file:{name:string;bytes:Uint8Array},state:any,budget:{native:number}){
 const name=file.name.toLowerCase();
 if(name.endsWith(".pdf")){
  const task=getDocument({data:file.bytes.slice(),useSystemFonts:true,disableFontFace:true,isEvalSupported:false});const pdf=await task.promise;
  try {
   state.total_pages=pdf.numPages;state.pages??={};state.cursor??=1;
   while(state.cursor<=pdf.numPages&&budget.native>0&&!needsFullOcr(state.pages,pdf.numPages)){const n=state.cursor,page=await pdf.getPage(n),c=await page.getTextContent();const layout=pdfLayout(c.items);const text=clean(layout.text);
    const operators=await page.getOperatorList();const hasImages=operators.fnArray.some((op:number)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op));
    const chars=substantive(text),replacement=(text.match(/\uFFFD/g)||[]).length;const readable=chars>20&&!(hasImages&&chars<120)&&replacement/Math.max(chars,1)<0.05;
    state.pages[n]={...layout,text,has_images:hasImages,method:"PDF_TEXT",readable,reason:readable?null:chars<=20?"NO_OR_SPARSE_TEXT_LAYER":hasImages&&chars<120?"POSSIBLE_SCANNED_PAGE_WITH_HEADER_ONLY":"CORRUPT_TEXT_LAYER"};state.cursor++;budget.native--;page.cleanup();}
   const fullOcr=needsFullOcr(state.pages,pdf.numPages);
   state.done=state.cursor>pdf.numPages||fullOcr;
   if(state.done){
    state.text=Object.keys(state.pages).map(Number).sort((a,b)=>a-b).map(n=>`--- PAGE ${n} ---\n${state.pages[n].text}`).join("\n\n");
    const scanned=Object.keys(state.pages).filter(n=>!state.pages[n].readable);
    state.status=Object.values(state.pages).some((p:any)=>p.readable)?"SUCCESS":"EMPTY";
    state.quality=quality(state.pages,pdf.numPages);
    state.ocr_pages=scanned.map(Number);
    if(fullOcr)state.quality={...state.quality,native_sample_only:true,full_document_ocr_required:true};
    state.error=fullOcr?`OCR_REQUIRED: ${scanned.length} sampled pages are image scans; remaining native pages were not read. Full-document OCR required (${pdf.numPages} total pages).`:scanned.length?`OCR_REQUIRED: ${scanned.length} of ${pdf.numPages} pages have missing, sparse or corrupt text (${scanned.slice(0,40).join(",")}${scanned.length>40?",...":""})`:null;
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

export {files,extractFile,graphToken,driveId,download};
