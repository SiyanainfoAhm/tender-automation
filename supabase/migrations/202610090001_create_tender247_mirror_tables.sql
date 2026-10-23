begin;

-- Tender247 integration mirrors for the separate Tender247 database.
-- Canonical IDs are traceability references to the TenderFlow database and
-- therefore cannot be foreign keys across database boundaries.
create extension if not exists pgcrypto;

create or replace function public.tender247_set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.tender247_tenders (
  id uuid primary key default gen_random_uuid(),
  canonical_tender_id uuid,
  source_region text not null default 'INDIAN',
  tender247_tender_id text not null,
  source_tender_id text,
  title text,
  authority text,
  organization text,
  department text,
  description text,
  sector text,
  subindustry text,
  category text,
  tender_type text,
  country text,
  state text,
  city text,
  location_text text,
  currency text,
  tender_value numeric(20,2),
  tender_value_text text,
  emd_amount numeric(20,2),
  emd_text text,
  document_cost text,
  published_date date,
  opening_date date,
  closing_date date,
  bid_submission_date date,
  prebid_meeting_date date,
  completion_of_work text,
  source_url text,
  zip_document_download_source text,
  scraped_date date not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  constraint tender247_tenders_identity_unique unique (source_region, tender247_tender_id)
);

create index if not exists tender247_tenders_canonical_tender_idx
  on public.tender247_tenders(canonical_tender_id);

drop trigger if exists tender247_tenders_updated_at on public.tender247_tenders;
create trigger tender247_tenders_updated_at before update on public.tender247_tenders
for each row execute function public.tender247_set_updated_at();

create table if not exists public.tender247_documents (
  id uuid primary key default gen_random_uuid(),
  tender247_tender_row_id uuid not null references public.tender247_tenders(id) on delete cascade,
  canonical_tender_id uuid,
  canonical_document_id uuid,
  external_document_id text not null,
  filename text,
  mime_type text,
  file_size bigint,
  storage_status text,
  storage_url text,
  sharepoint_drive_item_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender247_documents_identity_unique unique (tender247_tender_row_id, external_document_id)
);

create index if not exists tender247_documents_canonical_document_idx
  on public.tender247_documents(canonical_document_id);

drop trigger if exists tender247_documents_updated_at on public.tender247_documents;
create trigger tender247_documents_updated_at before update on public.tender247_documents
for each row execute function public.tender247_set_updated_at();

alter table public.tender247_tenders enable row level security;
alter table public.tender247_documents enable row level security;
revoke all on public.tender247_tenders, public.tender247_documents from anon, authenticated;
grant all on public.tender247_tenders, public.tender247_documents to service_role;

commit;
