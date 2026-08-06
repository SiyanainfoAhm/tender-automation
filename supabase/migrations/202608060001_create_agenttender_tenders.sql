begin;

create extension if not exists pgcrypto;

-- =========================================================
-- UPDATED_AT FUNCTION
-- =========================================================

create or replace function public.agenttender_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- TENDER MASTER TABLE
-- Phase 1: crawler metadata only
-- =========================================================

create table if not exists public.agenttender_tenders (
  id uuid primary key default gen_random_uuid(),

  source_portal text not null
    check (
      source_portal in (
        'TENDER247',
        'BIDASSIST'
      )
    ),

  source_tender_id text not null,
  folder_id text,

  title text not null default '',
  organization text,
  department text,
  authority text,

  category text,
  tender_type text,
  description text,

  city text,
  state text,
  location_text text,

  published_date date,
  opening_date date,
  closing_date date,
  bid_submission_date date,

  tender_value numeric(20, 2),
  tender_value_text text,

  emd_amount numeric(20, 2),
  emd_text text,

  currency text not null default 'INR',

  source_url text,
  local_folder_path text,

  ai_summary_available boolean not null default false,
  document_archive_available boolean not null default false,

  download_status text not null default 'DISCOVERED'
    check (
      download_status in (
        'DISCOVERED',
        'DOWNLOADING',
        'DOWNLOADED',
        'READY',
        'COMPLETED',
        'FAILED',
        'DB_SYNC_FAILED'
      )
    ),

  qualification_status text
    check (
      qualification_status is null
      or qualification_status in (
        'GO',
        'CONDITIONAL_GO',
        'PARTNER_BID',
        'VERIFY',
        'NO_GO'
      )
    ),

  -- The complete crawler metadata object formerly written to metadata.json.
  raw_metadata jsonb not null default '{}'::jsonb,

  metadata_version integer not null default 1,
  content_hash text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  crawled_at timestamptz,
  supabase_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_tenders_source_unique
    unique (source_portal, source_tender_id)
);

create index if not exists agenttender_tenders_source_idx
  on public.agenttender_tenders(source_portal);

create index if not exists agenttender_tenders_source_id_idx
  on public.agenttender_tenders(source_tender_id);

create index if not exists agenttender_tenders_closing_date_idx
  on public.agenttender_tenders(closing_date);

create index if not exists agenttender_tenders_opening_date_idx
  on public.agenttender_tenders(opening_date);

create index if not exists agenttender_tenders_category_idx
  on public.agenttender_tenders(category);

create index if not exists agenttender_tenders_state_idx
  on public.agenttender_tenders(state);

create index if not exists agenttender_tenders_download_status_idx
  on public.agenttender_tenders(download_status);

create index if not exists agenttender_tenders_qualification_status_idx
  on public.agenttender_tenders(qualification_status);

create index if not exists agenttender_tenders_raw_metadata_idx
  on public.agenttender_tenders
  using gin (raw_metadata);

drop trigger if exists agenttender_tenders_updated_at
  on public.agenttender_tenders;

create trigger agenttender_tenders_updated_at
before update on public.agenttender_tenders
for each row
execute function public.agenttender_set_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.agenttender_tenders
  enable row level security;

drop policy if exists
  "agenttender authenticated read tenders"
  on public.agenttender_tenders;

create policy
  "agenttender authenticated read tenders"
on public.agenttender_tenders
for select
to authenticated
using (true);

grant select
on public.agenttender_tenders
to authenticated;

grant all
on public.agenttender_tenders
to service_role;

commit;
