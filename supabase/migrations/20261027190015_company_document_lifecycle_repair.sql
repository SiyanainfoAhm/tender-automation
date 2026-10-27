-- Enqueue in the existing extraction state table; never create a second queue.
CREATE OR REPLACE FUNCTION public.agenttender_company_document_index_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $function$
DECLARE v_role text; v_status text; v_fingerprint text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.storage_url,NEW.storage_blob_name,NEW.content_hash,NEW.file_size_bytes,NEW.status,NEW.ai_index_enabled,NEW.use_as_company_evidence,NEW.company_id)
 IS NOT DISTINCT FROM (OLD.storage_url,OLD.storage_blob_name,OLD.content_hash,OLD.file_size_bytes,OLD.status,OLD.ai_index_enabled,OLD.use_as_company_evidence,OLD.company_id) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'Document company ownership cannot be reassigned'; END IF;
 v_role:=CASE WHEN (coalesce(NEW.storage_url,'') ILIKE '%/tender-artifacts/%' OR coalesce(NEW.storage_blob_name,'') ILIKE '%/tender-artifacts/%') AND NOT NEW.use_as_company_evidence THEN 'TENDER_ARTIFACT' ELSE 'COMPANY_DOCUMENT' END;
 v_status:=CASE WHEN v_role='TENDER_ARTIFACT' OR NEW.ai_index_enabled IS FALSE OR NEW.status IN ('archived','deleted','superseded') THEN 'DISABLED' WHEN NEW.status<>'active' THEN 'WAITING_UPLOAD' WHEN nullif(trim(NEW.storage_url),'') IS NULL THEN 'BLOCKED_SOURCE' ELSE 'PENDING' END;
 v_fingerprint:=public.agenttender_company_source_fingerprint(NEW);
 INSERT INTO public.agenttender_company_document_texts AS s(document_id,company_id,source_fingerprint,source_updated_at,extraction_status,source_metadata,next_attempt_at)
 VALUES(NEW.id,NEW.company_id,v_fingerprint,NEW.updated_at,v_status,jsonb_build_object('evidence_role',v_role,'name',NEW.name,'url',NEW.storage_url),now())
 ON CONFLICT(document_id) DO UPDATE SET source_fingerprint=excluded.source_fingerprint,source_updated_at=excluded.source_updated_at,extraction_status=excluded.extraction_status,
 source_metadata=coalesce(s.source_metadata,'{}')||excluded.source_metadata,progress='{}',failure_count=0,next_attempt_at=now(),lease_token=null,lease_expires_at=null,last_error=null,updated_at=now();
 -- Preserve old text/chunks as history, but never retrieve a replaced source.
 UPDATE public.agenttender_company_document_text_chunks SET is_active=false,updated_at=now() WHERE document_id=NEW.id AND is_active;
 UPDATE public.agenttender_ai_document_chunks SET is_active=false,updated_at=now() WHERE company_id=NEW.company_id AND source_type='COMPANY_DOCUMENT' AND source_id=NEW.id::text AND is_active;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.agenttender_company_document_index_lifecycle() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS agenttender_company_document_index_lifecycle ON public.agenttender_company_documents;
CREATE TRIGGER agenttender_company_document_index_lifecycle AFTER INSERT OR UPDATE ON public.agenttender_company_documents FOR EACH ROW EXECUTE FUNCTION public.agenttender_company_document_index_lifecycle();

-- Existing OCR worker uses the same retry/lease fields as native extraction.
CREATE OR REPLACE FUNCTION public.agenttender_company_ocr_targets()
RETURNS TABLE(document_id uuid,name text,original_file_name text,storage_url text,storage_blob_name text,mime_type text,file_size_bytes bigint,members jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
SELECT d.id,d.name,d.original_file_name,d.storage_url,d.storage_blob_name,d.mime_type,d.file_size_bytes,x.extraction_metadata->'members'
FROM public.agenttender_company_documents d JOIN public.agenttender_company_document_texts x ON x.document_id=d.id AND x.company_id=d.company_id
WHERE d.status='active' AND d.ai_index_enabled IS NOT FALSE
AND x.source_fingerprint=public.agenttender_company_source_fingerprint(d)
AND coalesce(x.source_metadata->>'evidence_role','COMPANY_DOCUMENT')='COMPANY_DOCUMENT'
AND (x.lease_expires_at IS NULL OR x.lease_expires_at<now())
AND coalesce((x.extraction_metadata->>'ocr_retry_count')::integer,0)<3
AND coalesce((x.extraction_metadata->>'ocr_next_attempt_at')::timestamptz,now())<=now()
AND ((x.extraction_status IN ('OCR_REQUIRED','PARTIAL') AND coalesce(x.extraction_metadata->>'ocr','') IN ('','failed'))
 OR (x.extraction_metadata->>'ocr'='rapidocr' AND coalesce(x.extraction_metadata->>'ocr_upgrade','')=''))
ORDER BY (coalesce(x.extraction_metadata->>'ocr','')='rapidocr'),d.file_size_bytes NULLS LAST;
$function$;
REVOKE ALL ON FUNCTION public.agenttender_company_ocr_targets() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_company_ocr_targets() TO service_role;

-- Keep the single scheduled extraction worker; leases prevent overlap.
SELECT cron.alter_job(jobid,schedule:='* * * * *') FROM cron.job WHERE jobname='agenttender-company-text-index-every-5-min';
