-- Split contract number vs description on won projects.
alter table public.agenttender_won_projects
  add column if not exists contract_description text;

comment on column public.agenttender_won_projects.contract_description is
  'Free-text contract description; separate from contract_number.';
