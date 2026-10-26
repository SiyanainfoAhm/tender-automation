-- Production-source baseline backed up before this migration. No business status backfill.
CREATE OR REPLACE FUNCTION public.agenttender_v2_evidence_valid(p_tender uuid, p_evidence jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
SELECT (length(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')))>=25 OR (
 p_evidence->>'chunk_id'='LISTING' AND length(btrim(coalesce(p_evidence->>'excerpt','')))>=8
 AND EXISTS(SELECT 1 FROM public.agenttender_tenders t WHERE t.id=p_tender
 AND lower(btrim(t.title))=lower(btrim(p_evidence->>'excerpt'))
 AND lower(btrim(t.description))=lower(btrim(t.title)))
 )) AND (
 EXISTS(SELECT 1 FROM public.agenttender_ai_document_chunks c WHERE c.tender_id=p_tender AND c.is_active AND c.source_type='TENDER_DOCUMENT'
 AND c.id::text=p_evidence->>'chunk_id'
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(c.content,'[[:space:]]+',' ','g')))>0)
 OR (p_evidence->>'chunk_id' LIKE 'EXTRACTED:%' AND EXISTS(
 SELECT 1 FROM public.agenttender_document_extractions x WHERE x.document_id::text=substring(p_evidence->>'chunk_id' FROM 11)
 AND (x.tender_id=p_tender OR EXISTS(SELECT 1 FROM public.agenttender_tender_documents d WHERE d.id=x.document_id AND d.tender_id=p_tender))
 AND x.extraction_status='SUCCESS' AND coalesce(x.document_kind,'')<>'AI_SUMMARY' AND x.file_name !~* 'ai[ _-]*summary'
 AND coalesce(x.extraction_metadata->>'unsupported_type','false')<>'true'
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(x.extracted_text,'[[:space:]]+',' ','g')))>0))
 OR (p_evidence->>'chunk_id'='LISTING' AND EXISTS(
 SELECT 1 FROM public.agenttender_tenders t CROSS JOIN public.agenttender_eligibility_rules r
 WHERE t.id=p_tender AND r.code=p_evidence->>'rule_code' AND r.enabled AND nullif(r.approval_source,'') IS NOT NULL AND r.approval_source<>'PENDING_APPROVAL'
 AND ((p_evidence->>'establishes'='SOFTWARE_SCOPE' AND r.code LIKE 'FIT_%' AND r.decision<>'NO_GO')
 OR (p_evidence->>'establishes'='EXCLUSION' AND r.decision='NO_GO'
 AND r.code IN ('HARDWARE','MANPOWER','NON_IT_SERVICES','TRAINING_ONLY','SOFTWARE_RESALE','STANDALONE_SOFTWARE_AMC','KIOSK','PROPRIETARY_ONLY','PAC_PROPRIETARY_PRODUCT','CCTV_GPS_CONTROL_ROOM','GIS_SURVEY_PROCESSING','TELECOM_NETWORK_INFRASTRUCTURE','SPEECH_DATA_COLLECTION_TRANSCRIPTION','CYBER_SECURITY','SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL','INDUSTRIAL_MONITORING_DATA_TRANSMISSION_AMC','ICCC_EXISTING_O_AND_M','READY_MADE_SOFTWARE')))
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(concat_ws(' ',t.title,t.description),'[[:space:]]+',' ','g')))>0))
);
$function$

