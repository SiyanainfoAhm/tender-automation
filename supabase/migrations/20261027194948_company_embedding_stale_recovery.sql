CREATE INDEX IF NOT EXISTS agenttender_company_embedding_due_idx
ON public.agenttender_ai_document_chunks(created_at,id)
WHERE is_active AND embedding_local IS NULL AND source_type IN ('COMPANY_DOCUMENT','COMPANY_PROFILE');

-- Split the scope predicates so company work never joins/sorts the tender corpus.
-- Reuse the existing queue and per-chunk leases in the existing worker.
CREATE OR REPLACE FUNCTION public.agenttender_local_embedding_candidates_scoped(p_limit integer DEFAULT 2,p_scope text DEFAULT 'tender')
RETURNS TABLE(id uuid,content text,content_hash text,source_type text)
LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $function$
DECLARE found_count integer; stale record; lease uuid;
BEGIN
 IF p_scope='company' THEN
  -- A terminated Edge invocation cannot report its own failure. Recover only
  -- old queue claims whose existing per-chunk lease can be acquired safely.
  FOR stale IN SELECT q.chunk_id FROM public.agenttender_embedding_queue q
   JOIN public.agenttender_ai_document_chunks c ON c.id=q.chunk_id
   WHERE q.status='processing' AND q.claimed_at<now()-interval '3 minutes'
    AND c.is_active AND c.embedding_local IS NULL
    AND c.source_type IN ('COMPANY_DOCUMENT','COMPANY_PROFILE','SUBMITTED_BID_DOCUMENT','SUBMITTED_BID_CHECKLIST')
   ORDER BY q.claimed_at FOR UPDATE OF q SKIP LOCKED LIMIT 10
  LOOP
   lease:=public.agenttender_claim_embedding_chunk(stale.chunk_id);
   IF lease IS NOT NULL THEN
    PERFORM public.agenttender_embedding_attempt_result(stale.chunk_id,'error','Previous embedding worker expired without reporting completion');
    PERFORM public.agenttender_release_embedding_chunk(stale.chunk_id,lease);
   END IF;
  END LOOP;
  RETURN QUERY SELECT c.id,c.content,c.content_hash,c.source_type
  FROM public.agenttender_ai_document_chunks c
  WHERE c.is_active AND c.embedding_local IS NULL AND c.source_type IN ('COMPANY_DOCUMENT','COMPANY_PROFILE')
   AND length(trim(coalesce(c.content,'')))>0
   AND NOT EXISTS(SELECT 1 FROM public.agenttender_embedding_queue eq WHERE eq.chunk_id=c.id AND
    (eq.status='failed' OR eq.available_at>now() OR (eq.status='processing' AND eq.claimed_at>now()-interval '3 minutes')))
  ORDER BY c.created_at,c.id LIMIT least(greatest(p_limit,1),10);
  GET DIAGNOSTICS found_count=ROW_COUNT;
  IF found_count>0 THEN RETURN; END IF;
  RETURN QUERY SELECT c.id,c.content,c.content_hash,c.source_type
  FROM public.agenttender_ai_document_chunks c
  WHERE c.is_active AND c.embedding_local IS NULL AND c.source_type IN ('SUBMITTED_BID_DOCUMENT','SUBMITTED_BID_CHECKLIST')
   AND length(trim(coalesce(c.content,'')))>0
   AND NOT EXISTS(SELECT 1 FROM public.agenttender_embedding_queue eq WHERE eq.chunk_id=c.id AND
    (eq.status='failed' OR eq.available_at>now() OR (eq.status='processing' AND eq.claimed_at>now()-interval '3 minutes')))
  ORDER BY c.created_at,c.id LIMIT least(greatest(p_limit,1),10);
 ELSIF p_scope='tender' THEN
  RETURN QUERY SELECT c.id,c.content,c.content_hash,c.source_type
  FROM public.agenttender_ai_document_chunks c JOIN public.agenttender_tenders t ON t.id=c.tender_id
  WHERE c.is_active AND c.embedding_local IS NULL AND c.source_type IN ('TENDER_DOCUMENT','AI_SUMMARY') AND t.qualification_status='VERIFY'
   AND length(trim(coalesce(c.content,'')))>0
   AND NOT EXISTS(SELECT 1 FROM public.agenttender_embedding_queue eq WHERE eq.chunk_id=c.id AND
    (eq.status='failed' OR eq.available_at>now() OR (eq.status='processing' AND eq.claimed_at>now()-interval '3 minutes')))
  ORDER BY c.created_at,c.id LIMIT least(greatest(p_limit,1),10);
 END IF;
END $function$;
REVOKE ALL ON FUNCTION public.agenttender_local_embedding_candidates_scoped(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_local_embedding_candidates_scoped(integer,text) TO service_role;
