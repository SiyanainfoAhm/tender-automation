-- READ ONLY.  Historical Tender247 pipeline-run audit.
-- Run in Supabase SQL editor before proposing any correction; it neither
-- updates pipeline summaries nor touches canonical documents/SharePoint data.

with runs as (
  select id, run_date, status, started_at, finished_at, summary,
    coalesce(summary -> 'rawResponse' -> 'Data', summary -> 'rawResponse' -> 'data', '[]'::jsonb) as source_rows
  from public.agenttender_pipeline_runs
  where portal = 'TENDER247' and mode = 'api_sync'
    and run_date in (date '2026-10-08', date '2026-10-09', date '2026-10-10', date '2026-10-11')
), source_ids as (
  select r.id as run_id, r.run_date,
    coalesce(item ->> 'tenderid', item ->> 'tenderId') as tender247_tender_id
  from runs r cross join lateral jsonb_array_elements(r.source_rows) item
), deduped as (
  select distinct run_id, run_date, tender247_tender_id
  from source_ids where tender247_tender_id is not null
)
select r.id, r.run_date, r.status, r.started_at, r.finished_at,
  r.summary ->> 'tenderCount' as initial_tender_count,
  r.summary #>> '{documents,documentsDiscovered}' as initial_documents_discovered,
  r.summary #>> '{documents,manifestsFailed}' as initial_manifests_failed,
  count(d.tender247_tender_id) as persisted_unique_source_ids
from runs r left join deduped d on d.run_id = r.id
group by r.id, r.run_date, r.status, r.started_at, r.finished_at, r.summary
order by r.run_date, r.started_at;

-- Exact source-ID-set comparison. `only_left`/`only_right` must be zero to
-- establish equality; matching summary counts alone are not evidence.
with source_ids as (
  select distinct r.id as run_id, coalesce(item ->> 'tenderid', item ->> 'tenderId') as tender247_tender_id
  from public.agenttender_pipeline_runs r
  cross join lateral jsonb_array_elements(coalesce(r.summary -> 'rawResponse' -> 'Data', r.summary -> 'rawResponse' -> 'data', '[]'::jsonb)) item
  where r.id in ('2c06429b-cf3e-4e45-9c5b-f7936ec02c9b', 'd7c8ea34-4ed0-4d9b-808d-4a29dc63a789', 'f08b27be-3227-45ef-8461-df3e82d23e8a')
), pairs as (
  select * from (values
    ('2026-10-09-first'::text, '2c06429b-cf3e-4e45-9c5b-f7936ec02c9b'::uuid, '2026-10-10'::text, 'f08b27be-3227-45ef-8461-df3e82d23e8a'::uuid),
    ('2026-10-09-later', 'd7c8ea34-4ed0-4d9b-808d-4a29dc63a789'::uuid, '2026-10-10', 'f08b27be-3227-45ef-8461-df3e82d23e8a'::uuid)
  ) as p(left_label, left_run, right_label, right_run)
)
select p.left_label, p.right_label,
  (select count(*) from source_ids s where s.run_id = p.left_run and not exists (select 1 from source_ids x where x.run_id = p.right_run and x.tender247_tender_id = s.tender247_tender_id)) as only_left,
  (select count(*) from source_ids s where s.run_id = p.right_run and not exists (select 1 from source_ids x where x.run_id = p.left_run and x.tender247_tender_id = s.tender247_tender_id)) as only_right,
  (select count(*) from source_ids s where s.run_id = p.left_run and exists (select 1 from source_ids x where x.run_id = p.right_run and x.tender247_tender_id = s.tender247_tender_id)) as intersection
from pairs p;
