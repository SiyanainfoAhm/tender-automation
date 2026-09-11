-- Bid Workspace editable AI instruction templates (per workspace).
alter table public.agenttender_bid_workspaces
  add column if not exists ai_prompt_overrides jsonb not null default '{}'::jsonb;

comment on column public.agenttender_bid_workspaces.ai_prompt_overrides is
  'Per-workspace AI instruction template overrides keyed by promptKey.';
