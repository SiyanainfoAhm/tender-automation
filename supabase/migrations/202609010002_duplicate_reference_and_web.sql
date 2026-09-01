begin;

-- Allow DUPLICATE on qualification results (Phase-1 screening upsert).
alter table public.agenttender_qualification_results
  drop constraint if exists agenttender_qualification_results_status_check;

alter table public.agenttender_qualification_results
  add constraint agenttender_qualification_results_status_check
  check (
    status in (
      'GO',
      'CONDITIONAL_GO',
      'PARTNER_BID',
      'VERIFY',
      'NO_GO',
      'DUPLICATE',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED'
    )
  );

-- Structured duplicate reference on tender rows.
alter table public.agenttender_tenders
  add column if not exists duplicate_of_source_tender_id text,
  add column if not exists duplicate_of_tender_id uuid references public.agenttender_tenders(id) on delete set null,
  add column if not exists duplicate_match_kind text;

comment on column public.agenttender_tenders.duplicate_of_source_tender_id is
  'Tender247 portal ID of the canonical tender this duplicate matches.';
comment on column public.agenttender_tenders.duplicate_of_tender_id is
  'Supabase tender row id of the canonical matched tender (when resolvable).';
comment on column public.agenttender_tenders.duplicate_match_kind is
  'How the duplicate was detected: tender247_id, reference, authority_brief_deadline, historical.';

create index if not exists agenttender_tenders_duplicate_of_tender_id_idx
  on public.agenttender_tenders(duplicate_of_tender_id);

create index if not exists agenttender_tenders_duplicate_of_source_tender_id_idx
  on public.agenttender_tenders(duplicate_of_source_tender_id);

-- Backfill portal ID + match kind from qualification reason text.
update public.agenttender_tenders t
set
  duplicate_of_source_tender_id = coalesce(
    t.duplicate_of_source_tender_id,
    (regexp_match(q.reason, 'Matches Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(q.reason, 'as Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(q.reason, 'matches existing Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(q.reason, 'Duplicate Tender247 ID:\s*(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'Matches Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'as Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'matches existing Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'Duplicate Tender247 ID:\s*(\d+)', 'i'))[1]
  ),
  duplicate_match_kind = coalesce(
    t.duplicate_match_kind,
    case
      when coalesce(q.reason, t.raw_metadata->>'screeningReason', '') ~* 'Matches Tender247 ID\s+\d+'
        then 'reference'
      when coalesce(q.reason, t.raw_metadata->>'screeningReason', '') ~* 'as Tender247 ID\s+\d+'
        then 'authority_brief_deadline'
      when coalesce(q.reason, t.raw_metadata->>'screeningReason', '') ~* 'matches existing Tender247 ID\s+\d+'
        then 'historical'
      when coalesce(q.reason, t.raw_metadata->>'screeningReason', '') ~* 'Duplicate Tender247 ID:\s*\d+'
        then 'tender247_id'
      else null
    end
  )
from public.agenttender_qualification_results q
where q.tender_id = t.id
  and coalesce(q.status, t.qualification_status) = 'DUPLICATE';

update public.agenttender_tenders t
set
  duplicate_of_source_tender_id = coalesce(
    t.duplicate_of_source_tender_id,
    (regexp_match(t.raw_metadata->>'screeningReason', 'Matches Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'as Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'matches existing Tender247 ID\s+(\d+)', 'i'))[1],
    (regexp_match(t.raw_metadata->>'screeningReason', 'Duplicate Tender247 ID:\s*(\d+)', 'i'))[1]
  ),
  duplicate_match_kind = coalesce(
    t.duplicate_match_kind,
    case
      when t.raw_metadata->>'screeningReason' ~* 'Matches Tender247 ID\s+\d+'
        then 'reference'
      when t.raw_metadata->>'screeningReason' ~* 'as Tender247 ID\s+\d+'
        then 'authority_brief_deadline'
      when t.raw_metadata->>'screeningReason' ~* 'matches existing Tender247 ID\s+\d+'
        then 'historical'
      when t.raw_metadata->>'screeningReason' ~* 'Duplicate Tender247 ID:\s*\d+'
        then 'tender247_id'
      else null
    end
  )
where t.qualification_status = 'DUPLICATE'
  and t.duplicate_of_source_tender_id is null
  and t.raw_metadata->>'screeningReason' is not null;

-- Resolve FK to canonical tender row (earliest first_seen for same portal + portal id).
update public.agenttender_tenders dup
set duplicate_of_tender_id = canon.id
from lateral (
  select c.id
  from public.agenttender_tenders c
  where c.source_portal = dup.source_portal
    and c.source_tender_id = dup.duplicate_of_source_tender_id
    and c.id <> dup.id
  order by c.first_seen_at asc nulls last, c.created_at asc
  limit 1
) canon
where dup.duplicate_of_source_tender_id is not null
  and dup.duplicate_of_tender_id is null
  and coalesce(dup.qualification_status, '') = 'DUPLICATE';

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
