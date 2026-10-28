CREATE OR REPLACE FUNCTION agenttender_internal.wake_v2_step3_dependency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE tid uuid; changed boolean:=true;
BEGIN
 IF TG_TABLE_NAME='agenttender_tenders' THEN tid:=new.id; ELSE tid:=new.tender_id; END IF;
 IF TG_TABLE_NAME='agenttender_ai_document_chunks' THEN
  -- Vector completion changes readiness, not source evidence or clause coverage.
  IF new.is_active AND new.embedding_local IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.agenttender_ai_document_chunks c WHERE c.tender_id=tid AND c.is_active AND c.source_type='TENDER_DOCUMENT' AND c.embedding_local IS NULL
  ) THEN
   UPDATE public.agenttender_orch_v2_tasks SET ready_at=now(),updated_at=now()
   WHERE tender_id=tid AND step IN (3,5) AND state IN ('WAITING','RETRY') AND coalesce(last_error,'') ~ 'EMBEDDING_REQUIRED|INDEXING_REQUIRED';
  END IF;
  RETURN new;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='agenttender_document_extractions' THEN
   changed:=(new.extracted_text,new.extraction_status,new.document_id,new.tender_id,new.extraction_metadata)
    IS DISTINCT FROM (old.extracted_text,old.extraction_status,old.document_id,old.tender_id,old.extraction_metadata);
  ELSIF TG_TABLE_NAME='agenttender_tender_documents' THEN
   changed:=(new.storage_status,new.sharepoint_drive_item_id,new.storage_url,new.file_name,new.tender_id,new.company_id)
    IS DISTINCT FROM (old.storage_status,old.sharepoint_drive_item_id,old.storage_url,old.file_name,old.tender_id,old.company_id);
  ELSIF TG_TABLE_NAME='agenttender_tenders' THEN
   changed:=(new.title,new.description,new.documents_zip_url,new.document_urls,new.ai_summary_url,new.content_hash) IS DISTINCT FROM (old.title,old.description,old.documents_zip_url,old.document_urls,old.ai_summary_url,old.content_hash);
  ELSE changed:=new.status IS DISTINCT FROM old.status AND new.status IN ('COMPLETED','EXTRACTED','INDEXED'); END IF;
 END IF;
 IF NOT changed OR tid IS NULL THEN RETURN new; END IF;
 UPDATE public.agenttender_ai_stage_cache SET expires_at=least(expires_at,now()) WHERE tender_id=tid AND expires_at>now();
 WITH resumed AS (
  UPDATE public.agenttender_orch_v2_tasks q SET step=3,state='WAITING',ready_at=now(),lease_token=null,leased_until=null,
   checkpoint=(q.checkpoint-'step3_screen_cache'-'step3_coverage'-'3'-'4'-'5'-'6')||jsonb_build_object('dependency_change',jsonb_build_object('table',TG_TABLE_NAME,'at',now(),'reason','SOURCE_REVISION_CHANGED')),
   updated_at=now()
  FROM public.agenttender_tenders t WHERE q.tender_id=tid AND t.id=q.tender_id AND q.step BETWEEN 3 AND 6 AND q.state<>'DONE'
   AND t.qualification_status IN ('VERIFY','REVIEW') AND coalesce(lower(t.decision_source),'') NOT LIKE '%manual%'
   AND upper(coalesce(t.status,'')) NOT IN ('GO','WILL_BID','WILL-BID','SUBMITTED','WON','UNDER_EVALUATION')
  RETURNING q.tender_id
 ) INSERT INTO public.agenttender_orch_v2_events(tender_id,step,event_type,details)
 SELECT tender_id,3,'DEPENDENCY_CHANGED',jsonb_build_object('table',TG_TABLE_NAME,'automatic_resume',true,'failures_preserved',true) FROM resumed;
 RETURN new;
END $function$;
