-- Btree index on lower(title) fails when title exceeds ~2704 bytes.
-- Use a truncated expression so long tender names can still be inserted.
begin;

drop index if exists public.agenttender_tenders_title_lower_idx;

create index if not exists agenttender_tenders_title_lower_idx
  on public.agenttender_tenders (lower(left(title, 512)));

drop index if exists public.agenttender_tenders_organization_lower_idx;

create index if not exists agenttender_tenders_organization_lower_idx
  on public.agenttender_tenders (lower(left(organization, 512)));

commit;
