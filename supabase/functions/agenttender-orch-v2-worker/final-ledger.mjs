const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
export function finalEvidenceLedger(documents,stage3){
 const sources=new Map((stage3?.evidence_sources||[]).map(s=>[s.ref,s]));
 const records=new Map(documents.map(d=>[d.document_id,{chunk_id:'EXTRACTED:'+d.document_id,document_name:d.file_name,quotes:[]}]));
 const gaps=[];
 for(const item of [...(stage3?.assessment?.requirements||[]),...(stage3?.assessment?.evidence||[])]){
  const source=sources.get(item.ref);if(!source?.document_id)continue;
  const doc=documents.find(d=>d.document_id===source.document_id);
  if(!doc||!norm(doc.extracted_text).includes(norm(item.quote))){gaps.push({ref:item.ref,reason:'SOURCE_CLAUSE_CHANGED'});continue;}
  records.get(doc.document_id).quotes.push(item.quote);
 }
 return {originals:[...records.values()].map(r=>({...r,text:[...new Set(r.quotes)].join('\n'),quotes:undefined,coverage:'VALIDATED_FULL_REVIEW_CLAUSE_LEDGER'})),coverage:{...stage3?.coverage,gaps:[...(stage3?.coverage?.gaps||[]),...gaps],complete:stage3?.coverage?.complete===true&&gaps.length===0}};
}

