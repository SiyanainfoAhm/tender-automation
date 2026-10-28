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
  attempts:=least(5,q.failures+1);
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
