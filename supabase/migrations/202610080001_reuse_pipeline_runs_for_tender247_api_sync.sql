begin;

-- Reuse the canonical run ledger. This index applies only to the explicit
-- Tender247 API job; browser/batch and other portal runs are unaffected.
create unique index if not exists agenttender_pipeline_runs_one_t247_api_sync
  on public.agenttender_pipeline_runs (portal)
  where portal = 'TENDER247' and mode = 'api_sync' and status = 'running';

-- Dedicated, default-false marker. Legacy rows are never marked by this
-- migration; only the API-sync writer sets it true.
alter table public.agenttender_tenders
  add column if not exists tender247_api_sync boolean not null default false;

-- The shared table intentionally keeps daily-snapshot identity for existing
-- agents. The API integration identifies Tender247 rows by stable tenderid and
-- is the sole narrow exception allowed to refresh its scraped date.
create or replace function public.agenttender_preserve_scraped_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.scraped_date is not null
     and not (
       new.source_portal = 'TENDER247'
       and new.tender247_api_sync is true
     ) then
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

commit;
