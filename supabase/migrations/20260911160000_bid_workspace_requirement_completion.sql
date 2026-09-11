-- Bid Workspace: preparation status, manual completion, document→requirement FK.

alter table public.agenttender_bid_workspaces
  add column if not exists checklist_preparation_status text not null default 'NOT_STARTED',
  add column if not exists checklist_preparation_error text,
  add column if not exists checklist_preparation_started_at timestamptz,
  add column if not exists checklist_preparation_finished_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agenttender_bid_workspaces_checklist_prep_status_check'
  ) then
    alter table public.agenttender_bid_workspaces
      add constraint agenttender_bid_workspaces_checklist_prep_status_check
      check (
        checklist_preparation_status in (
          'NOT_STARTED', 'PROCESSING', 'READY', 'FAILED'
        )
      );
  end if;
end $$;

alter table public.agenttender_bid_checklist_items
  add column if not exists manual_completed boolean not null default false,
  add column if not exists manual_completed_at timestamptz,
  add column if not exists manual_completed_by uuid
    references public.agenttender_users(id)
    on delete set null,
  add column if not exists is_archived boolean not null default false,
  add column if not exists normalized_requirement_key text;

create index if not exists idx_bid_checklist_active_workspace
  on public.agenttender_bid_checklist_items (workspace_id, display_order)
  where is_archived = false;

alter table public.agenttender_bid_workspace_documents
  add column if not exists checklist_item_id uuid
    references public.agenttender_bid_checklist_items(id)
    on delete set null,
  add column if not exists is_placeholder boolean not null default false;

create index if not exists idx_bid_ws_docs_checklist_item
  on public.agenttender_bid_workspace_documents (checklist_item_id)
  where checklist_item_id is not null;

-- Backfill preparation READY for workspaces that already have checklist rows.
update public.agenttender_bid_workspaces w
set
  checklist_preparation_status = 'READY',
  checklist_preparation_finished_at = coalesce(
    checklist_preparation_finished_at,
    now()
  )
where checklist_preparation_status = 'NOT_STARTED'
  and exists (
    select 1
    from public.agenttender_bid_checklist_items c
    where c.workspace_id = w.id
      and coalesce(c.is_archived, false) = false
  );

-- Backfill document → requirement links from existing matches.
update public.agenttender_bid_workspace_documents d
set checklist_item_id = c.id
from public.agenttender_bid_checklist_items c
where d.checklist_item_id is null
  and c.matched_workspace_document_id = d.id
  and c.workspace_id = d.workspace_id;

-- Mark empty pending slots created as placeholders (no file).
update public.agenttender_bid_workspace_documents
set is_placeholder = true
where (file_name is null and blob_name is null and storage_url is null)
  and status = 'pending';

-- Soft-link additional AI draft versions by title prefix to matched requirement.
update public.agenttender_bid_workspace_documents d
set checklist_item_id = c.id
from public.agenttender_bid_checklist_items c
where d.checklist_item_id is null
  and d.workspace_id = c.workspace_id
  and coalesce(d.is_placeholder, false) = false
  and (
    d.title ilike c.requirement_name || '%'
    or replace(lower(coalesce(d.file_name, '')), '_', ' ')
      like '%' || left(replace(lower(c.requirement_name), ' ', '%'), 40) || '%'
  );
