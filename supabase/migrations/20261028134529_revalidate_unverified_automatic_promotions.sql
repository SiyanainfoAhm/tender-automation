CREATE OR REPLACE FUNCTION public.agenttender_orch_v2_commit(p_tender uuid, p_lease uuid, p_assessment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE q public.agenttender_orch_v2_tasks%rowtype; t public.agenttender_tenders%rowtype; checked jsonb; target text; actual text; learning jsonb; review_needed boolean:=false; revalidating boolean:=false; prior_audit bigint;
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'service role required';END IF;
 SELECT * INTO q FROM public.agenttender_orch_v2_tasks WHERE tender_id=p_tender AND lease_token=p_lease AND state='RUNNING' AND step=6 FOR UPDATE;
 IF NOT FOUND OR q.leased_until<now() THEN RETURN jsonb_build_object('applied',false,'reason','STALE_OR_WRONG_STAGE');END IF;
 SELECT * INTO t FROM public.agenttender_tenders WHERE id=p_tender FOR UPDATE;
 BEGIN prior_audit:=(q.checkpoint#>>'{revalidate_unsupported_auto_decision,audit_id}')::bigint; EXCEPTION WHEN OTHERS THEN prior_audit:=null; END;
 revalidating:=prior_audit IS NOT NULL AND t.qualification_status='CONDITIONAL_GO' AND t.decision_source='ORCHESTRATOR_V2'
 AND EXISTS(SELECT 1 FROM public.agenttender_v2_decision_audit a WHERE a.id=prior_audit AND a.tender_id=p_tender AND a.final_decision='CONDITIONAL_GO'
  AND (a.assessment#>>'{validator_result,final_decision}'='VERIFY' OR coalesce(jsonb_array_length(a.assessment->'missing_company_evidence'),1)>0 OR NOT EXISTS(SELECT 1 FROM public.agenttender_orch_v2_requirement_findings f WHERE f.tender_id=p_tender AND f.mandatory)) AND a.decision_at=t.updated_at
  AND a.id=(SELECT max(z.id) FROM public.agenttender_v2_decision_audit z WHERE z.tender_id=p_tender));
 IF (t.qualification_status NOT IN ('VERIFY','REVIEW') AND NOT revalidating) OR t.status IN ('GO','WILL_BID','SUBMITTED','WON','UNDER_EVALUATION')
 OR NOT EXISTS(SELECT 1 FROM public.agenttender_tender_route_assignments WHERE tender_id=p_tender AND route='ORCHESTRATOR')
 THEN RETURN jsonb_build_object('applied',false,'reason','PROTECTED_OR_NOT_ELIGIBLE');END IF;
 checked:=public.agenttender_v2_validate_assessment(p_tender,p_assessment);target:=checked->>'final_decision';
 learning:=public.agenttender_orch_v2_adjudication_context(p_tender)->'continuous_learning';
 -- Missing proof remains VERIFY. Never convert the validator's VERIFY into an approval.
 IF target='CONDITIONAL_GO' AND (
  coalesce(jsonb_array_length(p_assessment->'missing_company_evidence'),1)>0
  OR NOT EXISTS(SELECT 1 FROM public.agenttender_orch_v2_requirement_findings f WHERE f.tender_id=p_tender AND f.mandatory)
  OR EXISTS(SELECT 1 FROM public.agenttender_orch_v2_requirement_findings f WHERE f.tender_id=p_tender AND f.mandatory AND (f.verdict<>'PASS' OR jsonb_array_length(coalesce(f.rfp_evidence,'[]'))=0 OR jsonb_array_length(coalesce(f.company_evidence,'[]'))=0))
 ) THEN target:='VERIFY'; checked:=checked||jsonb_build_object('final_decision','VERIFY','reason','NOT_VERIFIED — mandatory company evidence has not been verified.'); END IF;
 IF target='VERIFY' AND NOT revalidating THEN
  INSERT INTO public.agenttender_orch_v2_events(tender_id,step,event_type,details) VALUES(p_tender,6,'UNVERIFIED_DECISION_RETAINED',checked);
  RETURN jsonb_build_object('applied',false,'reason','EVIDENCE_INCOMPLETE','validation',checked);
 END IF;
 UPDATE public.agenttender_tenders SET qualification_status=target,status=CASE WHEN target='VERIFY' THEN NULL WHEN target='NO_GO' THEN 'NO_BID' ELSE 'MAY_BID' END,
 prescreen_status=CASE WHEN target='VERIFY' THEN 'NEEDS_DOCUMENTS' WHEN target='NO_GO' THEN 'REJECTED' ELSE 'PASSED' END,decision_source='ORCHESTRATOR_V2',
 prescreen_reason=left(CASE WHEN review_needed THEN 'Review needed: ' ELSE '' END||coalesce(checked->>'reason',''),1000),prescreened_at=now(),updated_at=now()
 WHERE id=p_tender AND qualification_status=t.qualification_status RETURNING qualification_status INTO actual;
 IF actual IS DISTINCT FROM target THEN RAISE EXCEPTION 'DECISION_TRIGGER_CONFLICT: expected %, actual %',target,actual;END IF;
 INSERT INTO public.agenttender_v2_decision_audit(tender_id,final_decision,matched_rule_codes,rule_versions,evidence,worker_version,model,decision_source,reason,assessment)
 VALUES(p_tender,target,checked->'matched_rule_codes',checked->'rule_versions',checked->'evidence',coalesce(p_assessment->>'worker_version','V2_EVIDENCE_DECISIONS_20261024_1'),
 p_assessment->>'adjudication_model','ORCHESTRATOR_V2',checked->>'reason',p_assessment||jsonb_build_object('validator_result',checked,'review_needed',review_needed,'learning_context',jsonb_build_object('version',learning->>'version','knowledge_fingerprint',learning->>'knowledge_fingerprint','knowledge_ids',learning->'knowledge_ids')));
 INSERT INTO public.agenttender_orch_v2_events(tender_id,step,event_type,details) VALUES(p_tender,6,CASE WHEN review_needed THEN 'CONDITIONAL_GO_REVIEW_NEEDED' ELSE 'FINAL_DECISION_COMMITTED' END,checked);
 RETURN jsonb_build_object('applied',NOT revalidating,'recovery_applied',revalidating,'status',target,'reason',CASE WHEN review_needed THEN 'CONDITIONAL_GO_REVIEW_NEEDED' ELSE 'VALIDATED_EVIDENCE_DECISION' END,'validation',checked);
END $function$;
