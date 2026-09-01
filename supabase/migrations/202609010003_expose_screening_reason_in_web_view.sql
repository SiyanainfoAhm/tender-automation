begin;

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
  t.raw_metadata->>'screeningReason' as screening_reason,

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

-- Backfill duplicate reference columns from GPT screening reason text.
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
  and t.raw_metadata->>'screeningReason' is not null;

update public.agenttender_tenders dup
set duplicate_of_tender_id = sub.canonical_id
from (
  select
    dup2.id as duplicate_id,
    (
      select c.id
      from public.agenttender_tenders c
      where c.source_portal = dup2.source_portal
        and c.source_tender_id = dup2.duplicate_of_source_tender_id
        and c.id <> dup2.id
      order by c.first_seen_at asc nulls last, c.created_at asc
      limit 1
    ) as canonical_id
  from public.agenttender_tenders dup2
  where dup2.qualification_status = 'DUPLICATE'
    and dup2.duplicate_of_source_tender_id is not null
    and dup2.duplicate_of_tender_id is null
) sub
where dup.id = sub.duplicate_id
  and sub.canonical_id is not null;

insert into public.agenttender_qualification_results (
  tender_id,
  source_portal,
  source_tender_id,
  status,
  decision_label,
  verdict,
  reason,
  required_action,
  confidence,
  matched_criteria,
  failed_criteria,
  unclear_criteria,
  missing_documents,
  conditions,
  partnership_required_for,
  partnership_mode_allowed,
  manual_review_required,
  requires_detailed_tender_review,
  evidence_files,
  raw_response,
  raw_result,
  qualified_at
)
select
  t.id,
  t.source_portal,
  t.source_tender_id,
  'DUPLICATE',
  'Duplicate',
  'DUPLICATE',
  t.raw_metadata->>'screeningReason',
  null,
  1,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  false,
  '["CHATGPT_RUN_EXCEL"]'::jsonb,
  t.raw_metadata->>'screeningReason',
  coalesce(t.raw_metadata, '{}'::jsonb),
  now()
from public.agenttender_tenders t
where t.qualification_status = 'DUPLICATE'
  and t.raw_metadata->>'screeningReason' is not null
  and not exists (
    select 1
    from public.agenttender_qualification_results q
    where q.tender_id = t.id
  )
on conflict (source_portal, source_tender_id) do update
set
  status = excluded.status,
  decision_label = excluded.decision_label,
  verdict = excluded.verdict,
  reason = excluded.reason,
  raw_response = excluded.raw_response,
  raw_result = excluded.raw_result,
  qualified_at = excluded.qualified_at;

commit;
