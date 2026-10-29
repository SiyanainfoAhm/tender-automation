-- AI learning resumed as one small nightly batch (2026-10-29). Applied to production (VBDC);
-- recorded here so the repo matches. Supersedes 20261029080500_stop_ai_self_learning.sql
-- for the learning jobs and triggers (tender-category-review-scheduler stays off).
--
-- Night run, IST (cron below is UTC):
--   00:50 collect changes      -> 00:55 classify      -> 01:00 full validation
--   01:30-04:16 AI fact checks (one per slot, capped at 20 a day by the claim function)
--   01:35-04:35 structure review, 02:00 rules, 02:15 suggestions, 03:00 responses
--   04:30-05:25 embed newly verified facts -> 05:30 health check
-- The every-5-minute validation job stays off; the nightly full validation replaces it.

create index if not exists cl_knowledge_active_lease on agenttender_internal.cl_knowledge (verification_lease_until)
  where verification_lease_until is not null;

-- AI fact check claim: same prompt, checks and 20/day cap, but
--   * lease checks use the index above instead of scanning cl_knowledge (was ~440 MB a run),
--   * archived records are never sent for AI checking,
--   * a candidate with no usable source text rests 3 days before it is tried again,
--   * a run looks at no more than 60 candidates.
CREATE OR REPLACE FUNCTION public.agenttender_cl_ai_claim(p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'agenttender_internal'
AS $function$
DECLARE k record; ev jsonb; tok uuid; rid bigint; result jsonb:='[]'; remaining int; scanned int:=0;
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'service role required'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('cl_ai_budget')) THEN RETURN '[]'::jsonb; END IF;
 -- Expired leases recover without promoting anything. Claim count remains charged to the daily budget.
 UPDATE agenttender_internal.cl_runs SET status='FAILED',finished_at=clock_timestamp(),last_error='WORKER_TIMEOUT'
 WHERE stage='VERIFY_AI' AND status='RUNNING' AND started_at<now()-interval '3 minutes';
 UPDATE agenttender_internal.cl_knowledge SET verification_lease=null,verification_lease_until=null,
 verification_outcome=CASE WHEN verification_attempts>=5 THEN 'QUARANTINED' ELSE 'RETRYABLE_ERROR' END,
 verification_error='WORKER_TIMEOUT',verification_next_at=now()+make_interval(secs=>least(86400,60*power(2,least(verification_attempts,10))::int))
 WHERE verification_lease_until<now() AND verification_lease IS NOT NULL;
 IF EXISTS(SELECT 1 FROM agenttender_internal.cl_knowledge WHERE verification_lease_until>now() AND verification_lease IS NOT NULL) THEN RETURN '[]'::jsonb; END IF;
 SELECT greatest(0,20-count(*)) INTO remaining FROM agenttender_internal.cl_runs
 WHERE stage='VERIFY_AI' AND started_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');
 IF remaining=0 THEN RETURN '[]'::jsonb; END IF;
 FOR k IN SELECT * FROM agenttender_internal.cl_knowledge
 WHERE is_current AND verification_status='CANDIDATE' AND source_table IN ('agenttender_bid_checklist_items','agenttender_ai_company_facts','agenttender_company_documents')
 AND verification_attempts<5 AND verification_lease IS NULL AND evidence->'ai_verification' IS NULL
 AND (verification_outcome='WAITING_EVIDENCE' OR (verification_outcome='RETRYABLE_ERROR' AND verification_next_at<=now()))
 AND coalesce(content->>'record_status','') <> 'archived'
 AND coalesce(content#>>'{fact,record_status}','') <> 'archived'
 AND coalesce(content->>'is_archived','false') <> 'true'
 AND coalesce((evidence->>'ai_no_evidence_until')::timestamptz, '-infinity'::timestamptz) <= now()
 ORDER BY CASE source_table WHEN 'agenttender_bid_checklist_items' THEN 0 ELSE 1 END,id
 FOR UPDATE SKIP LOCKED
 LOOP
  EXIT WHEN jsonb_array_length(result)>=least(greatest(p_limit,1),2,remaining);
  EXIT WHEN scanned>=60;
  scanned:=scanned+1;
  -- Only original, same-company/same-tender extracted evidence enters AI review.
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO ev FROM (
   SELECT c.id chunk_id,c.source_id,c.document_name,c.page_number,left(c.content,6000) content,md5(c.content) chunk_hash
   FROM agenttender_ai_document_chunks c WHERE c.is_active AND c.content NOT LIKE '[METADATA ONLY%' AND length(c.content)>50
   AND ((k.source_table='agenttender_bid_checklist_items' AND c.source_type='TENDER_DOCUMENT' AND c.tender_id=k.tender_id
      AND length(k.content->>'source_text')>30 AND position(k.content->>'source_text' IN c.content)>0)
    OR (k.source_table='agenttender_company_documents' AND c.source_type='COMPANY_DOCUMENT' AND c.company_id=k.company_id AND c.source_id=k.source_id)
    OR (k.source_table='agenttender_ai_company_facts' AND c.source_type='COMPANY_DOCUMENT' AND c.company_id=k.company_id
       AND c.source_id IN (SELECT jsonb_array_elements_text(k.content->'evidence_document_ids'))))
   ORDER BY c.chunk_index LIMIT 3
  ) x;
  IF jsonb_array_length(ev)=0 THEN
   UPDATE agenttender_internal.cl_knowledge SET evidence=evidence||jsonb_build_object('ai_no_evidence_until',now()+interval '3 days') WHERE id=k.id;
   CONTINUE;
  END IF;
  tok:=gen_random_uuid();
  INSERT INTO agenttender_internal.cl_runs(stage,run_key,status,result) VALUES('VERIFY_AI',tok::text,'RUNNING',
   jsonb_build_object('knowledge_id',k.id,'source_version',k.source_version,'daily_call_cap',20,'input_character_cap',24000,'output_token_cap',1500))
   RETURNING id INTO rid;
  UPDATE agenttender_internal.cl_knowledge SET verification_lease=tok,verification_lease_until=now()+interval '3 minutes',
   verification_attempts=verification_attempts+1,evidence=evidence||jsonb_build_object('ai_claim',jsonb_build_object('run_id',rid,'chunks',ev))
   WHERE id=k.id;
  result:=result||jsonb_build_array(jsonb_build_object('candidate_identifier',k.id,'source_identifier',k.source_id,'source_table',k.source_table,
   'source_version',k.source_version,'company_id',k.company_id,'tender_id',k.tender_id,'statement',k.content,'evidence',ev,'lease',tok,'run_id',rid));
 END LOOP;
 RETURN result;
END $function$;

select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-learning-collection-hourly-minute-30'), schedule := '20 19 * * *', active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-cl-candidate-classification'), schedule := '25 19 * * *', command := 'select public.agenttender_cl_verify_batch(1000);', active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-learning-validate-0100-ist'), active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-cl-evidence-ai-bounded'), schedule := '*/8 20-22 * * *', active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-cl-structural-source-review'), schedule := '5 20-23 * * *', active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-learning-rules-0200-ist'), active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-learning-suggestions-0215-ist'), active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-learning-responses-0300-ist'), active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-cl-knowledge-embedder'), schedule := '*/5 23 * * *', active := true);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='agenttender-cl-health-monitor'), schedule := '0 0 * * *', active := true);

alter table public.agenttender_ai_company_facts enable trigger cl_capture_changes;
alter table public.agenttender_ai_review_examples enable trigger cl_capture_changes;
alter table public.agenttender_bid_checklist_items enable trigger cl_capture_changes;
alter table public.agenttender_company_documents enable trigger cl_capture_changes;
alter table public.agenttender_decision_learning enable trigger cl_capture_changes;
alter table public.agenttender_orch_decision_knowledge enable trigger cl_capture_changes;
alter table public.agenttender_rule_feedback enable trigger cl_capture_changes;
alter table public.agenttender_won_projects enable trigger cl_capture_changes;
alter table public.agenttender_bid_checklist_items enable trigger cl_capture_checklist_correction;
alter table public.agenttender_bid_checklist_items enable trigger agenttender_checklist_rule_learning;
alter table public.agenttender_company_documents enable trigger agenttender_company_rule_learning;
