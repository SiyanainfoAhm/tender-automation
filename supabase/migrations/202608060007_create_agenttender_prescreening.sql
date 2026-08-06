begin;

-- =========================================================
-- Pre-screening columns on agenttender_tenders
-- (202608060005 already used for saved_views)
-- =========================================================

alter table public.agenttender_tenders
  add column if not exists prescreen_status text;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_prescreen_status_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_prescreen_status_check
  check (
    prescreen_status is null
    or prescreen_status in (
      'NOT_RUN',
      'PASSED',
      'REJECTED',
      'MANUAL_REVIEW',
      'ERROR'
    )
  );

alter table public.agenttender_tenders
  add column if not exists prescreen_reason_code text;

alter table public.agenttender_tenders
  add column if not exists prescreen_reason text;

alter table public.agenttender_tenders
  add column if not exists chatgpt_eligible boolean;

alter table public.agenttender_tenders
  add column if not exists decision_source text;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_decision_source_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_decision_source_check
  check (
    decision_source is null
    or decision_source in (
      'PRESCREEN',
      'CHATGPT',
      'MANUAL'
    )
  );

alter table public.agenttender_tenders
  add column if not exists prescreened_at timestamptz;

alter table public.agenttender_tenders
  add column if not exists prescreen_rules_version text;

create index if not exists agenttender_tenders_prescreen_status_idx
  on public.agenttender_tenders(prescreen_status);

create index if not exists agenttender_tenders_chatgpt_eligible_idx
  on public.agenttender_tenders(chatgpt_eligible);

create index if not exists agenttender_tenders_decision_source_idx
  on public.agenttender_tenders(decision_source);

-- =========================================================
-- Pre-screen results table
-- =========================================================

create table if not exists public.agenttender_prescreen_results (
  id uuid primary key default gen_random_uuid(),

  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,

  source_portal text not null
    check (
      source_portal in (
        'TENDER247',
        'BIDASSIST'
      )
    ),

  source_tender_id text not null,

  status text not null
    check (
      status in (
        'PASSED',
        'REJECTED',
        'MANUAL_REVIEW',
        'ERROR'
      )
    ),

  effective_status text
    check (
      effective_status is null
      or effective_status in (
        'NO_GO',
        'VERIFY'
      )
    ),

  chatgpt_eligible boolean not null,
  reason_code text not null,
  reason text not null,

  facts jsonb not null default '{}'::jsonb,

  rules_version text not null,
  metadata_hash text,

  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_prescreen_tender_unique
    unique (tender_id)
);

create index if not exists agenttender_prescreen_source_idx
  on public.agenttender_prescreen_results(source_portal, source_tender_id);

create index if not exists agenttender_prescreen_status_idx
  on public.agenttender_prescreen_results(status);

create index if not exists agenttender_prescreen_chatgpt_eligible_idx
  on public.agenttender_prescreen_results(chatgpt_eligible);

create index if not exists agenttender_prescreen_reason_code_idx
  on public.agenttender_prescreen_results(reason_code);

create index if not exists agenttender_prescreen_evaluated_at_idx
  on public.agenttender_prescreen_results(evaluated_at);

drop trigger if exists agenttender_prescreen_updated_at
  on public.agenttender_prescreen_results;

create trigger agenttender_prescreen_updated_at
before update
on public.agenttender_prescreen_results
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_prescreen_results
  enable row level security;

drop policy if exists
  "agenttender authenticated read prescreen"
on public.agenttender_prescreen_results;

create policy
  "agenttender authenticated read prescreen"
on public.agenttender_prescreen_results
for select
to authenticated
using (true);

grant select
on public.agenttender_prescreen_results
to authenticated;

grant all
on public.agenttender_prescreen_results
to service_role;

-- When ChatGPT qualification is stored, mark decision_source = CHATGPT
create or replace function
  public.agenttender_sync_qualification_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.agenttender_tenders
  set
    qualification_status = new.status,
    decision_source = 'CHATGPT'
  where id = new.tender_id;

  return new;
end;
$$;

-- Refresh web list view with pre-screen fields.
-- Must DROP first: CREATE OR REPLACE cannot insert/reorder columns mid-view.
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
  coalesce(q.status, t.qualification_status) as effective_qualification_status,

  -- Appended columns (do not reorder above — preserves CREATE OR REPLACE safety)
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
