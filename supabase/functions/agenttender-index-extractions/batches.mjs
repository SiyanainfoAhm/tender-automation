export function compactChunks(pieces){
 return pieces.filter(p=>String(p.content||'').replace(/--- PAGE [0-9]+ ---|-- [0-9]+ of [0-9]+ --|\s/g,'').length>20).map((p,i)=>{
  const quality=p.metadata?.extraction_quality||{};const {pages,...summary}=quality;
  return {...p,chunk_index:i,metadata:{...p.metadata,extraction_quality:summary}};
 });
}
export async function commitBatches(db,payload,maxBatches=2){
 const {data:s,error}=await db.from('agenttender_ai_document_index_status').select('status,content_hash,chunk_count').eq('source_type','TENDER_DOCUMENT').eq('source_id',payload.p_source).maybeSingle();if(error)throw error;
 let cursor=s?.content_hash===payload.p_hash?Number(s.chunk_count||0):0;
 if(s?.status==='INDEXED'&&s.content_hash===payload.p_hash&&cursor===payload.p_total)return {complete:true,cursor};
 const chunks=payload.p_chunks;let result={complete:false,cursor};
 for(let i=0;i<maxBatches&&cursor<chunks.length;i++){
  const {data,error}=await db.rpc('agenttender_commit_document_text_batch',{...payload,p_chunks:chunks.slice(cursor,cursor+100)});if(error)throw error;
  result=data;cursor=data.cursor;
 }
 return result;
}
