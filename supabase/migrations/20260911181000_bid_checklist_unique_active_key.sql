-- Allow re-adding a requirement after soft-delete by scoping uniqueness to active rows.
alter table public.agenttender_bid_checklist_items
  drop constraint if exists uq_bid_checklist_workspace_key;

drop index if exists public.uq_bid_checklist_workspace_key;

create unique index if not exists uq_bid_checklist_workspace_key_active
  on public.agenttender_bid_checklist_items (workspace_id, requirement_key)
  where (is_archived = false);
