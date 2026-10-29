-- Reduce disk IO from background jobs (Supabase "Disk IO Budget" warning, 2026-10-29).
-- Already applied to production (VBDC); recorded here so the repo matches the database.
-- Every function keeps the same selection rules and priority order; only how rows are found changed.

-- 1. Active tender embedding dispatch (every minute): was ~70% of all disk reads,
--    scanning all ~141k un-embedded chunks to find a few hundred for active tenders.
create index if not exists agenttender_tender_embedding_due_idx
  on public.agenttender_ai_document_chunks (tender_id, created_at, id)
  where is_active and embedding_local is null and source_type='TENDER_DOCUMENT';

CREATE OR REPLACE FUNCTION public.agenttender_dispatch_active_tender_embeddings(p_batch integer DEFAULT 40)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_n integer := 0; v_limit integer := least(greatest(p_batch,1),80);
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='agenttender_ingestion_service_key' LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION 'ingestion service key missing'; END IF;
  WITH eligible AS MATERIALIZED (
    SELECT t.id, t.qualification_status, t.status, t.closing_date,
           EXISTS (SELECT 1 FROM public.agenttender_chat_prep_requests r WHERE r.tender_id=t.id AND r.expires_at>now()) AS chat
    FROM public.agenttender_tenders t
    WHERE t.source_region='INDIAN'
      AND ( ( (t.qualification_status IN ('GO','VERIFY','CONDITIONAL_GO') OR upper(coalesce(t.status,'')) IN ('VERIFY','REVIEW','GO','WILL-BID'))
              AND lower(coalesce(t.status,'')) NOT IN ('submitted','no_bid')
              AND (t.closing_date IS NULL OR t.closing_date >= current_date) )
            OR t.id IN (SELECT r.tender_id FROM public.agenttender_chat_prep_requests r WHERE r.expires_at>now()) )
  ), picked AS (
    SELECT c.id, c.tender_id FROM eligible t
    CROSS JOIN LATERAL (
      SELECT c.id, c.tender_id, c.created_at FROM public.agenttender_ai_document_chunks c
      WHERE c.tender_id=t.id AND c.is_active AND c.embedding_local IS NULL AND c.source_type='TENDER_DOCUMENT'
        AND length(trim(coalesce(c.content,'')))>0
        AND NOT EXISTS (SELECT 1 FROM agenttender_internal.v2_embedding_leases l WHERE l.chunk_id=c.id AND l.leased_until>now())
        AND NOT EXISTS (SELECT 1 FROM public.agenttender_embedding_queue q WHERE q.chunk_id=c.id
                        AND (q.status='failed' OR q.available_at>now() OR (q.status='processing' AND q.claimed_at>now()-interval '3 minutes')))
      ORDER BY c.created_at, c.id
      LIMIT v_limit
    ) c
    ORDER BY t.chat DESC,
             CASE WHEN t.qualification_status='GO' OR lower(coalesce(t.status,''))='will-bid' THEN 0 ELSE 1 END,
             t.closing_date NULLS LAST, c.created_at, c.id
    LIMIT v_limit
  )
  SELECT count(net.http_post(
           url:='https://fvveqziyusjgqejowkfp.supabase.co/functions/v1/agenttender-local-embedding-worker',
           headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
           body:=jsonb_build_object('tender_id',p.tender_id,'chunk_id',p.id),
           timeout_milliseconds:=120000))
    INTO v_n
  FROM picked p;
  RETURN v_n;
END $function$;

-- 2. Continuous-learning jobs: health monitor, candidate classification and evidence
--    validation read the whole cl_knowledge (235 MB) / cl_events (356 MB) tables
--    every 5-10 minutes even when there was nothing to do.
create index if not exists cl_knowledge_recheck_due on agenttender_internal.cl_knowledge (verification_next_at, id)
  where verification_status in ('CANDIDATE','VERIFIED') and verification_outcome is not null and verification_outcome<>'QUARANTINED';
create index if not exists cl_events_pending_captured on agenttender_internal.cl_events (captured_at) where status='PENDING';
create index if not exists cl_knowledge_embedding_pending on agenttender_internal.cl_knowledge (verified_at)
  where is_current and verification_status='VERIFIED' and (embedding is null or embedded_version is distinct from source_version);
create index if not exists cl_knowledge_active_status_source on agenttender_internal.cl_knowledge (verification_status, source_table, source_id)
  where is_current and verification_status in ('VERIFIED','CANDIDATE');
create index if not exists cl_knowledge_current_valid_until on agenttender_internal.cl_knowledge (valid_until)
  where is_current and valid_until is not null;

