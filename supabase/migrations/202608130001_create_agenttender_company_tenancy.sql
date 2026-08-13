begin;

-- =========================================================
-- Company tenancy + documents + bid preferences
-- Custom auth (service_role). App enforces company scoping.
-- =========================================================

-- Deterministic Siyana bootstrap company id (idempotent)
-- a1b2c3d4-e5f6-7890-abcd-ef1234567890

create table if not exists public.agenttender_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry_type text,
  business_location text,
  website text,
  year_established integer,
  description text,
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_companies_name_not_blank
    check (length(trim(name)) > 0)
);

create unique index if not exists agenttender_companies_slug_uidx
  on public.agenttender_companies (slug)
  where slug is not null;

create index if not exists agenttender_companies_name_idx
  on public.agenttender_companies (lower(name));

drop trigger if exists agenttender_companies_updated_at
  on public.agenttender_companies;
create trigger agenttender_companies_updated_at
before update on public.agenttender_companies
for each row
execute function public.agenttender_set_updated_at();

-- Users → company
alter table public.agenttender_users
  add column if not exists company_id uuid
    references public.agenttender_companies(id)
    on delete set null;

create index if not exists agenttender_users_company_id_idx
  on public.agenttender_users (company_id);

-- Bid preferences (one row per company)
create table if not exists public.agenttender_company_bid_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique
    references public.agenttender_companies(id)
    on delete cascade,
  max_emd_inr numeric,
  min_tender_value_inr numeric,
  max_tender_value_inr numeric,
  service_scope jsonb not null default '[]'::jsonb,
  excluded_scope jsonb not null default '[]'::jsonb,
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists agenttender_company_bid_preferences_updated_at
  on public.agenttender_company_bid_preferences;
create trigger agenttender_company_bid_preferences_updated_at
before update on public.agenttender_company_bid_preferences
for each row
execute function public.agenttender_set_updated_at();

-- Optional folders (simple)
create table if not exists public.agenttender_company_document_folders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  name text not null,
  parent_id uuid
    references public.agenttender_company_document_folders(id)
    on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_doc_folders_name_not_blank
    check (length(trim(name)) > 0)
);

create index if not exists agenttender_company_document_folders_company_idx
  on public.agenttender_company_document_folders (company_id);

-- Company documents (metadata; file bytes via storage provider / Azure later)
create table if not exists public.agenttender_company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  folder_id uuid
    references public.agenttender_company_document_folders(id)
    on delete set null,

  name text not null,
  original_file_name text,
  document_category text not null
    check (
      document_category in (
        'Certificate',
        'Financial',
        'Experience',
        'GST',
        'PAN',
        'Bank Guarantee',
        'Other',
        'General'
      )
    ),
  document_type text,
  certificate_type text,
  financial_year text,
  issuing_authority text,
  issue_date date,
  expiry_date date,
  notes text,

  storage_provider text not null default 'none'
    check (storage_provider in ('none', 'azure', 'local')),
  storage_container text,
  storage_blob_name text,
  storage_url text,
  mime_type text,
  file_size_bytes bigint,

  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references public.agenttender_users(id) on delete set null,

  status text not null default 'active'
    check (status in ('active', 'archived', 'deleted')),

  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_company_documents_name_not_blank
    check (length(trim(name)) > 0)
);

create index if not exists agenttender_company_documents_company_idx
  on public.agenttender_company_documents (company_id);

create index if not exists agenttender_company_documents_category_idx
  on public.agenttender_company_documents (company_id, document_category);

create index if not exists agenttender_company_documents_expiry_idx
  on public.agenttender_company_documents (company_id, expiry_date)
  where expiry_date is not null and status = 'active';

drop trigger if exists agenttender_company_documents_updated_at
  on public.agenttender_company_documents;
create trigger agenttender_company_documents_updated_at
before update on public.agenttender_company_documents
for each row
execute function public.agenttender_set_updated_at();

-- Past experience (company-scoped)
create table if not exists public.agenttender_company_experience (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  project_name text not null,
  client_name text,
  project_value_inr numeric,
  start_date date,
  end_date date,
  description text,
  document_ids uuid[] not null default '{}',
  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_company_experience_name_not_blank
    check (length(trim(project_name)) > 0)
);

create index if not exists agenttender_company_experience_company_idx
  on public.agenttender_company_experience (company_id);

drop trigger if exists agenttender_company_experience_updated_at
  on public.agenttender_company_experience;
create trigger agenttender_company_experience_updated_at
before update on public.agenttender_company_experience
for each row
execute function public.agenttender_set_updated_at();

-- =========================================================
-- Idempotent Siyana company + backfill existing users
-- =========================================================

insert into public.agenttender_companies (
  id,
  name,
  industry_type,
  business_location,
  website,
  slug
)
values (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
  'Siyana Info Solutions Pvt. Ltd.',
  'Information Technology',
  'Ahmedabad',
  'www.siyanainfo.com',
  'siyana-info-solutions'
)
on conflict (id) do update set
  name = excluded.name,
  industry_type = excluded.industry_type,
  business_location = excluded.business_location,
  website = excluded.website,
  slug = excluded.slug,
  updated_at = now();

-- Seed bid preferences from current automation defaults (not screenshot mock)
insert into public.agenttender_company_bid_preferences (
  company_id,
  max_emd_inr,
  min_tender_value_inr,
  max_tender_value_inr,
  service_scope,
  excluded_scope
)
values (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
  1500000,
  null,
  50000000,
  '["Information Technology","Software Development","System Integration"]'::jsonb,
  '[]'::jsonb
)
on conflict (company_id) do nothing;

-- Backfill ONLY users that currently have no company (one-time bootstrap)
update public.agenttender_users
set company_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
    updated_at = now()
where company_id is null;

-- =========================================================
-- RLS: deny anon/authenticated; service_role only
-- (App uses custom session auth + service_role server client)
-- =========================================================

alter table public.agenttender_companies enable row level security;
alter table public.agenttender_company_bid_preferences enable row level security;
alter table public.agenttender_company_document_folders enable row level security;
alter table public.agenttender_company_documents enable row level security;
alter table public.agenttender_company_experience enable row level security;

revoke all on public.agenttender_companies from anon, authenticated;
revoke all on public.agenttender_company_bid_preferences from anon, authenticated;
revoke all on public.agenttender_company_document_folders from anon, authenticated;
revoke all on public.agenttender_company_documents from anon, authenticated;
revoke all on public.agenttender_company_experience from anon, authenticated;

grant all on public.agenttender_companies to service_role;
grant all on public.agenttender_company_bid_preferences to service_role;
grant all on public.agenttender_company_document_folders to service_role;
grant all on public.agenttender_company_documents to service_role;
grant all on public.agenttender_company_experience to service_role;

commit;
