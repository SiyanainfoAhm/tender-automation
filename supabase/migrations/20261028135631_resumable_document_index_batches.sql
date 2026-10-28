CREATE OR REPLACE FUNCTION public.agenttender_commit_document_text_batch(p_tender uuid,p_document uuid,p_source text,p_name text,p_url text,p_hash text,p_total integer,p_chunks jsonb,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog','public','extensions' AS $fn$
DECLARE company uuid; n integer; doc_type text; current_text text; expected_hash text;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_source,0));
 SELECT d.company_id,e.extracted_text INTO company,current_text FROM public.agenttender_tender_documents d JOIN public.agenttender_document_extractions e ON e.document_id=d.id AND e.tender_id=d.tender_id
 WHERE d.id=p_document AND d.tender_id=p_tender AND e.extraction_status='SUCCESS' AND e.file_name=p_name ORDER BY e.updated_at DESC LIMIT 1;
 IF company IS DISTINCT FROM 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid THEN RAISE EXCEPTION 'Document scope mismatch'; END IF;
 expected_hash:=encode(extensions.digest(convert_to(btrim(regexp_replace(current_text,E'[ \\t]+\\n',E'\\n','g'),E' \\t\\r\\n'),'UTF8'),'sha256'),'hex');
 IF expected_hash<>p_hash THEN RAISE EXCEPTION 'Source revision changed'; END IF;
 IF p_total<1 OR jsonb_typeof(p_chunks)<>'array' OR jsonb_array_length(p_chunks)>100 THEN RAISE EXCEPTION 'Invalid index batch'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_chunks) x WHERE (x->>'chunk_index')::integer<0 OR (x->>'chunk_index')::integer>=p_total OR length(regexp_replace(x->>'content','--- PAGE [0-9]+ ---|-- [0-9]+ of [0-9]+ --|[[:space:]]','','g'))<=20) THEN RAISE EXCEPTION 'Invalid or non-substantive chunk'; END IF;
 IF EXISTS(SELECT 1 FROM public.agenttender_ai_document_index_status WHERE source_type='TENDER_DOCUMENT' AND source_id=p_source AND content_hash=p_hash AND status='INDEXED' AND chunk_count=p_total) THEN RETURN jsonb_build_object('complete',true,'cursor',p_total); END IF;
 INSERT INTO public.agenttender_ai_document_chunks(company_id,tender_id,source_type,source_id,document_name,document_url,document_type,page_number,page_start,page_end,section,chunk_index,content,content_hash,metadata,is_active)
 SELECT company,p_tender,'TENDER_DOCUMENT',p_source,p_name,p_url,'pdf',(v->>'page_number')::int,(v->>'page_start')::int,(v->>'page_end')::int,v->>'section',(v->>'chunk_index')::int,v->>'content',v->>'content_hash',p_metadata||coalesce(v->'metadata','{}')||jsonb_build_object('content_revision_hash',p_hash),false
 FROM jsonb_array_elements(p_chunks) v WHERE NOT EXISTS(SELECT 1 FROM public.agenttender_ai_document_chunks c WHERE c.tender_id=p_tender AND c.source_type='TENDER_DOCUMENT' AND c.source_id=p_source AND c.metadata->>'content_revision_hash'=p_hash AND c.chunk_index=(v->>'chunk_index')::int);
 SELECT count(DISTINCT chunk_index) INTO n FROM public.agenttender_ai_document_chunks WHERE tender_id=p_tender AND source_type='TENDER_DOCUMENT' AND source_id=p_source AND metadata->>'content_revision_hash'=p_hash;
 IF n=p_total AND (SELECT min(chunk_index)=0 AND max(chunk_index)=p_total-1 FROM public.agenttender_ai_document_chunks WHERE tender_id=p_tender AND source_type='TENDER_DOCUMENT' AND source_id=p_source AND metadata->>'content_revision_hash'=p_hash) THEN
  UPDATE public.agenttender_ai_document_chunks SET is_active=false WHERE tender_id=p_tender AND source_type='TENDER_DOCUMENT' AND source_id=p_source AND is_active;
  UPDATE public.agenttender_ai_document_chunks SET is_active=true WHERE tender_id=p_tender AND source_type='TENDER_DOCUMENT' AND source_id=p_source AND metadata->>'content_revision_hash'=p_hash;
 END IF;
 INSERT INTO public.agenttender_ai_document_index_status(company_id,tender_id,source_type,source_id,document_name,document_url,content_hash,status,chunk_count,last_indexed_at,last_attempted_at,error_message,updated_at)
 VALUES(company,p_tender,'TENDER_DOCUMENT',p_source,p_name,p_url,p_hash,CASE WHEN n=p_total THEN 'INDEXED' ELSE 'INDEXING' END,n,CASE WHEN n=p_total THEN now() END,now(),null,now())
 ON CONFLICT(source_type,source_id) DO UPDATE SET content_hash=excluded.content_hash,status=excluded.status,chunk_count=n,last_indexed_at=excluded.last_indexed_at,last_attempted_at=now(),error_message=null,updated_at=now();
 RETURN jsonb_build_object('complete',n=p_total,'cursor',n);
END $fn$;
REVOKE ALL ON FUNCTION public.agenttender_commit_document_text_batch(uuid,uuid,text,text,text,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_commit_document_text_batch(uuid,uuid,text,text,text,text,integer,jsonb,jsonb) TO service_role;


