begin;

-- Allow manually entered tenders and Won outcome status.
alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_source_portal_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_source_portal_check
  check (
    source_portal in (
      'TENDER247',
      'BIDASSIST',
      'MANUAL'
    )
  );

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_qualification_status_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_qualification_status_check
  check (
    qualification_status is null
    or qualification_status in (
      'GO',
      'CONDITIONAL_GO',
      'PARTNER_BID',
      'VERIFY',
      'NO_GO',
      'WON'
    )
  );

-- Qualification results table (if present) should accept WON too.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'agenttender_qualification_results'
  ) then
    alter table public.agenttender_qualification_results
      drop constraint if exists agenttender_qualification_results_status_check;
    alter table public.agenttender_qualification_results
      add constraint agenttender_qualification_results_status_check
      check (
        status in (
          'GO',
          'CONDITIONAL_GO',
          'PARTNER_BID',
          'VERIFY',
          'NO_GO',
          'WON'
        )
      );
  end if;
end $$;

commit;
