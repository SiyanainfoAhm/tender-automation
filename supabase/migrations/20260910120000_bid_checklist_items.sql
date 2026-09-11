-- Bid Workspace checklist requirements + company/tender document matches.
-- Checklist items REFERENCE company library docs; they never copy them.

create table if not exists public.agenttender_bid_checklist_items (
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
  requirement_key text not null,
  requirement_name text not null,
  category text not null default 'COMPLIANCE',
  description text,
  mandatory boolean not null default true,
  document_type text,
  generation_allowed boolean not null default false,
  source_page integer,
  source_clause text,
  source_text text,
  completion_status text not null default 'MISSING'
    check (
      completion_status in (
        'MISSING',
        'COMPLETED_COMPANY_DOCUMENT',
        'COMPLETED_TENDER_DOCUMENT',
        'DRAFT_AVAILABLE',
        'INVALID_DOCUMENT',
        'EXPIRED_DOCUMENT',
        'PENDING_DOCUMENT',
        'ACTION_REQUIRED',
        'NOT_APPLICABLE'
      )
    ),
  matched_document_source text
    check (
      matched_document_source is null
      or matched_document_source in ('COMPANY', 'TENDER')
    ),
  matched_company_document_id uuid
    references public.agenttender_company_documents(id)
    on delete set null,
  matched_workspace_document_id uuid
    references public.agenttender_bid_workspace_documents(id)
    on delete set null,
  matched_by text
    check (matched_by is null or matched_by in ('AI', 'USER', 'SYSTEM')),
  match_confidence numeric(4, 3),
  match_reason text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_bid_checklist_workspace_key unique (workspace_id, requirement_key)
);

create index if not exists idx_bid_checklist_workspace
  on public.agenttender_bid_checklist_items (workspace_id, display_order);

create index if not exists idx_bid_checklist_tender
  on public.agenttender_bid_checklist_items (tender_id);

create index if not exists idx_bid_checklist_company_doc
  on public.agenttender_bid_checklist_items (matched_company_document_id)
  where matched_company_document_id is not null;

drop trigger if exists agenttender_bid_checklist_items_updated_at
  on public.agenttender_bid_checklist_items;
create trigger agenttender_bid_checklist_items_updated_at
before update on public.agenttender_bid_checklist_items
for each row execute function public.agenttender_set_updated_at();

alter table public.agenttender_bid_checklist_items enable row level security;
revoke all on public.agenttender_bid_checklist_items from anon, authenticated;
grant all on public.agenttender_bid_checklist_items to service_role;
