import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {admin,authorized,checked,clean,substantive,sha,chunks,COMPANY} from "./common.ts";
import {structuredChunks,PARSER_VERSION} from "./structure.ts";
Deno.serve(async(req)=>{
  if(req.method!=="POST")return Response.json({ok:false,error:"POST required"},{status:405});
  try {
    if(!authorized(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
    const sb=admin(),input=await req.json().catch(()=>({}));
    const textOnly=true;
    const limit=Math.min(10,Math.max(1,Number(input.limit)||2));
    const date=String(input.date||"");if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({ok:false,error:"Invalid date"},{status:400});
    const target=input.tender_id?String(input.tender_id):null;
    if(target&&!/^[0-9a-f-]{36}$/i.test(target))return Response.json({error:"Invalid tender_id"},{status:400});
    const rows=target?await checked(sb.from("agenttender_document_extractions").select("scraped_date,source_tender_id,document_kind,file_name,source_url,extracted_text,updated_at").eq("tender_id",target).eq("extraction_status","SUCCESS").limit(250)):await checked(sb.rpc("agenttender_pending_extractions",{p_limit:limit,p_date:date||null}));
    const results:any[]=[];
    const stopAt=Date.now()+50_000;
    for(const x of rows||[]){
      if(Date.now()>stopAt)break;
      const sourceId=`${x.scraped_date}:${x.source_tender_id}:${x.document_kind}:${x.file_name}`;
      const tender=await checked(sb.from("agenttender_tenders").select("id,status,qualification_status,prescreen_status").eq("source_region","INDIAN").eq("scraped_date",x.scraped_date).eq("source_tender_id",x.source_tender_id).limit(1).maybeSingle());
      if(!tender)continue;
      // 2026-10-27: CONDITIONAL_GO and tenders asked about in the chatbot are also indexed.
      const allowed=tender.qualification_status==="GO"||tender.qualification_status==="CONDITIONAL_GO"||(tender.qualification_status==="VERIFY"&&tender.prescreen_status==="NEEDS_DOCUMENTS")||["VERIFY","REVIEW","GO","WILL-BID"].includes(String(tender.status||"").toUpperCase())||!!(await checked(sb.rpc("agenttender_chat_prep_active",{p_tender:tender.id})));
      if(!allowed)continue;
      const docId=String(x.file_name).match(/^sp-([0-9a-f-]{36})-/i)?.[1]||null;
      const listingHtml=/\.html?$/i.test(x.file_name);
      const extraction=await checked(sb.from("agenttender_document_extractions").select("extraction_metadata,extraction_error").eq("scraped_date",x.scraped_date).eq("source_tender_id",x.source_tender_id).eq("document_kind",x.document_kind).eq("file_name",x.file_name).single());
      const text=clean(x.extracted_text||""),pieces=structuredChunks(text,extraction.extraction_metadata||{},extraction.extraction_error);
      // OCR commits already carry accurate page references. Preserve their valid
      // chunks/vectors when a targeted native-parser repair includes them.
      if(extraction.extraction_metadata?.ocr_complete===true){
        const prior=await checked(sb.from('agenttender_ai_document_index_status').select('content_hash,status').eq('source_type','TENDER_DOCUMENT').eq('source_id',sourceId).maybeSingle());
        if(prior?.status==='INDEXED'&&[await sha(text),await sha(PARSER_VERSION+':'+text)].includes(prior.content_hash))continue;
      }
      try {
        const claimed=await checked(sb.rpc("agenttender_claim_extraction_index",{p_tender_id:tender.id,p_source_id:sourceId,p_document_name:x.file_name,p_document_url:x.source_url}));if(!claimed)continue;
        if(substantive(text)<=20||!pieces.length){
          await checked(sb.from("agenttender_document_extractions").update({extraction_status:"EMPTY",extraction_error:"NO_EMBEDDED_TEXT: scanned image pages require OCR",updated_at:new Date().toISOString()}).eq("scraped_date",x.scraped_date).eq("source_tender_id",x.source_tender_id).eq("document_kind",x.document_kind).eq("file_name",x.file_name));
          results.push({tender:x.source_tender_id,status:"NO_EMBEDDED_TEXT"});continue;
        }
        if(pieces.length>1000)throw Error("Document exceeds 1000 chunk processing limit; split document upstream");
        const output:any[]=[];
        for(let i=0;i<pieces.length;i++)output.push({...pieces[i],chunk_index:i,content_hash:await sha(pieces[i].content)});
        const hash=await sha(PARSER_VERSION+":"+text);
        const result=await checked(sb.rpc("agenttender_commit_document_text_chunks",{p_tender_id:tender.id,p_document_id:docId,p_source_id:sourceId,p_document_name:x.file_name,p_document_url:x.source_url,p_document_type:listingHtml?"TENDER_METADATA":x.document_kind==="AI_SUMMARY"?"AI_SUMMARY":(/\.pdf$/i.test(x.file_name)?"pdf":x.document_kind),p_content_hash:hash,p_chunks:output,p_metadata:{scraped_date:x.scraped_date,source_tender_id:x.source_tender_id,document_kind:x.document_kind,tender_document_id:docId,not_rfp:listingHtml,parser:PARSER_VERSION,extraction_quality:extraction.extraction_metadata||{},extraction_warning:extraction.extraction_error,embedding_model:null}}));
        results.push({tender:x.source_tender_id,file:x.file_name,chunks:result,status:textOnly?"TEXT_INDEXED":"INDEXED"});
      }catch(e){
        const message=e instanceof Error?e.message:String(e);
        await checked(sb.from("agenttender_ai_document_index_status").upsert({company_id:COMPANY,tender_id:tender.id,source_type:"TENDER_DOCUMENT",source_id:sourceId,document_name:x.file_name,document_url:x.source_url,status:"INDEX_FAILED",last_attempted_at:new Date().toISOString(),error_message:message,updated_at:new Date().toISOString()},{onConflict:"source_type,source_id"}));
        console.error(JSON.stringify({stage:"index",tender:x.source_tender_id,error:message}));results.push({tender:x.source_tender_id,status:"INDEX_FAILED",error:message});
      }
    }
    await checked(sb.rpc("agenttender_refresh_ingestion_readiness"));
    const failed=results.filter(x=>x.status==="INDEX_FAILED").length;
    return Response.json({ok:failed===0,processed:results.length,failed,results},{status:failed?207:200});
  }catch(e){console.error(e);return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}
});
