begin;

-- Allow Phase-1 Excel screening upserts to refresh scraped_date to the run date.
-- Normal detail crawls still preserve the first non-null scraped_date.
create or replace function public.agenttender_preserve_scraped_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  src text;
begin
  if tg_op = 'UPDATE' and old.scraped_date is not null then
    src := coalesce(new.raw_metadata->>'screeningSource', '');
    if src in (
      'HISTORICAL_EXCEL_BACKFILL',
      'CHATGPT_RUN_EXCEL',
      'UPLOADED_PRESCREENED_EXCEL'
    ) then
      return new;
    end if;
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

commit;