CREATE OR REPLACE FUNCTION public.agenttender_cl_verify_batch(p_limit integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'agenttender_internal'
AS $function$
DECLARE k record; r jsonb; n int:=0; errors int:=0; outcomes jsonb:='{}'; st timestamptz:=clock_timestamp(); runid bigint;
 lim int:=greatest(1,least(p_limit,1000));
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'service role required'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('cl_verify_batch_v1')) THEN RETURN jsonb_build_object('status','BUSY'); END IF;
 INSERT INTO agenttender_internal.cl_runs(stage,run_key) VALUES('VALIDATE','classify:'||gen_random_uuid()) RETURNING id INTO runid;
 -- Same rows and order as before; the OR is split into two index-backed
 -- branches so an empty run no longer reads the whole table.
 FOR k IN SELECT ck.id,ck.verification_attempts FROM agenttender_internal.cl_knowledge ck
  WHERE ck.id IN (
    (SELECT id FROM agenttender_internal.cl_knowledge
      WHERE verification_outcome IS NULL
        AND (verification_lease_until IS NULL OR verification_lease_until<now())
      ORDER BY id LIMIT lim)
    UNION ALL
    (SELECT id FROM agenttender_internal.cl_knowledge
      WHERE verification_status IN ('CANDIDATE','VERIFIED') AND verification_outcome IS NOT NULL
        AND verification_outcome<>'QUARANTINED' AND verification_next_at<=now()
        AND (verification_lease_until IS NULL OR verification_lease_until<now())))
  AND (ck.verification_outcome IS NULL OR (ck.verification_status IN ('CANDIDATE','VERIFIED') AND ck.verification_next_at<=now() AND ck.verification_outcome<>'QUARANTINED'))
  AND (ck.verification_lease_until IS NULL OR ck.verification_lease_until<now())
  ORDER BY (ck.verification_outcome IS NOT NULL),ck.id LIMIT lim FOR UPDATE OF ck SKIP LOCKED
 LOOP
  BEGIN
   r:=agenttender_internal.cl_classify_knowledge(k.id);
   UPDATE agenttender_internal.cl_knowledge SET
    verification_outcome=r->>'verification_result',verification_checked_at=clock_timestamp(),verification_next_at=now()+interval '24 hours',
    verification_attempts=0,verification_error=null,
    verification_status=CASE r->>'verification_result' WHEN 'STALE' THEN 'STALE' WHEN 'DUPLICATE' THEN 'REJECTED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'CONFLICT' THEN 'CONTRADICTORY' ELSE verification_status END,
    verified_at=CASE WHEN r->>'verification_result' IN ('STALE','DUPLICATE','REJECTED','CONFLICT') THEN null ELSE verified_at END,
    evidence=evidence||jsonb_build_object('verification',r-'supporting_evidence','classified_at',clock_timestamp())
   WHERE id=k.id;
   outcomes:=jsonb_set(outcomes,ARRAY[r->>'verification_result'],to_jsonb(coalesce((outcomes->>(r->>'verification_result'))::int,0)+1));
   n:=n+1;
  EXCEPTION WHEN OTHERS THEN
   errors:=errors+1;
   UPDATE agenttender_internal.cl_knowledge SET verification_attempts=verification_attempts+1,verification_error=left(SQLERRM,1000),
    verification_outcome=CASE WHEN verification_attempts+1>=5 THEN 'QUARANTINED' ELSE 'RETRYABLE_ERROR' END,
    verification_next_at=now()+make_interval(secs=>least(86400,60*power(2,least(verification_attempts,10))::int))
    WHERE id=k.id;
  END;
 END LOOP;
 r:=jsonb_build_object('status',CASE WHEN errors>0 THEN 'COMPLETED_WITH_FAILURES' ELSE 'SUCCEEDED' END,'processed',n,'failed',errors,'outcomes',outcomes,'duration_ms',extract(epoch FROM clock_timestamp()-st)*1000,'paid_provider_calls',0);
 UPDATE agenttender_internal.cl_runs SET status=CASE WHEN errors>0 THEN 'FAILED' ELSE 'SUCCEEDED' END,finished_at=clock_timestamp(),result=r WHERE id=runid;
 RETURN r||jsonb_build_object('run_id',runid);
END $function$;

-- 3. RFP readiness refresh (every 10 minutes): aggregated agenttender_rfp_readiness
--    (all tenders x 1.3 GB of chunks) twice to update a handful of GO tenders.
--    The view itself is unchanged.
CREATE OR REPLACE FUNCTION public.agenttender_refresh_rfp_readiness_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  create temp table if not exists _rfp_ready_counts(tender_id uuid primary key, is_target boolean, document_chunks bigint, embedded_document_chunks bigint) on commit drop;
  truncate _rfp_ready_counts;
  insert into _rfp_ready_counts
  select t.id,
    (t.qualification_status='GO' or t.status='will-bid'),
    (select count(*) from public.agenttender_ai_document_chunks c where c.tender_id=t.id and c.is_active and c.source_type='TENDER_DOCUMENT'),
    (select count(*) from public.agenttender_ai_document_chunks c where c.tender_id=t.id and c.is_active and c.source_type='TENDER_DOCUMENT' and (c.embedding is not null or c.embedding_local is not null))
  from public.agenttender_tenders t
  where t.id in (select id from public.agenttender_tenders where qualification_status='GO' or status='will-bid'
                 union select tender_id from public.agenttender_rfp_readiness_queue where resolved_at is null);

  insert into public.agenttender_rfp_readiness_queue(tender_id,reason,queued_at,resolved_at)
  select tender_id, case when document_chunks=0 then 'MISSING_RFP_CHUNKS' else 'EMBEDDINGS_INCOMPLETE' end, now(), null
  from _rfp_ready_counts
  where is_target and (document_chunks=0 or embedded_document_chunks<document_chunks)
  on conflict(tender_id) do update set reason=excluded.reason,resolved_at=null;
  get diagnostics n=row_count;

  update public.agenttender_rfp_readiness_queue q set resolved_at=now()
  from _rfp_ready_counts r
  where r.tender_id=q.tender_id and q.resolved_at is null and r.document_chunks>0 and r.embedded_document_chunks=r.document_chunks;
  return n;
end $function$;

-- 4. pg_cron run history had grown to 333k rows (261 MB) since May. Keep 3 days.
select cron.schedule('purge-cron-run-history-daily', '20 21 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '3 days'$$);
