begin;

-- Web-facing tender list view (does not replace agenttender_tender_list).
create or replace view public.agenttender_web_tender_list
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
  coalesce(q.status, t.qualification_status) as effective_qualification_status

from public.agenttender_tenders t
left join public.agenttender_qualification_results q
  on q.tender_id = t.id;

revoke all on public.agenttender_web_tender_list from anon, authenticated;
grant select on public.agenttender_web_tender_list to service_role;

-- Additional indexes for web filtering / search
create index if not exists agenttender_tenders_crawled_at_idx
  on public.agenttender_tenders(crawled_at);

create index if not exists agenttender_tenders_tender_value_idx
  on public.agenttender_tenders(tender_value);

create index if not exists agenttender_tenders_emd_amount_idx
  on public.agenttender_tenders(emd_amount);

create index if not exists agenttender_tenders_title_lower_idx
  on public.agenttender_tenders (lower(title));

create index if not exists agenttender_tenders_organization_lower_idx
  on public.agenttender_tenders (lower(organization));

create index if not exists agenttender_tenders_first_seen_at_idx
  on public.agenttender_tenders(first_seen_at);

create index if not exists agenttender_tenders_published_date_idx
  on public.agenttender_tenders(published_date);

commit;
