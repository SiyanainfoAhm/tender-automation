begin;

-- Phase-1 Excel upserts must refresh scraped_date to the run date so daily
-- filters match supabaseUpsertSuccess. Detail crawls still preserve the first
-- non-null scraped_date unless the update is a Phase-1 screening write.
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
    if coalesce(new.raw_metadata->>'phase1Screening', '') in ('true', 't', '1')
      or src in (
        'HISTORICAL_EXCEL_BACKFILL',
        'CHATGPT_RUN_EXCEL',
        'UPLOADED_PRESCREENED_EXCEL',
        'TENDER247_LOCAL_SKIP_CHATGPT',
        'REUPSERT_DAILY_EXCEL'
      )
    then
      return new;
    end if;
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

commit;