;
CREATE OR REPLACE FUNCTION public.agenttender_orch_v2_finish(p_tender uuid, p_lease uuid, p_ok boolean, p_result jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
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
  IF pending AND why LIKE '%EVIDENCE_REFRESH_REQUIRED%' THEN due:=now()+interval '15 seconds';
  ELSE due:=now()+make_interval(secs=>least(1800,30*power(2,least(attempts,6)))::integer); END IF;
  human:=permanent OR attempts>=5;
  IF human THEN due:='infinity'; ELSE st:='RETRY'; END IF;
  cp:=cp||jsonb_build_object('operational_reason',CASE WHEN pending AND why !~ 'HTTP_|AI_SCREENING_REQUIRED' THEN 'EVIDENCE_PENDING' ELSE 'TECHNICAL_PENDING' END,
   'technical_wait',jsonb_build_object('reason',why,'attempt',attempts,'max_attempts',5,'human_action_required',human,'at',now(),'next_action',CASE WHEN human THEN 'Restore or supply the requested evidence/dependency, then explicitly resume' ELSE 'Retry after bounded backoff and reassess available evidence' END));
  IF q.step=3 THEN
   UPDATE public.agenttender_tenders SET prescreen_status='NEEDS_DOCUMENTS',prescreen_reason=left('EVIDENCE_PENDING — '||why,1000),updated_at=now()
   WHERE id=p_tender AND qualification_status IN ('VERIFY','REVIEW') AND coalesce(status,'') NOT IN ('GO','WILL_BID','SUBMITTED','WON','UNDER_EVALUATION') AND coalesce(lower(decision_source),'') NOT LIKE '%manual%';
  END IF;
 END IF;
 UPDATE public.agenttender_orch_v2_tasks SET step=nxt,state=st,failures=attempts,ready_at=due,checkpoint=cp,last_error=nullif(why,''),lease_token=null,leased_until=null,updated_at=now() WHERE tender_id=p_tender;
 INSERT INTO public.agenttender_orch_v2_events(tender_id,step,event_type,details) VALUES(p_tender,q.step,CASE WHEN p_ok THEN 'STEP_COMPLETED' WHEN due='infinity' THEN 'EVIDENCE_OR_TECHNICAL_BLOCKED' ELSE 'BOUNDED_RETRY' END,jsonb_build_object('next_step',nxt,'state',st,'reason',nullif(why,''),'attempt',attempts,'result',CASE WHEN p_ok THEN p_result ELSE null END));
 RETURN jsonb_build_object('accepted',true,'state',st,'next_step',nxt,'failures',attempts,'blocked',due='infinity');
END $function$;
REVOKE ALL ON FUNCTION public.agenttender_orch_v2_finish(uuid,uuid,boolean,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_orch_v2_finish(uuid,uuid,boolean,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.agenttender_claim_document_acquisition()
 RETURNS SETOF agenttender_document_acquisition_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 update agenttender_document_acquisition_jobs set
 status=case when attempt_count>=max_attempts then 'BLOCKED' else 'RETRY' end,
 last_error='ACQUISITION_LEASE_EXPIRED',lease_token=null,lease_expires_at=null,
 next_attempt_at=now()+interval '2 minutes',updated_at=now()
 where status='PROCESSING' and lease_expires_at<now();
 return query
 with due as (
 select j.tender_id from agenttender_document_acquisition_jobs j
 where status in ('PENDING','RETRY') and next_attempt_at<=now() and attempt_count<max_attempts
 and (not exists(select 1 from public.agenttender_tender_route_assignments a where a.tender_id=j.tender_id and a.route='ORCHESTRATOR')
 or exists(select 1 from public.agenttender_orch_v2_tasks q join public.agenttender_tenders t on t.id=q.tender_id
 where q.tender_id=j.tender_id and t.qualification_status in ('VERIFY','REVIEW')
 and jsonb_array_length(coalesce(q.checkpoint#>'{progressive_evidence_request,questions}','[]'))>0
 and coalesce(q.checkpoint#>>'{3,assessment,disposition}','')<>'CLEAR_EXCLUSION'))
 order by next_attempt_at,created_at for update skip locked limit 1
 )
 update agenttender_document_acquisition_jobs j set status='PROCESSING',attempt_count=attempt_count+1,
 lease_token=gen_random_uuid(),lease_expires_at=now()+interval '10 minutes',updated_at=now()
 from due where j.tender_id=due.tender_id returning j.*;
end $function$

;
