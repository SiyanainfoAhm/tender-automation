
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {admin,authorized,checked,sha,COMPANY} from "./common.ts";
import {files,extractFile,graphToken,driveId,download} from "./extractor.ts";
import {structuredChunks,packCompanyChunks,PARSER_VERSION} from "./structure.ts";
Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({ok:false,error:"POST required"},{status:405});
 try{
  if(!authorized(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const input=await req.json().catch(()=>({})),sb=admin();
  const token=await graphToken(),drive=await driveId(token);
  const jobs:any[]=await checked(sb.rpc("agenttender_claim_company_text",{p_company_id:COMPANY,p_limit:1}));
  const results:any[]=[];const budget={native:5};
  for(const d of jobs){
   const progress=d.progress||{};progress.files??={};
   const save=async(values:any)=>{
    const rows=await checked(sb.from("agenttender_company_document_texts").update({...values,lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq("document_id",d.document_id).eq("lease_token",d.lease_token).select("document_id"));
    if(!rows?.length)throw Error("Document lease lost");
   };
   try{
    if(Number(d.file_size_bytes)>18_000_000)throw Error("DOCUMENT_TOO_LARGE: exceeds 18MB native extraction limit");
    const bytes=await download(d,token,drive);
    const filename=d.original_file_name||decodeURIComponent(new URL(d.storage_url).pathname.split("/").at(-1)!)||d.name;
    const members=files(filename,bytes);
    for(const m of members){
     const state=progress.files[m.name]??={};
     if(!state.done){
      if(/\.(png|jpe?g|tiff?|bmp|webp)$/i.test(m.name)){Object.assign(state,{done:true,status:"EMPTY",text:"",error:"OCR_REQUIRED: image file",quality:{parser:PARSER_VERSION,completeness:"partial",image_only:true}});}
      else try{await extractFile(m,state,budget);}catch(e){Object.assign(state,{done:true,status:"FAILED",text:"",error:e instanceof Error?e.message:String(e)});}
     }
     if(budget.native<=0)break;
    }
    if(!members.every(m=>progress.files[m.name]?.done)){
     await save({extraction_status:"PENDING",progress,next_attempt_at:new Date(Date.now()+1000).toISOString(),last_error:null});
     results.push({document_id:d.document_id,status:"IN_PROGRESS"});continue;
    }
    const pieces:any[]=[],texts:string[]=[],qualityMembers:any[]=[];
    for(const m of members){
     const state=progress.files[m.name];
     const q=state.quality||{parser:PARSER_VERSION,format:m.name.split(".").at(-1),completeness:state.status==="SUCCESS"?"native_text_unverified":"partial"};
     qualityMembers.push({member_name:m.name,status:state.status,error:state.error||null,quality:q});
     if(state.text)texts.push("--- FILE "+m.name+" ---\n"+state.text);
     if(state.status!=="SUCCESS")continue;
     const cp=packCompanyChunks(structuredChunks(state.text,q,state.error||null));
     for(let i=0;i<cp.length;i++)pieces.push({...cp[i],member_name:m.name,chunk_index:i,content_hash:await sha(cp[i].content),metadata:{...cp[i].metadata,company_document_id:d.document_id,source_url:d.storage_url,document_category:d.document_category,verification_status:d.verification_status,financial_year:d.financial_year,credential_verified:false}});
    }
    if(pieces.length>3000)throw Error("CHUNK_RESOURCE_LIMIT: document exceeds 3000 chunks");
    const issues=qualityMembers.filter(m=>m.error||m.status!=="SUCCESS");
    const hasText=pieces.length>0;
    const status=hasText?(issues.length?"PARTIAL":"READY"):qualityMembers.some(m=>m.status==="EMPTY")?"OCR_REQUIRED":qualityMembers.every(m=>m.status==="UNSUPPORTED")?"UNSUPPORTED":"FAILED";
    const text=texts.join("\n\n");
    if(text.length>5_000_000)throw Error("TEXT_RESOURCE_LIMIT: exceeds 5M characters");
    const metadata={parser:PARSER_VERSION,method:"native-code-no-ai",members:qualityMembers,warning:issues.map(m=>m.member_name+": "+(m.error||m.status)).join("; ").slice(0,8000)||null,credential_verification:"Source documents are not automatically verified"};
    const count=await checked(sb.rpc("agenttender_commit_company_text",{p_document_id:d.document_id,p_lease_token:d.lease_token,p_source_fingerprint:d.source_fingerprint,p_text:text||null,p_hash:await sha(text),p_status:status,p_metadata:metadata,p_chunks:pieces}));
    results.push({document_id:d.document_id,name:d.name,status,chunks:count,chars:text.length});
   }catch(e){
    const message=e instanceof Error?e.message:String(e);
    const resource=/DOCUMENT_TOO_LARGE|ARCHIVE_RESOURCE_LIMIT|CHUNK_RESOURCE_LIMIT|TEXT_RESOURCE_LIMIT/.test(message),fails=Number(d.failure_count||0)+1;
    await save({extraction_status:resource?"RESOURCE_LIMIT":fails>=3?"FAILED":"RETRY",failure_count:fails,progress:resource?{}:progress,last_error:message,next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**(fails-1))).toISOString()});
    results.push({document_id:d.document_id,status:resource?"RESOURCE_LIMIT":"ERROR",error:message});
   }
  }
  return Response.json({ok:!results.some(r=>r.status==="ERROR"),processed:results.length,results});
 }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}
});
