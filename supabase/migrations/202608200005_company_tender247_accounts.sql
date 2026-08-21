begin;

-- =========================================================
-- Multiple Tender247 accounts per company (shared preferences)
-- =========================================================

create table if not exists public.agenttender_company_tender247_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,

  portal text not null default 'TENDER247'
    check (portal = 'TENDER247'),

  label text not null default 'Main Account',
  username text not null,
  -- AES-256-GCM payload: v1:<iv_b64url>:<tag_b64url>:<cipher_b64url>
  encrypted_password text not null,

  -- Relative path under project auth/, e.g. auth/tender247/company-…/account-…/storage-state.json
  session_storage_path text,

  is_active boolean not null default true,
  sort_order integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_t247_accounts_username_not_blank
    check (length(trim(username)) > 0),
  constraint agenttender_t247_accounts_label_not_blank
    check (length(trim(label)) > 0)
);

create unique index if not exists agenttender_t247_accounts_company_username_uidx
  on public.agenttender_company_tender247_accounts (company_id, lower(username));

create index if not exists agenttender_t247_accounts_company_active_idx
  on public.agenttender_company_tender247_accounts (company_id, is_active);

drop trigger if exists agenttender_t247_accounts_updated_at
  on public.agenttender_company_tender247_accounts;
create trigger agenttender_t247_accounts_updated_at
before update on public.agenttender_company_tender247_accounts
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender247_account_id uuid
    references public.agenttender_company_tender247_accounts(id)
    on delete set null,

  portal text not null default 'TENDER247',
  run_date date not null,
  status text not null default 'running'
    check (
      status in (
        'running',
        'success',
        'completed_with_failures',
        'failed'
      )
    ),
  mode text,
  resume boolean not null default false,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenttender_pipeline_runs_company_date_idx
  on public.agenttender_pipeline_runs (company_id, run_date desc);

create index if not exists agenttender_pipeline_runs_account_idx
  on public.agenttender_pipeline_runs (tender247_account_id)
  where tender247_account_id is not null;

drop trigger if exists agenttender_pipeline_runs_updated_at
  on public.agenttender_pipeline_runs;
create trigger agenttender_pipeline_runs_updated_at
before update on public.agenttender_pipeline_runs
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_company_tender247_accounts enable row level security;
alter table public.agenttender_pipeline_runs enable row level security;

revoke all on public.agenttender_company_tender247_accounts from anon, authenticated;
revoke all on public.agenttender_pipeline_runs from anon, authenticated;

grant all on public.agenttender_company_tender247_accounts to service_role;
grant all on public.agenttender_pipeline_runs to service_role;

commit;
