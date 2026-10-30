-- 2026-10-30: VERIFY tenders stuck in V2 step 3 (QUICK_TEXT_WAIT) — already applied live; this file records it.
--
-- 1. Document reader deadlock: the quick screen parks a tender as RETRY while it waits for text,
--    but the reader only picked up VERIFY files when the V2 task was WAITING. Now WAITING or RETRY.
--    Reader also takes the tenders closing soonest first.
-- 2. V2 step 3: 12 at a time (was 4), and tenders whose text just arrived go first.
-- 3. Scanned tender files on VERIFY tenders get OCR (every minute, 3 tenders, max 40 pages/file);
--    V2 holds such a tender until OCR finishes (same 2-day / 6-hour limits as the quick screen).
-- 4. Document extraction cron: 4 parallel workers (was 2).

-- 1 ---------------------------------------------------------------------------------------------
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
   AND (t.qualification_status IN ('VERIFY','GO','CONDITIONAL_GO') OR lower(coalesce(t.status,''))='will-bid' OR public.agenttender_chat_prep_active(t.id))
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
  WHERE (t.qualification_status IN ('VERIFY','GO','CONDITIONAL_GO') OR lower(coalesce(t.status,''))='will-bid' OR public.agenttender_chat_prep_active(t.id)) AND t.source_region='INDIAN'
    AND ((j.status IN ('PENDING','RETRY','OCR_PENDING') AND j.next_attempt_at<=now())
         OR (j.status='PROCESSING' AND j.lease_expires_at<now()))
    AND (t.qualification_status='GO'
     OR public.agenttender_chat_prep_active(t.id)
     OR NOT EXISTS(SELECT 1 FROM public.agenttender_tender_route_assignments a WHERE a.tender_id=j.tender_id AND a.route='ORCHESTRATOR')
     OR EXISTS(SELECT 1 FROM public.agenttender_orch_v2_tasks q WHERE q.tender_id=j.tender_id
       AND jsonb_array_length(coalesce(q.checkpoint#>'{progressive_evidence_request,questions}','[]'))>0
       AND (q.checkpoint#>>'{progressive_evidence_request,selected_document_id}'=j.document_id::text
         OR (q.checkpoint#>>'{progressive_evidence_request,selected_document_id}' IS NULL AND EXISTS(
           SELECT 1 FROM public.agenttender_document_acquisition_jobs ac WHERE ac.tender_id=j.tender_id AND ac.document_id=j.document_id))))
     OR (t.qualification_status='VERIFY' AND EXISTS(SELECT 1 FROM public.agenttender_orch_v2_tasks q WHERE q.tender_id=j.tender_id
       AND q.state IN ('WAITING','RETRY') AND q.last_error LIKE '%DEPENDENCY_PENDING:%')))
    AND j.failure_count<8
  ORDER BY public.agenttender_chat_prep_active(j.tender_id) DESC, t.closing_date NULLS LAST, j.next_attempt_at,j.created_at
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
$function$;

-- 2 + 3 (hold) -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agenttender_orch_v2_claim(p_limit integer DEFAULT 12)
 RETURNS TABLE(tender_id uuid, step integer, lease_token uuid, checkpoint jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
 if current_user not in ('postgres','supabase_admin','service_role') then
   raise exception 'service role required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('agenttender_orch_v2_claim',0)); perform public.agenttender_orch_v2_recover_expired();

 return query
 with caps(cap_step, cap) as (
   values (1,20),(2,20),(3,12),(4,10),(5,2),(6,8)
 ),
 running as (
   select r.step as run_step, count(*) as n
   from public.agenttender_orch_v2_tasks r
   where r.state = 'RUNNING' and r.leased_until > now()
   group by r.step
 ),
 eligible as (
   select q.tender_id as e_tender, q.step as e_step,
          row_number() over (
            partition by q.step
            order by case when q.step=3 then (q.checkpoint#>>'{dependency_change,at}')::timestamptz end desc nulls last,
                     case when q.step=3 then 0 when q.priority <= -1000000 then 1 else 0 end,
                     case when q.step=3 then 0 else q.priority end desc, q.ready_at, q.created_at
          ) as rn
   from public.agenttender_orch_v2_tasks q
   join public.agenttender_tenders t on t.id = q.tender_id
   join public.agenttender_tender_route_assignments a
     on a.tender_id = q.tender_id and a.route = 'ORCHESTRATOR'
   where (t.qualification_status in ('VERIFY','REVIEW') OR (q.step=6 AND t.qualification_status='CONDITIONAL_GO' AND t.decision_source='ORCHESTRATOR_V2' AND q.checkpoint ? 'revalidate_unsupported_auto_decision'))
     and (q.failures < 5 OR (q.step=3 AND q.checkpoint ? 'dependency_change'))
     and q.state in ('WAITING','RETRY')
     and q.ready_at <= now()
     and not (q.step = 3
       and t.closing_date > current_date + 2
       and coalesce((q.checkpoint#>>'{quick_screen,first_seen_at}')::timestamptz, now()) > now() - interval '6 hours'
       and exists (select 1 from public.agenttender_document_ingestion_jobs j
                   where j.tender_id = q.tender_id and j.status = 'EMPTY' and coalesce(j.last_error,'') ilike '%OCR_REQUIRED%'
                     and not exists (select 1 from public.agenttender_document_extractions e
                                     where e.document_id = j.document_id and e.extraction_status = 'SUCCESS'
                                       and length(coalesce(e.extracted_text,'')) > 200)
                     and not exists (select 1 from public.agenttender_tender_ocr_operations o
                                     where o.document_id = j.document_id and o.status = 'FAILED')))
 ),
 candidates as (
   select e.e_tender, e.rn as c_rn
   from eligible e
   join caps c on c.cap_step = e.e_step
   left join running r on r.run_step = e.e_step
   where e.rn <= greatest(c.cap - coalesce(r.n, 0), 0)
 ),
 picked as (
   select q.tender_id as p_tender
   from public.agenttender_orch_v2_tasks q
   join candidates c on c.e_tender = q.tender_id
   where q.state in ('WAITING','RETRY')
   -- round-robin across steps (each step's 1st, then each step's 2nd, ...),
   -- later steps first within each round
   order by c.c_rn, q.step desc
   for update of q skip locked
   limit least(greatest(coalesce(p_limit, 12), 1), 25)
 ),
 updated as (
   update public.agenttender_orch_v2_tasks q
      set state = 'RUNNING',
          lease_token = gen_random_uuid(),
          leased_until = now() + case q.step
                                   when 3 then interval '6 minutes'
                                   when 5 then interval '4 minutes'
                                   when 6 then interval '10 minutes'
                                   else interval '2 minutes' end,
          updated_at = now()
     from picked p
    where p.p_tender = q.tender_id
   returning q.tender_id, q.step, q.lease_token, q.checkpoint
 )
 select u.tender_id, u.step, u.lease_token, u.checkpoint from updated u;
end
$function$;

-- 3 (OCR feeder) ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agenttender_dispatch_verify_ocr(p_limit integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT t.id
    FROM public.agenttender_tenders t
    JOIN public.agenttender_orch_v2_tasks q ON q.tender_id = t.id AND q.state <> 'DONE'
    WHERE t.qualification_status = 'VERIFY' AND t.source_region = 'INDIAN'
      AND coalesce(t.closing_date, current_date) >= current_date
      AND EXISTS (SELECT 1 FROM public.agenttender_document_ingestion_jobs j
                  WHERE j.tender_id = t.id AND j.status = 'EMPTY' AND coalesce(j.last_error,'') ILIKE '%OCR_REQUIRED%'
                    AND NOT EXISTS (SELECT 1 FROM public.agenttender_document_extractions e
                                    WHERE e.document_id = j.document_id AND e.extraction_status = 'SUCCESS'
                                      AND length(coalesce(e.extracted_text,'')) > 200)
                    AND NOT EXISTS (SELECT 1 FROM public.agenttender_tender_ocr_operations o
                                    WHERE o.document_id = j.document_id AND o.status IN ('FAILED','SUBMITTING')))
    ORDER BY t.closing_date NULLS LAST
    LIMIT greatest(p_limit, 1)
  LOOP
    PERFORM net.http_post(
      url := 'https://fvveqziyusjgqejowkfp.supabase.co/functions/v1/agenttender-tender-ocr-worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='agenttender_ingestion_service_key' LIMIT 1)),
      body := jsonb_build_object('tender_id', r.id, 'allow_external_ocr', true, 'max_ocr_pages', 40),
      timeout_milliseconds := 150000);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

-- cron (idempotent) -------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenttender-verify-tender-ocr') THEN
    PERFORM cron.unschedule('agenttender-verify-tender-ocr');
  END IF;
  PERFORM cron.schedule('agenttender-verify-tender-ocr', '* * * * *', 'select public.agenttender_dispatch_verify_ocr(3);');

  -- 4: document extraction runs 4 parallel workers (was 2)
  PERFORM cron.alter_job(jobid, command := replace(command, 'generate_series(1,2)', 'generate_series(1,4)'))
  FROM cron.job WHERE jobname = 'agenttender-document-extraction-worker' AND command LIKE '%generate_series(1,2)%';
END $$;
