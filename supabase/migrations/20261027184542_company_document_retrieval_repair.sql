-- Preserve the existing RPC contracts. These are internal service-role APIs.
CREATE OR REPLACE FUNCTION public.agenttender_match_company_chunks_fts(p_company_id uuid, p_query text, p_match_count integer DEFAULT 12)
RETURNS TABLE(id uuid, company_id uuid, tender_id uuid, source_type text, source_id text, document_name text, document_url text, document_type text, page_number integer, section text, chunk_index integer, content text, content_hash text, metadata jsonb, fts_rank double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, extensions AS $function$
WITH q AS (SELECT websearch_to_tsquery('english',coalesce(nullif(trim(p_query),''),'company')) tsq),
base AS (
 SELECT c.*,d.name current_name,d.storage_url current_url,
 jsonb_build_object('company_name',co.name,'original_file_name',d.original_file_name,'document_category',d.document_category,'document_type',d.document_type,'certificate_type',d.certificate_type,'financial_year',d.financial_year,'issue_date',d.issue_date,'expiry_date',d.expiry_date,'verification_status',d.verification_status,'extraction_status',t.extraction_status,'source_fingerprint',t.source_fingerprint) current_metadata,
 to_tsvector('english',concat_ws(' ',d.name,d.original_file_name,co.name,d.document_category,d.document_type,d.certificate_type,d.financial_year,d.issue_date,d.expiry_date,d.verification_status)) meta_tsv
 FROM public.agenttender_ai_document_chunks c
 JOIN public.agenttender_company_documents d ON d.id::text=c.source_id AND d.company_id=c.company_id
 JOIN public.agenttender_companies co ON co.id=d.company_id
 JOIN public.agenttender_company_document_texts t ON t.document_id=d.id AND t.company_id=d.company_id
 WHERE c.company_id=p_company_id AND c.source_type='COMPANY_DOCUMENT' AND c.tender_id IS NULL AND c.is_active
 AND d.status='active' AND d.ai_index_enabled IS NOT FALSE
 AND coalesce(d.verification_status,'pending') NOT IN ('rejected','invalid')
 AND t.extraction_status IN ('READY','PARTIAL')
 AND coalesce(t.source_metadata->>'evidence_role','COMPANY_DOCUMENT')='COMPANY_DOCUMENT'
 AND t.source_fingerprint=public.agenttender_company_source_fingerprint(d)
 AND (c.metadata->>'source_fingerprint' IS NULL OR c.metadata->>'source_fingerprint'=t.source_fingerprint)
 AND nullif(trim(c.content),'') IS NOT NULL
), ranked AS (
 SELECT b.*, (ts_rank_cd(b.content_tsv,q.tsq)+2*ts_rank_cd(b.meta_tsv,q.tsq))::double precision rank
 FROM base b CROSS JOIN q WHERE b.content_tsv@@q.tsq OR b.meta_tsv@@q.tsq
), diverse AS (
 SELECT r.*,row_number() OVER (PARTITION BY r.source_id ORDER BY r.rank DESC,r.chunk_index,r.id) doc_rank FROM ranked r
)
SELECT b.id,b.company_id,b.tender_id,b.source_type,b.source_id,b.current_name,b.current_url,b.document_type,b.page_number,b.section,b.chunk_index,b.content,b.content_hash,coalesce(b.metadata,'{}')||b.current_metadata,b.rank
FROM diverse b WHERE b.doc_rank<=3 ORDER BY b.doc_rank,b.rank DESC,b.id
LIMIT greatest(1,least(coalesce(p_match_count,12),64));
$function$;
REVOKE ALL ON FUNCTION public.agenttender_match_company_chunks_fts(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_match_company_chunks_fts(uuid,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.agenttender_match_company_evidence(p_company_id uuid,p_query_embedding vector,p_query_text text DEFAULT NULL,p_valid_on date DEFAULT CURRENT_DATE,p_match_count integer DEFAULT 8,p_min_similarity double precision DEFAULT 0.70)
RETURNS TABLE(chunk_id uuid,document_id text,document_name text,document_url text,page_start integer,page_end integer,content text,similarity double precision,fts_rank double precision,score double precision,expiry_date date,document_category text,certificate_type text,financial_year text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,extensions AS $function$
WITH eligible AS (
 SELECT c.*,d.name current_name,d.storage_url current_url,d.expiry_date current_expiry,d.document_category current_category,d.certificate_type current_certificate,d.financial_year current_year
 FROM public.agenttender_ai_document_chunks c
 JOIN public.agenttender_company_documents d ON d.id::text=c.source_id AND d.company_id=c.company_id
 JOIN public.agenttender_company_document_texts t ON t.document_id=d.id AND t.company_id=d.company_id
 WHERE c.is_active AND c.company_id=p_company_id AND c.tender_id IS NULL AND c.source_type='COMPANY_DOCUMENT'
 AND d.status='active' AND d.ai_index_enabled IS NOT FALSE
 AND coalesce(d.verification_status,'pending') NOT IN ('rejected','invalid')
 AND (d.expiry_date IS NULL OR d.expiry_date>=coalesce(p_valid_on,current_date))
 AND t.extraction_status IN ('READY','PARTIAL')
 AND coalesce(t.source_metadata->>'evidence_role','COMPANY_DOCUMENT')='COMPANY_DOCUMENT'
 AND t.source_fingerprint=public.agenttender_company_source_fingerprint(d)
 AND (c.metadata->>'source_fingerprint' IS NULL OR c.metadata->>'source_fingerprint'=t.source_fingerprint)
), lexical AS (
 SELECT f.id,f.fts_rank,row_number() OVER(ORDER BY f.fts_rank DESC,f.id) r
 FROM public.agenttender_match_company_chunks_fts(p_company_id,p_query_text,64) f JOIN eligible e ON e.id=f.id
), vec0 AS (
 SELECT e.id,max(1-(p.embedding<=>p_query_embedding)) sim
 FROM eligible e JOIN public.agenttender_local_embedding_parts p ON p.chunk_id=e.id AND p.content_hash=e.content_hash
 WHERE p_query_embedding IS NOT NULL GROUP BY e.id
 HAVING max(1-(p.embedding<=>p_query_embedding))>=p_min_similarity
 ORDER BY sim DESC LIMIT 64
), vec AS (SELECT *,row_number() OVER(ORDER BY sim DESC,id) r FROM vec0),
fused AS (
 SELECT coalesce(l.id,v.id) id,l.fts_rank,v.sim,
 (coalesce(1.0/(60+l.r),0)+coalesce(1.0/(60+v.r),0))::double precision score
 FROM lexical l FULL JOIN vec v ON v.id=l.id
), candidates AS (
 SELECT e.*,f.sim,f.fts_rank,f.score,row_number() OVER(PARTITION BY e.source_id ORDER BY f.score DESC,e.chunk_index,e.id) doc_rank
 FROM fused f JOIN eligible e ON e.id=f.id
)
SELECT c.id,c.source_id,c.current_name,c.current_url,c.page_start,c.page_end,c.content,c.sim,c.fts_rank,c.score,c.current_expiry,c.current_category,c.current_certificate,c.current_year
FROM candidates c WHERE c.doc_rank<=3 ORDER BY c.doc_rank,c.score DESC,c.id
LIMIT greatest(1,least(coalesce(p_match_count,8),64));
$function$;
REVOKE ALL ON FUNCTION public.agenttender_match_company_evidence(uuid,vector,text,date,integer,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_match_company_evidence(uuid,vector,text,date,integer,double precision) TO service_role;
