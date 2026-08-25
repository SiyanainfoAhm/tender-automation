begin;

-- Allow HISTORICAL_EXCEL_BACKFILL upserts to correct scraped_date.
-- Normal crawls still preserve the first non-null scraped_date.
create or replace function public.agenttender_preserve_scraped_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.scraped_date is not null then
    if coalesce(new.raw_metadata->>'screeningSource', '') = 'HISTORICAL_EXCEL_BACKFILL' then
      return new;
    end if;
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

commit;
