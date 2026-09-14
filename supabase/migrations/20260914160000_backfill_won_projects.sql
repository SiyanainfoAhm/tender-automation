begin;

-- Create project-execution rows for tenders already marked WON
-- before agenttender_won_projects existed. Award value/date fall back
-- to tender_value / scraped_date; users can edit later in the UI.

insert into public.agenttender_won_projects (
  company_id,
  tender_id,
  project_code,
  execution_status,
  award_date,
  final_award_value,
  client_department,
  notes
)
select
  c.id,
  t.id,
  'WON-' || lpad(
    nextval('public.agenttender_won_project_code_seq')::text,
    3,
    '0'
  ),
  'awarded',
  coalesce(t.scraped_date, current_date),
  coalesce(t.tender_value, 0),
  nullif(btrim(coalesce(t.department, '')), ''),
  'Backfilled from existing WON qualification status'
from public.agenttender_tenders t
cross join lateral (
  select id
  from public.agenttender_companies
  where name ilike 'Siyana Info Solutions%'
  order by name
  limit 1
) c
where t.qualification_status = 'WON'
  and not exists (
    select 1
    from public.agenttender_won_projects wp
    where wp.tender_id = t.id
  )
order by t.scraped_date nulls last, t.id;

commit;
