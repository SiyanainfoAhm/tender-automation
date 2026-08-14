begin;

-- Tender activity (classification + workspace events). Custom auth + service_role.
create table if not exists public.agenttender_tender_activity (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  company_id uuid
    references public.agenttender_companies(id)
    on delete cascade,
  event_type text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid
    references public.agenttender_users(id)
    on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agenttender_tender_activity_tender
  on public.agenttender_tender_activity (tender_id, created_at desc);

create index if not exists idx_agenttender_tender_activity_company
  on public.agenttender_tender_activity (company_id, created_at desc)
  where company_id is not null;

-- Bid workspaces: one per company + tender
create table if not exists public.agenttender_bid_workspaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  workspace_status text not null default 'active'
    check (workspace_status in ('active', 'locked')),
  submission_status text not null default 'not_submitted'
    check (submission_status in ('not_submitted', 'submitted')),
  submission_reference text,
  submission_notes text,
  submitted_at timestamptz,
  submitted_by uuid
    references public.agenttender_users(id)
    on delete set null,
  created_by uuid
    references public.agenttender_users(id)
    on delete set null,
  updated_by uuid
    references public.agenttender_users(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_agenttender_bid_workspaces_company_tender
    unique (company_id, tender_id)
);

create index if not exists idx_agenttender_bid_workspaces_company
  on public.agenttender_bid_workspaces (company_id);

create index if not exists idx_agenttender_bid_workspaces_tender
  on public.agenttender_bid_workspaces (tender_id);

drop trigger if exists agenttender_bid_workspaces_updated_at
  on public.agenttender_bid_workspaces;
create trigger agenttender_bid_workspaces_updated_at
before update on public.agenttender_bid_workspaces
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_bid_proposal_sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.agenttender_bid_workspaces(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  section_key text not null,
  title text not null,
  display_order integer not null default 0,
  content text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'complete')),
  assigned_to uuid
    references public.agenttender_users(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
    references public.agenttender_users(id)
    on delete set null,
  constraint uq_agenttender_bid_proposal_section_key
    unique (workspace_id, section_key)
);

create index if not exists idx_agenttender_bid_proposal_workspace
  on public.agenttender_bid_proposal_sections (workspace_id, display_order);

drop trigger if exists agenttender_bid_proposal_sections_updated_at
  on public.agenttender_bid_proposal_sections;
create trigger agenttender_bid_proposal_sections_updated_at
before update on public.agenttender_bid_proposal_sections
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_bid_boq_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.agenttender_bid_workspaces(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  description text not null,
  category text not null default 'Other',
  uom text not null default 'Nos',
  quantity numeric(14,4) not null default 0
    check (quantity >= 0),
  unit_rate numeric(14,4) not null default 0
    check (unit_rate >= 0),
  gst_percent numeric(5,2) not null default 0
    check (gst_percent >= 0 and gst_percent <= 100),
  notes text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
    references public.agenttender_users(id)
    on delete set null
);

create index if not exists idx_agenttender_bid_boq_workspace
  on public.agenttender_bid_boq_items (workspace_id, display_order);

drop trigger if exists agenttender_bid_boq_items_updated_at
  on public.agenttender_bid_boq_items;
create trigger agenttender_bid_boq_items_updated_at
before update on public.agenttender_bid_boq_items
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_bid_workspace_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.agenttender_bid_workspaces(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  document_type text not null default 'Other',
  title text not null,
  file_name text,
  file_size_bytes bigint,
  mime_type text,
  storage_url text,
  blob_name text,
  status text not null default 'pending'
    check (status in ('drafting', 'pending', 'ready', 'approved')),
  is_required boolean not null default false,
  version_label text,
  created_by uuid
    references public.agenttender_users(id)
    on delete set null,
  updated_by uuid
    references public.agenttender_users(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agenttender_bid_ws_docs_workspace
  on public.agenttender_bid_workspace_documents (workspace_id, created_at);

drop trigger if exists agenttender_bid_workspace_documents_updated_at
  on public.agenttender_bid_workspace_documents;
create trigger agenttender_bid_workspace_documents_updated_at
before update on public.agenttender_bid_workspace_documents
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_tender_activity enable row level security;
alter table public.agenttender_bid_workspaces enable row level security;
alter table public.agenttender_bid_proposal_sections enable row level security;
alter table public.agenttender_bid_boq_items enable row level security;
alter table public.agenttender_bid_workspace_documents enable row level security;

revoke all on public.agenttender_tender_activity from anon, authenticated;
revoke all on public.agenttender_bid_workspaces from anon, authenticated;
revoke all on public.agenttender_bid_proposal_sections from anon, authenticated;
revoke all on public.agenttender_bid_boq_items from anon, authenticated;
revoke all on public.agenttender_bid_workspace_documents from anon, authenticated;

grant all on public.agenttender_tender_activity to service_role;
grant all on public.agenttender_bid_workspaces to service_role;
grant all on public.agenttender_bid_proposal_sections to service_role;
grant all on public.agenttender_bid_boq_items to service_role;
grant all on public.agenttender_bid_workspace_documents to service_role;

commit;
