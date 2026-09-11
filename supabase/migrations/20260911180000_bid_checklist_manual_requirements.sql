-- Manual checklist requirements + section placement + origin metadata.

alter table public.agenttender_bid_checklist_items
  add column if not exists requirement_origin text not null default 'AI',
  add column if not exists ai_detected boolean not null default false,
  add column if not exists workspace_section text,
  add column if not exists created_by uuid
    references public.agenttender_users(id)
    on delete set null,
  add column if not exists updated_by uuid
    references public.agenttender_users(id)
    on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid
    references public.agenttender_users(id)
    on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agenttender_bid_checklist_items_origin_check'
  ) then
    alter table public.agenttender_bid_checklist_items
      add constraint agenttender_bid_checklist_items_origin_check
      check (requirement_origin in ('AI', 'MANUAL', 'SEED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'agenttender_bid_checklist_items_workspace_section_check'
  ) then
    alter table public.agenttender_bid_checklist_items
      add constraint agenttender_bid_checklist_items_workspace_section_check
      check (
        workspace_section is null
        or workspace_section in ('prequalification', 'technical', 'annexures')
      );
  end if;
end $$;

update public.agenttender_bid_checklist_items
set requirement_origin = 'AI'
where requirement_origin is null or requirement_origin = '';

update public.agenttender_bid_checklist_items
set workspace_section = case
  when upper(category) in ('TECHNICAL', 'BOQ') then 'technical'
  when upper(category) in ('ANNEXURE', 'DECLARATION', 'AUTHORIZATION', 'LEGAL') then 'annexures'
  else 'prequalification'
end
where workspace_section is null;
