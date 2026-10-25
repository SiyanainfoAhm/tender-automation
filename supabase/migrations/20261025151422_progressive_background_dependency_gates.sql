-- Reuse background workers, but V2 must explicitly request evidence before ingestion.
CREATE OR REPLACE FUNCTION public.agenttender_claim_sharepoint_ingestion(p_limit integer DEFAULT 1)
 RETURNS TABLE(document_id uuid, tender_id uuid, company_id uuid, file_name text, storage_url text, sharepoint_item_id text, scraped_date date, source_tender_id text, lease_token uuid, progress jsonb, attempt_count integer, failure_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
 UPDATE public.agenttender_document_ingestion_jobs j
 SET status=CASE WHEN j.failure_count+1>=8 THEN 'FAILED' ELSE 'RETRY' END,
     failure_count=j.failure_count+1,
     last_error='Worker lease expired; previous invocation may have exceeded resource limits',
     lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '5 minutes',updated_at=now()
 WHERE j.status='PROCESSING' AND j.lease_expires_at<now();

 INSERT INTO public.agenttender_document_ingestion_jobs AS j(document_id,tender_id,company_id,source_updated_at)
 SELECT d.id,d.tender_id,d.company_id,d.updated_at
 FROM public.agenttender_tender_documents d
 JOIN public.agenttender_tenders t ON t.id=d.tender_id
 WHERE d.company_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890'
   AND t.source_region='INDIAN'
   AND (t.qualification_status IN ('VERIFY','GO') OR lower(coalesce(t.status,''))='will-bid')
   AND t.duplicate_of_tender_id IS NULL
   AND d.storage_provider='sharepoint' AND d.storage_status='COMPLETED' AND d.storage_url IS NOT NULL
   AND t.scraped_date IS NOT NULL
 ON CONFLICT ON CONSTRAINT agenttender_document_ingestion_jobs_pkey DO UPDATE
 SET status='PENDING',progress='{}',failure_count=0,next_attempt_at=now(),
     source_updated_at=excluded.source_updated_at,updated_at=now()
 WHERE j.source_updated_at<excluded.source_updated_at AND (j.lease_expires_at IS NULL OR j.lease_expires_at<now());

 RETURN QUERY
 WITH due AS (
  SELECT j.document_id
  FROM public.agenttender_document_ingestion_jobs j
  JOIN public.agenttender_tenders t ON t.id=j.tender_id
  WHERE (t.qualification_status IN ('VERIFY','GO') OR lower(coalesce(t.status,''))='will-bid') AND t.source_region='INDIAN'
    AND ((j.status IN ('PENDING','RETRY','OCR_PENDING') AND j.next_attempt_at<=now())
         OR (j.status='PROCESSING' AND j.lease_expires_at<now()))
    AND (t.qualification_status='GO'
     OR NOT EXISTS(SELECT 1 FROM public.agenttender_tender_route_assignments a WHERE a.tender_id=j.tender_id AND a.route='ORCHESTRATOR')
     OR EXISTS(SELECT 1 FROM public.agenttender_orch_v2_tasks q WHERE q.tender_id=j.tender_id
       AND jsonb_array_length(coalesce(q.checkpoint#>'{progressive_evidence_request,questions}','[]'))>0
       AND (q.checkpoint#>>'{progressive_evidence_request,selected_document_id}'=j.document_id::text
         OR (q.checkpoint#>>'{progressive_evidence_request,selected_document_id}' IS NULL AND EXISTS(
           SELECT 1 FROM public.agenttender_document_acquisition_jobs ac WHERE ac.tender_id=j.tender_id AND ac.document_id=j.document_id)))))
    AND j.failure_count<8
  ORDER BY j.next_attempt_at,j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT least(greatest(p_limit,1),3)
 ), claimed AS (
  UPDATE public.agenttender_document_ingestion_jobs j
  SET status='PROCESSING',attempt_count=j.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '4 minutes',updated_at=now()
  FROM due WHERE j.document_id=due.document_id
  RETURNING j.*
 )
 SELECT j.document_id,j.tender_id,j.company_id,d.file_name,d.storage_url,d.sharepoint_drive_item_id,
        t.scraped_date,t.source_tender_id,j.lease_token,j.progress,j.attempt_count,j.failure_count
 FROM claimed j
 JOIN public.agenttender_tender_documents d ON d.id=j.document_id
 JOIN public.agenttender_tenders t ON t.id=j.tender_id;
END
$function$

;
CREATE OR REPLACE FUNCTION public.agenttender_pending_extractions(p_limit integer DEFAULT 100, p_date date DEFAULT NULL::date)
 RETURNS TABLE(scraped_date date, source_tender_id text, document_kind text, file_name text, source_url text, extracted_text text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select e.scraped_date,e.source_tender_id,e.document_kind,e.file_name,e.source_url,e.extracted_text,e.updated_at from public.agenttender_document_extractions e join public.agenttender_tenders t on t.scraped_date=e.scraped_date and t.source_tender_id=e.source_tender_id left join public.agenttender_ai_document_index_status s on s.source_type='TENDER_DOCUMENT' and s.source_id=e.scraped_date::text||':'||e.source_tender_id||':'||e.document_kind||':'||e.file_name where t.source_region='INDIAN' and (t.qualification_status='GO' OR (t.qualification_status='VERIFY' AND t.prescreen_status='NEEDS_DOCUMENTS') OR lower(coalesce(t.status,''))='will-bid') and lower(coalesce(t.status,'')) not in ('submitted') and NOT (t.qualification_status='VERIFY' AND EXISTS(SELECT 1 FROM public.agenttender_tender_route_assignments a WHERE a.tender_id=t.id AND a.route='ORCHESTRATOR')) and e.extraction_status='SUCCESS' and length(coalesce(e.extracted_text,''))>0 and (p_date is null or e.scraped_date=p_date) and (s.source_id is null or s.status<>'INDEXED' or s.last_indexed_at is null or e.updated_at>s.last_indexed_at) and (s.status is distinct from 'INDEX_FAILED' or s.last_attempted_at is null or s.last_attempted_at<now()-interval '15 minutes' or e.updated_at>s.last_attempted_at) order by s.last_attempted_at nulls first,e.updated_at limit least(greatest(p_limit,1),250) $function$

;
