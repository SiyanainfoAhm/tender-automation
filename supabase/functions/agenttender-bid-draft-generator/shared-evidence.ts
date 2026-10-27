const ok=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data};
export async function groundedEvidence(db:any,i:any){
 const tokens=[...new Set(String([i.requirement_name,i.document_type,i.description].join(' ')).toLowerCase().match(/[a-z][a-z0-9]{2,}/g)||[])].filter(x=>!['the','and','for','with','from','that','this','shall','must','document','documents','bidder','required','requirement','submit','submission','copy','copies'].includes(x)).slice(0,24);
 const query=tokens.map(x=>'"'+x+'"').join(' OR ')||'company';
 const matches=ok(await db.rpc('agenttender_match_company_chunks_fts',{p_company_id:i.company_id,p_query:query,p_match_count:32}))||[];
 const core=ok(await db.from('agenttender_ai_document_chunks').select('id,source_id,document_name,content,page_number').eq('company_id',i.company_id).is('tender_id',null).eq('is_active',true).in('source_type',['COMPANY_DOCUMENT','COMPANY_PROFILE']).or('document_name.ilike.%SiyanaBR%,document_name.ilike.%Incorporation%,document_name.ilike.%GST%,document_name.ilike.%Manpower%').order('chunk_index').limit(24))||[];
 const {data:learning,error:learningError}=await db.rpc('agenttender_learning_context',{p_company_id:i.company_id,p_tender_id:i.tender_id});
 if(learningError)throw Error('VERIFIED_LEARNING_UNAVAILABLE: '+learningError.message);
 const ids=[...new Set((learning?.company_evidence_intelligence||[]).filter((k:any)=>k.source_table==='agenttender_ai_company_facts').flatMap((k:any)=>k.content.evidence_document_ids||[]))] as string[];
 const learned=ids.length?(ok(await db.from('agenttender_ai_document_chunks').select('id,source_id,document_name,content,page_number').eq('company_id',i.company_id).eq('source_type','COMPANY_DOCUMENT').eq('is_active',true).in('source_id',ids).limit(24))||[]):[];
 const seen=new Set();return [...matches,...core,...learned].filter((x:any)=>{if(seen.has(x.id)||String(x.content||'').startsWith('[METADATA ONLY'))return false;seen.add(x.id);return true;});
}

