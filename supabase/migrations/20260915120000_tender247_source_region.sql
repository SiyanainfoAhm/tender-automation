-- Tender247 Global region support on the shared tenders table.
-- Existing rows default to INDIAN so Indian pipeline behavior is unchanged.

begin;

alter table public.agenttender_tenders
  add column if not exists source_region text;

update public.agenttender_tenders
set source_region = 'INDIAN'
where source_region is null;

alter table public.agenttender_tenders
  alter column source_region set default 'INDIAN';

alter table public.agenttender_tenders
  alter column source_region set not null;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_source_region_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_source_region_check
  check (source_region in ('INDIAN', 'GLOBAL'));

-- Daily snapshot identity includes region so India vs Global are distinct.
alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_source_date_unique;

-- Safety: collapse accidental duplicates before new unique key.
delete from public.agenttender_tenders t
using public.agenttender_tenders d
where t.source_portal = d.source_portal
  and t.source_region = d.source_region
  and t.source_tender_id = d.source_tender_id
  and t.scraped_date = d.scraped_date
  and t.id > d.id;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_source_date_unique
  unique (source_portal, source_region, source_tender_id, scraped_date);

create index if not exists agenttender_tenders_source_region_idx
  on public.agenttender_tenders (source_region);

create index if not exists agenttender_tenders_portal_region_date_idx
  on public.agenttender_tenders (source_portal, source_region, scraped_date);

drop view if exists public.agenttender_web_tender_list;

create view public.agenttender_web_tender_list
with (security_invoker = true)
as
select
  t.id,
  t.source_portal,
  t.source_region,
  t.source_tender_id,
  t.folder_id,
  t.reference_no,
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
  t.documents_zip_url,
  t.ai_summary_url,
  t.first_seen_at,
  t.last_seen_at,
  t.crawled_at,
  t.supabase_synced_at,
  t.created_at,
  t.updated_at,
  t.scraped_date,
  t.duplicate_of_source_tender_id,
  t.duplicate_of_tender_id,
  t.duplicate_match_kind,
  t.raw_metadata->>'screeningReason' as screening_reason,
  (case lower(coalesce(t.raw_metadata->>'msmeExemption', ''))
    when 'true' then true
    when 'false' then false
    else null
  end) as msme_exemption,
  (case lower(coalesce(t.raw_metadata->>'startupExemption', ''))
    when 'true' then true
    when 'false' then false
    else null
  end) as startup_exemption,

  q.id as qualification_id,
  q.decision_label,
  q.verdict,
  coalesce(q.reason, t.raw_metadata->>'screeningReason') as reason,
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
