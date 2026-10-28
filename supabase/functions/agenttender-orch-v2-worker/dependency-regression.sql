BEGIN;
DO $test$
DECLARE tid uuid; tok uuid:=gen_random_uuid(); result jsonb; before_count integer; after_count integer; doc uuid;
BEGIN
 SELECT id INTO tid FROM public.agenttender_tenders WHERE source_tender_id='105644737' AND qualification_status='VERIFY' LIMIT 1;
 IF tid IS NULL THEN RAISE EXCEPTION 'test fixture unavailable'; END IF;
 PERFORM 1 FROM public.agenttender_orch_v2_tasks WHERE tender_id=tid FOR UPDATE;
 SELECT count(*) INTO before_count FROM public.agenttender_ai_document_chunks WHERE tender_id=tid AND is_active;
 UPDATE public.agenttender_orch_v2_tasks SET state='RUNNING',step=3,failures=5,lease_token=tok,leased_until=now()+interval '1 minute' WHERE tender_id=tid;
 result:=public.agenttender_orch_v2_finish(tid,tok,false,'{}','DEPENDENCY_PENDING:COVERAGE_PROGRESS');
 IF result->>'accepted'<>'true' OR result->>'state'<>'RETRY' OR result->>'failures'<>'5' THEN RAISE EXCEPTION 'coverage progress consumed failure history: %',result; END IF;
 UPDATE public.agenttender_orch_v2_tasks SET state='RUNNING',lease_token=tok,leased_until=now()+interval '1 minute' WHERE tender_id=tid;
 result:=public.agenttender_orch_v2_finish(tid,tok,false,'{}','DEPENDENCY_PENDING:EVIDENCE_REFRESH_REQUIRED');
 IF NOT EXISTS(SELECT 1 FROM public.agenttender_orch_v2_tasks WHERE tender_id=tid AND ready_at='infinity' AND state='WAITING') THEN RAISE EXCEPTION 'unchanged evidence was scheduled to retry'; END IF;
 UPDATE public.agenttender_orch_v2_tasks SET checkpoint=jsonb_build_object('step3_screen_cache',jsonb_build_object('fingerprint','old'),'step3_coverage',jsonb_build_object('cursor',9)) WHERE tender_id=tid;
 SELECT document_id INTO doc FROM public.agenttender_document_extractions WHERE tender_id=tid AND document_id IS NOT NULL LIMIT 1;
 UPDATE public.agenttender_document_extractions SET extraction_metadata=coalesce(extraction_metadata,'{}')||jsonb_build_object('regression_revision',1) WHERE tender_id=tid AND document_id=doc;
 IF NOT EXISTS(SELECT 1 FROM public.agenttender_orch_v2_tasks WHERE tender_id=tid AND ready_at<=now() AND NOT checkpoint?'step3_screen_cache' AND NOT checkpoint?'step3_coverage' AND failures=5) THEN RAISE EXCEPTION 'metadata revision did not invalidate and resume without resetting failures'; END IF;
 SELECT count(*) INTO after_count FROM public.agenttender_ai_document_chunks WHERE tender_id=tid AND is_active;
 IF before_count<>after_count THEN RAISE EXCEPTION 'dependency repair changed existing index'; END IF;
 UPDATE public.agenttender_orch_v2_tasks SET state='RUNNING',step=6,lease_token=tok,leased_until=now()+interval '1 minute' WHERE tender_id=tid;
 result:=public.agenttender_orch_v2_commit(tid,tok,jsonb_build_object('final_decision','VERIFY','business_reason','Missing source proof','blocking_issues',jsonb_build_array('MISSING_PROOF')));
 IF result->>'applied'<>'false' OR result->>'reason'<>'EVIDENCE_INCOMPLETE' THEN RAISE EXCEPTION 'VERIFY was promoted: %',result; END IF;
 IF (SELECT qualification_status FROM public.agenttender_tenders WHERE id=tid)<>'VERIFY' THEN RAISE EXCEPTION 'missing evidence changed qualification'; END IF;
END $test$;
ROLLBACK;
