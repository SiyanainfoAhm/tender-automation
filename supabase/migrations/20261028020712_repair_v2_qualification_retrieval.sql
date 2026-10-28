CREATE OR REPLACE FUNCTION public.agenttender_global_chat_snapshot(p_company uuid, p_user uuid, p_plan jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare result jsonb; intent text:=coalesce(p_plan->>'intent','search'); today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 if not exists(select 1 from agenttender_company_memberships m join agenttender_users u on u.id=m.user_id where m.company_id=p_company and m.user_id=p_user and m.status='active' and u.is_active and u.company_id=p_company) then raise exception 'Company access denied'; end if;
 with base as materialized (
 select t.id,t.source_tender_id,t.emd_amount,t.title,t.organization,t.source_region,t.location_text,t.currency,t.tender_value,t.tender_value_text,t.closing_date,(t.closing_date-today) days_until_close,(t.closing_date>=today and t.closing_date<today+7) closing_in_next_seven_days,case when coalesce(t.location_text,'') ~* '(United States|\mUSA\M)' then 'USA' else null end country_hint,t.scraped_date,t.project_category,t.description,t.qualification_status,t.status as recorded_status,t.prescreen_reason,t.download_status,t.ai_bid_confidence,
 coalesce(t.qualification_status,'NOT_EVALUATED') bucket
 from agenttender_tenders t
 ), filtered as materialized (
 select b.* from base b where
 (not (p_plan ? 'ids') or jsonb_array_length(p_plan->'ids')=0 or b.id::text in (select jsonb_array_elements_text(p_plan->'ids')))
 and (coalesce(jsonb_array_length(p_plan->'source_ids'),0)=0 or b.source_tender_id in (select jsonb_array_elements_text(p_plan->'source_ids')))
 and (not (p_plan ? 'status') or p_plan->>'status'='' or b.bucket=p_plan->>'status' or upper(coalesce(b.recorded_status,''))=p_plan->>'status')
 and (coalesce(p_plan->>'region','')='' or b.source_region=p_plan->>'region')
 and (coalesce(p_plan->>'country','')<>'USA' or coalesce(b.location_text,'') ~* '(United States|\mUSA\M|\mU\.S\.A\.\M)')
 and (coalesce(p_plan->>'search','')='' or to_tsvector('english',coalesce(b.title,'')||' '||coalesce(b.description,'')||' '||coalesce(b.organization,'')||' '||coalesce(b.project_category,'')) @@ websearch_to_tsquery('english',left(p_plan->>'search',200)))
 and (intent<>'today' or b.scraped_date=today)
 and (intent<>'closing' or (b.closing_date>=today and b.closing_date<today+7))
 and (intent not in ('priorities','ranking','usa_ai') or (b.closing_date is null or b.closing_date>=today) and b.bucket not in ('NO_GO','DUPLICATE','DELETE','LOST','DISQUALIFIED','WON','CANCELLED','SUBMITTED'))
 and (intent<>'conditional' or b.bucket='CONDITIONAL_GO')
 and (intent<>'verify' or b.bucket='VERIFY' or upper(coalesce(b.recorded_status,''))='VERIFY')
 and (intent<>'pq' or coalesce(p_plan->>'qualification','false')='true' or b.bucket='GO')
 and (intent<>'missing' or b.bucket='GO')
 ), chosen as (
 select * from filtered order by case bucket when 'GO' then 0 when 'CONDITIONAL_GO' then 1 when 'VERIFY' then 2 else 3 end,ai_bid_confidence desc nulls last,closing_date asc nulls last,id limit (case when coalesce(p_plan->>'qualification','false')='true' then 6 else 30 end) offset least(100000,greatest(0,coalesce((p_plan->>'offset')::integer,0)))
 )
 select jsonb_build_object('as_of',now(),'today_india',today,'total',(select count(*) from base),
 'status_counts',(select coalesce(jsonb_object_agg(bucket,n),'{}') from (select bucket,count(*) n from base group by bucket) c),
 'recorded_status_counts',(select coalesce(jsonb_object_agg(s,n),'{}') from (select coalesce(recorded_status,'UNSET') s,count(*) n from base group by 1) c),
 'matching_total',(select count(*) from filtered),'candidate_limit',case when coalesce(p_plan->>'qualification','false')='true' then 6 else 30 end,'offset',least(100000,greatest(0,coalesce((p_plan->>'offset')::integer,0))),
 'tenders',coalesce((select jsonb_agg(to_jsonb(c)-'description'||jsonb_build_object('description',left(c.description,2200))) from chosen c),'[]'),
 'workspace_checklists',case when coalesce(p_plan->>'bids_allowed','false')='true' then
 coalesce((select jsonb_agg(x) from (select w.tender_id,w.workspace_status,w.submission_status,w.checklist_preparation_status,count(i.id) total_items,count(i.id) filter(where i.completion_status<>'COMPLETED' and not i.manual_completed) pending_items from agenttender_bid_workspaces w left join agenttender_bid_checklist_items i on i.workspace_id=w.id and i.company_id=p_company and not i.is_archived where w.company_id=p_company and w.tender_id in(select id from chosen) group by w.id) x),'[]') else '[]'::jsonb end,
 'pending_requirements',case when coalesce(p_plan->>'bids_allowed','false')='true' then coalesce((select jsonb_agg(x) from (select tender_id,requirement_name,category,processing_type,completion_status,manual_completed from agenttender_bid_checklist_items where company_id=p_company and not is_archived and tender_id in(select id from chosen) and completion_status<>'COMPLETED' and not manual_completed order by mandatory desc,display_order limit 80) x),'[]') else '[]'::jsonb end,
 'queue_counts',coalesce((select jsonb_agg(x) from (select step,state,count(*) total,sum(failures) failures,min(updated_at) oldest_update from agenttender_orch_v2_tasks where tender_id in(select id from filtered) group by step,state) x),'[]')
 ) into result;
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.agenttender_commit_document_text_chunks(p_tender_id uuid, p_document_id uuid, p_source_id text, p_document_name text, p_document_url text, p_document_type text, p_content_hash text, p_chunks jsonb, p_metadata jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$ DECLARE n integer; item jsonb; company uuid; BEGIN PERFORM pg_advisory_xact_lock(hashtextextended(p_source_id,0));
 -- 2026-10-27: also allow will-bid and tenders asked about in the chatbot (any status).
 PERFORM 1 FROM public.agenttender_tenders WHERE id=p_tender_id AND source_region='INDIAN'
   AND (qualification_status IN ('VERIFY','REVIEW','GO','CONDITIONAL_GO') OR upper(coalesce(status,'')) IN ('VERIFY','REVIEW','GO','WILL-BID') OR public.agenttender_chat_prep_active(id)) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tender is no longer eligible for automatic indexing'; END IF; IF p_document_id IS NOT NULL THEN SELECT company_id INTO company FROM public.agenttender_tender_documents WHERE id=p_document_id AND tender_id=p_tender_id; IF company IS DISTINCT FROM 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid THEN RAISE EXCEPTION 'Document scope mismatch'; END IF; ELSE company:='a1b2c3d4-e5f6-7890-abcd-ef1234567890'; END IF; IF p_chunks IS NULL OR jsonb_typeof(p_chunks)<>'array' OR jsonb_array_length(p_chunks)=0 THEN RAISE EXCEPTION 'No chunks to commit'; END IF; FOR item IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP IF length(regexp_replace(item->>'content','--- PAGE [0-9]+ ---|-- [0-9]+ of [0-9]+ --|[[:space:]]','','g'))<=20 THEN RAISE EXCEPTION 'Non-substantive chunk'; END IF; END LOOP; -- Replays with an identical indexed source retain valid chunks and embeddings.
 SELECT count(*) INTO n FROM public.agenttender_ai_document_chunks c WHERE c.is_active AND c.tender_id=p_tender_id AND c.source_type='TENDER_DOCUMENT' AND c.source_id=p_source_id;
 IF n>0 AND EXISTS(SELECT 1 FROM public.agenttender_ai_document_index_status s WHERE s.source_type='TENDER_DOCUMENT' AND s.source_id=p_source_id AND s.content_hash=p_content_hash AND s.status='INDEXED') THEN RETURN n; END IF;
 UPDATE public.agenttender_ai_document_chunks SET is_active=false,updated_at=now() WHERE is_active AND source_type='TENDER_DOCUMENT' AND tender_id=p_tender_id AND (source_id=p_source_id OR (p_document_id IS NOT NULL AND metadata->>'tender_document_id'=p_document_id::text AND document_name=p_document_name)); INSERT INTO public.agenttender_ai_document_chunks(company_id,tender_id,source_type,source_id,document_name,document_url,document_type,page_number,page_start,page_end,section,chunk_index,content,content_hash,embedding,metadata,is_active) SELECT company,p_tender_id,'TENDER_DOCUMENT',p_source_id,p_document_name,p_document_url,p_document_type,(v->>'page_number')::int,(v->>'page_start')::int,(v->>'page_end')::int,v->>'section',(v->>'chunk_index')::int,v->>'content',v->>'content_hash',NULL::vector,p_metadata || coalesce(v->'metadata','{}'::jsonb),true FROM jsonb_array_elements(p_chunks) v; GET DIAGNOSTICS n=ROW_COUNT; INSERT INTO public.agenttender_ai_document_index_status(company_id,tender_id,source_type,source_id,document_name,document_url,content_hash,status,chunk_count,last_indexed_at,last_attempted_at,error_message,updated_at) VALUES(company,p_tender_id,'TENDER_DOCUMENT',p_source_id,p_document_name,p_document_url,p_content_hash,'INDEXED',n,now(),now(),NULL,now()) ON CONFLICT(source_type,source_id) DO UPDATE SET content_hash=excluded.content_hash,status='INDEXED',chunk_count=n,last_indexed_at=now(),last_attempted_at=now(),error_message=NULL,updated_at=now(); RETURN n; END $function$
;

CREATE OR REPLACE FUNCTION public.agenttender_pending_extractions(p_limit integer DEFAULT 100, p_date date DEFAULT NULL::date)
 RETURNS TABLE(scraped_date date, source_tender_id text, document_kind text, file_name text, source_url text, extracted_text text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select e.scraped_date,e.source_tender_id,e.document_kind,e.file_name,e.source_url,e.extracted_text,e.updated_at from public.agenttender_document_extractions e join public.agenttender_tenders t on t.scraped_date=e.scraped_date and t.source_tender_id=e.source_tender_id left join public.agenttender_ai_document_index_status s on s.source_type='TENDER_DOCUMENT' and s.source_id=e.scraped_date::text||':'||e.source_tender_id||':'||e.document_kind||':'||e.file_name where t.source_region='INDIAN'
 and (
   ( (t.qualification_status IN ('GO','CONDITIONAL_GO') OR (t.qualification_status='VERIFY' AND t.prescreen_status='NEEDS_DOCUMENTS') OR upper(coalesce(t.status,'')) IN ('VERIFY','REVIEW','GO','WILL-BID'))
     and lower(coalesce(t.status,'')) not in ('submitted')
     and NOT (t.qualification_status='VERIFY' AND EXISTS(SELECT 1 FROM public.agenttender_tender_route_assignments a WHERE a.tender_id=t.id AND a.route='ORCHESTRATOR')
          AND NOT EXISTS(SELECT 1 FROM public.agenttender_tender_documents d WHERE d.tender_id=t.id AND d.storage_status='COMPLETED')) )
   OR public.agenttender_chat_prep_active(t.id) )
 and e.extraction_status='SUCCESS' and length(coalesce(e.extracted_text,''))>0 and (p_date is null or e.scraped_date=p_date) and (s.source_id is null or s.status<>'INDEXED' or s.last_indexed_at is null or e.updated_at>s.last_indexed_at) and (s.status is distinct from 'INDEX_FAILED' or s.last_attempted_at is null or s.last_attempted_at<now()-interval '15 minutes' or e.updated_at>s.last_attempted_at)
 order by public.agenttender_chat_prep_active(t.id) desc, s.last_attempted_at nulls first,e.updated_at limit least(greatest(p_limit,1),250) $function$
;

CREATE OR REPLACE FUNCTION public.agenttender_dispatch_active_tender_embeddings(p_batch integer DEFAULT 40)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_n integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='agenttender_ingestion_service_key' LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION 'ingestion service key missing'; END IF;
  SELECT count(net.http_post(
           url:='https://fvveqziyusjgqejowkfp.supabase.co/functions/v1/agenttender-local-embedding-worker',
           headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
           body:=jsonb_build_object('tender_id',c.tender_id,'chunk_id',c.id),
           timeout_milliseconds:=120000))
    INTO v_n
  FROM (
    SELECT c.id, c.tender_id, public.agenttender_chat_prep_active(t.id) chat
    FROM public.agenttender_ai_document_chunks c
    JOIN public.agenttender_tenders t ON t.id=c.tender_id
    WHERE c.is_active AND c.embedding_local IS NULL
      AND c.source_type='TENDER_DOCUMENT'
      AND length(trim(coalesce(c.content,'')))>0
      AND t.source_region='INDIAN'
      AND ( ( (t.qualification_status IN ('GO','VERIFY','CONDITIONAL_GO') OR upper(coalesce(t.status,'')) IN ('VERIFY','REVIEW','GO','WILL-BID'))
              AND lower(coalesce(t.status,'')) NOT IN ('submitted','no_bid')
              AND (t.closing_date IS NULL OR t.closing_date >= current_date) )
            OR public.agenttender_chat_prep_active(t.id) )
      AND NOT EXISTS (SELECT 1 FROM agenttender_internal.v2_embedding_leases l WHERE l.chunk_id=c.id AND l.leased_until>now())
      AND NOT EXISTS (SELECT 1 FROM public.agenttender_embedding_queue q WHERE q.chunk_id=c.id
                      AND (q.status='failed' OR q.available_at>now() OR (q.status='processing' AND q.claimed_at>now()-interval '3 minutes')))
    ORDER BY 3 DESC,
             CASE WHEN t.qualification_status='GO' OR lower(coalesce(t.status,''))='will-bid' THEN 0 ELSE 1 END,
             t.closing_date NULLS LAST, c.created_at, c.id
    LIMIT least(greatest(p_batch,1),80)
  ) c;
  RETURN v_n;
END $function$
;
revoke all on function public.agenttender_global_chat_snapshot(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agenttender_global_chat_snapshot(uuid,uuid,jsonb) to service_role;
