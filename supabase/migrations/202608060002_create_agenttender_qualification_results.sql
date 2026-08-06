begin;

create table if not exists public.agenttender_qualification_results (
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
        'GO',
        'CONDITIONAL_GO',
        'PARTNER_BID',
        'VERIFY',
        'NO_GO'
      )
    ),

  decision_label text not null,

  verdict text not null,
  reason text not null,
  required_action text,

  confidence numeric(5,4) not null default 0
    check (
      confidence >= 0
      and confidence <= 1
    ),

  matched_criteria jsonb not null default '[]'::jsonb,
  failed_criteria jsonb not null default '[]'::jsonb,
  unclear_criteria jsonb not null default '[]'::jsonb,
  missing_documents jsonb not null default '[]'::jsonb,

  conditions jsonb not null default '[]'::jsonb,

  partnership_required_for jsonb not null default '[]'::jsonb,
  partnership_mode_allowed jsonb not null default '[]'::jsonb,

  manual_review_required boolean not null default false,

  requires_detailed_tender_review boolean
    not null default false,

  evidence_files jsonb not null default '[]'::jsonb,

  raw_response text not null,
  raw_result jsonb not null,

  chat_url text,
  prompt_version text,
  model_name text,

  qualified_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_qualification_tender_unique
    unique (tender_id),

  constraint agenttender_qualification_source_unique
    unique (source_portal, source_tender_id)
);

create index if not exists
  agenttender_qualification_status_idx
on public.agenttender_qualification_results(status);

create index if not exists
  agenttender_qualification_source_idx
on public.agenttender_qualification_results(
  source_portal,
  source_tender_id
);

drop trigger if exists
  agenttender_qualification_updated_at
on public.agenttender_qualification_results;

create trigger agenttender_qualification_updated_at
before update
on public.agenttender_qualification_results
for each row
execute function public.agenttender_set_updated_at();

create or replace function
  public.agenttender_sync_qualification_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.agenttender_tenders
  set qualification_status = new.status
  where id = new.tender_id;

  return new;
end;
$$;

drop trigger if exists
  agenttender_sync_qualification_status_trigger
on public.agenttender_qualification_results;

create trigger agenttender_sync_qualification_status_trigger
after insert or update of status
on public.agenttender_qualification_results
for each row
execute function public.agenttender_sync_qualification_status();

alter table public.agenttender_qualification_results
  enable row level security;

drop policy if exists
  "agenttender authenticated read qualifications"
on public.agenttender_qualification_results;

create policy
  "agenttender authenticated read qualifications"
on public.agenttender_qualification_results
for select
to authenticated
using (true);

grant select
on public.agenttender_qualification_results
to authenticated;

grant all
on public.agenttender_qualification_results
to service_role;

create or replace view public.agenttender_tender_list
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
  t.first_seen_at,
  t.last_seen_at,
  t.crawled_at,
  t.supabase_synced_at,

  q.decision_label,
  q.verdict,
  q.reason,
  q.required_action,
  q.confidence,
  q.manual_review_required,
  q.requires_detailed_tender_review,
  q.qualified_at,
  q.chat_url

from public.agenttender_tenders t
left join public.agenttender_qualification_results q
  on q.tender_id = t.id;

grant select
on public.agenttender_tender_list
to authenticated;

grant select
on public.agenttender_tender_list
to service_role;

commit;
