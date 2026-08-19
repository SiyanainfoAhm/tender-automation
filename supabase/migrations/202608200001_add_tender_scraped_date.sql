begin;

alter table public.agenttender_tenders
  add column if not exists scraped_date date;

create index if not exists idx_agenttender_tenders_scraped_date
  on public.agenttender_tenders (scraped_date desc);

comment on column public.agenttender_tenders.scraped_date is
  'Source/portal batch calendar date (REQUESTED_DATE), not database insertion time.';

create or replace function public.agenttender_preserve_scraped_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.scraped_date is not null then
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

drop trigger if exists agenttender_tenders_preserve_scraped_date
  on public.agenttender_tenders;

create trigger agenttender_tenders_preserve_scraped_date
before update on public.agenttender_tenders
for each row
execute function public.agenttender_preserve_scraped_date();

-- Backfill from known batch folder paths and Phase-1 runDate metadata only.
update public.agenttender_tenders t
set scraped_date = matched.scraped_date
from (
  select
    id,
    coalesce(
      case
        when raw_metadata->>'runDate' ~ '^\d{4}-\d{2}-\d{2}$'
          then (raw_metadata->>'runDate')::date
        else null
      end,
      case
        when replace(coalesce(local_folder_path, ''), '\', '/')
          ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then substring(
            replace(local_folder_path, '\', '/')
            from '([0-9]{4}-[0-9]{2}-[0-9]{2})'
          )::date
        else null
      end
    ) as scraped_date
  from public.agenttender_tenders
) matched
where t.id = matched.id
  and t.scraped_date is null
  and matched.scraped_date is not null;

drop view if exists public.agenttender_web_tender_list;

create view public.agenttender_web_tender_list
with (security_invoker = true)
as
select
  t.id,
  t.source_portal,
  t.source_tender_id,
  t.folder_id,
  t.title,
  t.organization,
  t.department,
  t.authority,
  t.category,
  t.project_category,
  t.tender_type,
  t.description,
  t.city,
  t.state,
  t.location_text,
  t.published_date,
  t.opening_date,
  t.closing_date,
  t.bid_submission_date,
  t.tender_value,
  t.tender_value_text,
  t.emd_amount,
  t.emd_text,
  t.currency,
  t.source_url,
  t.download_status,
  t.qualification_status,
  t.ai_summary_available,
  t.document_archive_available,
  t.first_seen_at,
  t.last_seen_at,
  t.crawled_at,
  t.supabase_synced_at,
  t.created_at,
  t.updated_at,
  t.scraped_date,

  q.id as qualification_id,
  q.decision_label,
  q.verdict,
  q.reason,
  q.required_action,
  q.confidence,
  q.manual_review_required,
  q.requires_detailed_tender_review,
  q.qualified_at,
  q.chat_url,
  coalesce(q.status, t.qualification_status) as effective_qualification_status,

  t.prescreen_status,
  t.prescreen_reason_code,
  t.prescreen_reason,
  t.chatgpt_eligible,
  t.decision_source,
  t.prescreened_at,
  t.prescreen_rules_version

from public.agenttender_tenders t
left join public.agenttender_qualification_results q
  on q.tender_id = t.id;

revoke all on public.agenttender_web_tender_list from anon, authenticated;
grant select on public.agenttender_web_tender_list to service_role;

commit;
