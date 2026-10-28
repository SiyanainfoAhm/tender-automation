CREATE OR REPLACE FUNCTION public.agenttender_orch_v2_finish(p_tender uuid, p_lease uuid, p_ok boolean, p_result jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE q public.agenttender_orch_v2_tasks%rowtype; cp jsonb; nxt integer; st text; due timestamptz; attempts integer; why text; pending boolean; permanent boolean; human boolean;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
 SELECT * INTO q FROM public.agenttender_orch_v2_tasks WHERE tender_id=p_tender AND lease_token=p_lease AND state='RUNNING' FOR UPDATE;
 IF NOT FOUND OR q.leased_until<now() THEN RETURN jsonb_build_object('accepted',false,'reason','STALE_LEASE');END IF;
 cp:=q.checkpoint; nxt:=q.step; attempts:=q.failures; due:=now(); st:='WAITING'; why:=left(coalesce(p_error,''),1600);
 IF p_ok THEN
  cp:=jsonb_set(cp,array[q.step::text],coalesce(p_result,'{}'),true); attempts:=0;
  IF q.step=3 THEN
   -- Only a proven hard scope exclusion skips company PQ. Software scope alone never does.
   IF p_result#>>'{assessment,disposition}'='CLEAR_EXCLUSION' AND p_result->>'scope_decision_ready'='true' THEN nxt:=6;
   ELSIF p_result->>'readiness'='READY' THEN nxt:=4;
   ELSE RAISE EXCEPTION 'Step 3 success requires exclusion evidence or PQ readiness'; END IF;
  ELSIF q.step=6 THEN
   IF p_result->>'applied'='true' OR p_result->>'reason' IN ('PROTECTED_OR_NOT_ELIGIBLE','STALE_OR_WRONG_STAGE') THEN st:='DONE';
   ELSE due:='infinity';cp:=cp||jsonb_build_object('operational_reason','HUMAN_REVIEW','human_review',p_result);why:='HUMAN_REVIEW:FINAL_VALIDATION_REQUIRED'; END IF;
  ELSE nxt:=least(q.step+1,6); END IF;
  cp:=cp-'technical_wait'-'document_wait';
 ELSE
  pending:=position('DEPENDENCY_PENDING:' in why)>0;
  permanent:=why ~ 'SOURCE_ACQUISITION_BLOCKED|MISSING_SOURCE_EVIDENCE|TARGETED_EXTRACTION_BLOCKED|HTTP_402|AI_SCREENING_REQUIRED';
  attempts:=q.failures+1;
  IF pending AND why LIKE '%COVERAGE_PROGRESS%' THEN
   attempts:=q.failures; due:=now()+interval '1 second'; st:='RETRY'; human:=false;
  ELSIF pending AND why ~ 'EVIDENCE_REFRESH_REQUIRED|EXTRACTION_WAIT|SOURCE_ACQUISITION_BLOCKED|MISSING_SOURCE_EVIDENCE|TARGETED_SOURCE_ACQUISITION|TARGETED_EXTRACTION_BLOCKED|ASSESSMENT_OUTPUT_INCOMPLETE' THEN
   due:='infinity'; st:='WAITING'; human:=permanent;
  ELSE
   due:=now()+make_interval(secs=>least(1800,30*power(2,least(attempts,6)))::integer);
   human:=permanent OR attempts>=5;
   IF human THEN due:='infinity'; ELSE st:='RETRY'; END IF;
  END IF;
  cp:=cp||jsonb_build_object('operational_reason',CASE WHEN pending AND why !~ 'HTTP_|AI_SCREENING_REQUIRED' THEN 'EVIDENCE_PENDING' ELSE 'TECHNICAL_PENDING' END,
   'technical_wait',jsonb_build_object('reason',why,'attempt',attempts,'max_attempts',5,'human_action_required',human,'at',now(),'next_action',CASE WHEN human THEN 'Restore the requested source/access; evidence completion automatically resumes processing' ELSE 'Continue checkpointed coverage or wait for changed evidence; no unchanged-evidence retries' END));
  IF q.step=3 THEN
   UPDATE public.agenttender_tenders SET prescreen_status='NEEDS_DOCUMENTS',prescreen_reason=left('EVIDENCE_PENDING — '||why,1000),updated_at=now()
   WHERE id=p_tender AND qualification_status IN ('VERIFY','REVIEW') AND coalesce(status,'') NOT IN ('GO','WILL_BID','SUBMITTED','WON','UNDER_EVALUATION') AND coalesce(lower(decision_source),'') NOT LIKE '%manual%';
  END IF;
 END IF;
 UPDATE public.agenttender_orch_v2_tasks SET step=nxt,state=st,failures=attempts,ready_at=due,checkpoint=cp,last_error=nullif(why,''),lease_token=null,leased_until=null,updated_at=now() WHERE tender_id=p_tender;
 INSERT INTO public.agenttender_orch_v2_events(tender_id,step,event_type,details) VALUES(p_tender,q.step,CASE WHEN p_ok THEN 'STEP_COMPLETED' WHEN due='infinity' THEN 'EVIDENCE_OR_TECHNICAL_BLOCKED' ELSE 'BOUNDED_RETRY' END,jsonb_build_object('next_step',nxt,'state',st,'reason',nullif(why,''),'attempt',attempts,'result',CASE WHEN p_ok THEN p_result ELSE null END));
 RETURN jsonb_build_object('accepted',true,'state',st,'next_step',nxt,'failures',attempts,'blocked',due='infinity');
END $function$;

CREATE OR REPLACE FUNCTION agenttender_internal.wake_v2_step3_dependency()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE tid uuid; changed boolean:=true;
BEGIN
 tid:=new.tender_id;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='agenttender_document_extractions' THEN
   changed:=(new.extracted_text,new.extraction_status,new.document_id,new.tender_id,new.extraction_metadata)
    IS DISTINCT FROM (old.extracted_text,old.extraction_status,old.document_id,old.tender_id,old.extraction_metadata);
  ELSIF TG_TABLE_NAME='agenttender_tender_documents' THEN
   changed:=(new.storage_status,new.sharepoint_drive_item_id,new.storage_url,new.file_name,new.tender_id,new.company_id)
    IS DISTINCT FROM (old.storage_status,old.sharepoint_drive_item_id,old.storage_url,old.file_name,old.tender_id,old.company_id);
  ELSE changed:=new.status IS DISTINCT FROM old.status AND new.status IN ('COMPLETED','EXTRACTED','INDEXED'); END IF;
 END IF;
 IF NOT changed OR tid IS NULL THEN RETURN new; END IF;
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
END $fn$;
DROP TRIGGER IF EXISTS wake_v2_step3_extraction ON public.agenttender_document_extractions;
CREATE TRIGGER wake_v2_step3_extraction AFTER INSERT OR UPDATE OF extracted_text,extraction_status,document_id,tender_id,extraction_metadata ON public.agenttender_document_extractions FOR EACH ROW EXECUTE FUNCTION agenttender_internal.wake_v2_step3_dependency();
DROP TRIGGER IF EXISTS wake_v2_step3_document ON public.agenttender_tender_documents;
CREATE TRIGGER wake_v2_step3_document AFTER INSERT OR UPDATE OF storage_status,sharepoint_drive_item_id,storage_url,file_name,tender_id,company_id ON public.agenttender_tender_documents FOR EACH ROW EXECUTE FUNCTION agenttender_internal.wake_v2_step3_dependency();
DROP TRIGGER IF EXISTS wake_v2_step3_acquisition ON public.agenttender_document_acquisition_jobs;
CREATE TRIGGER wake_v2_step3_acquisition AFTER UPDATE OF status ON public.agenttender_document_acquisition_jobs FOR EACH ROW EXECUTE FUNCTION agenttender_internal.wake_v2_step3_dependency();

-- Claim exactly one owned saved ingestion job, preserving its existing page cursor.
CREATE OR REPLACE FUNCTION public.agenttender_claim_sharepoint_document(p_document uuid)
RETURNS TABLE(document_id uuid,tender_id uuid,company_id uuid,file_name text,storage_url text,sharepoint_item_id text,scraped_date date,source_tender_id text,lease_token uuid,progress jsonb,attempt_count integer,failure_count integer)
LANGUAGE plpgsql SET search_path TO 'pg_catalog','public','extensions' AS $fn$
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
 RETURN QUERY WITH claimed AS (
  UPDATE public.agenttender_document_ingestion_jobs j SET status='PROCESSING',attempt_count=j.attempt_count+1,
   lease_token=gen_random_uuid(),lease_expires_at=now()+interval '4 minutes',updated_at=now()
  FROM public.agenttender_tender_documents d,public.agenttender_tenders t
  WHERE j.document_id=p_document AND d.id=j.document_id AND t.id=j.tender_id AND d.tender_id=t.id AND d.company_id=j.company_id
   AND j.company_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' AND d.storage_status='COMPLETED'
   AND t.qualification_status IN ('VERIFY','REVIEW') AND coalesce(lower(t.decision_source),'') NOT LIKE '%manual%'
   AND upper(coalesce(t.status,'')) NOT IN ('GO','WILL_BID','WILL-BID','SUBMITTED','WON','UNDER_EVALUATION')
   AND ((j.status IN ('PENDING','RETRY') AND j.next_attempt_at<=now()) OR(j.status='PROCESSING' AND j.lease_expires_at<now()))
   AND j.failure_count<8 RETURNING j.*
 ) SELECT j.document_id,j.tender_id,j.company_id,d.file_name,d.storage_url,d.sharepoint_drive_item_id,t.scraped_date,t.source_tender_id,j.lease_token,j.progress,j.attempt_count,j.failure_count
 FROM claimed j JOIN public.agenttender_tender_documents d ON d.id=j.document_id JOIN public.agenttender_tenders t ON t.id=j.tender_id;
END $fn$;
REVOKE ALL ON FUNCTION public.agenttender_claim_sharepoint_document(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_claim_sharepoint_document(uuid) TO service_role;
