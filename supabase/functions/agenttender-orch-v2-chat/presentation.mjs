function safeDocumentName(value) {
 let name=String(value||"Source document").replace(/[\r\n\[\]]/g," ").trim();
 name=name.split(/[\/\\]/).filter(Boolean).at(-1)||"Source document";
 name=name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_ ]*/i,"");
 name=name.replace(/^[0-9a-f]{24,}[-_ ]*/i,"");
 name=name.replace(/\s+/g," ").trim();
 return name||"Source document";
}
function readableCitation(source) {
 const parts=[safeDocumentName(source.document)];
 if(source.section)parts.push(String(source.section).replace(/[\r\n\[\]]/g," ").trim().slice(0,90));
 const base=parts.join(" — ");
 return " *(Source: "+base+(source.page!=null?", p. "+String(source.page):"")+")*";
}
function scrubInternalArtifacts(value) {
 return String(value||"").replace(/Some cited references could not be verified\./gi,"")
  .replace(/\b[RCHP]\d+\s*[–-]\s*[RCHP]?\d+\b/gi,"")
  .replace(/\b[RCHP]\d+\b/gi,"")
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,"")
  .replace(/\b(?:agenttender_[a-z0-9_]+|orchestrator[_ -]?step[_ -]?\w+)\b/gi,"")
  .replace(/\b(?:raw\s+)?uuid\b/gi,"")
  .replace(/([.!?])\s*[.!?]+/g,"$1")
  .replace(/\[\s*(?:citation unavailable|source unavailable)\s*\]/gi,"")
  .replace(/[ \t]{2,}/g," ")
  .replace(/\n{3,}/g,"\n\n")
  .trim();
}
export function presentAnswer(parsed,sources,context) {
 const original=String(parsed.answer||"");
 const byRef=new Map(sources.map(s=>[String(s.ref).toUpperCase(),s]));
 const used=[...new Set((original.match(/\b[RCHP]\d+\b/gi)||[]).map(v=>v.toUpperCase()))].filter(v=>byRef.has(v));
 let answer=scrubInternalArtifacts(original.replace(/\[([RCHP]\d+)\]/gi,(_,id)=>{
  const source=byRef.get(id.toUpperCase());
  return source?readableCitation(source):'';
 }));
 const trace={response_trace_version:"sources-only-v5",route:"ORCHESTRATOR_V2_LIGHT_CHAT",...context,result:parsed.result,evidence_state:parsed.evidence_state,sources_used:sources.filter(s=>used.includes(String(s.ref).toUpperCase())).map(s=>({ref:s.ref,document:s.document,page:s.page??null,section:s.section??null,source_type:s.source_type,chunk_id:s.chunk_id??null,document_url:s.document_url??null,source_id:s.source_id??null})),supplied_source_count:sources.length,citation_validation:original.includes("[citation unavailable]")?"INVALID_REFERENCE":used.length?"REFERENCE_IDS_VALID_NOT_CLAIM_VERIFICATION":"NO_CITATIONS",orchestration_steps_run:0,changed_business_statuses:0};
 return {answer,response_trace:trace};
}
