begin;

-- Manual Add Tender uses source_portal = 'MANUAL'. Older DBs still only
-- allow TENDER247 / BIDASSIST, which raises agenttender_tenders_source_portal_check.
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

-- Manual create can also set lifecycle statuses (Will Bid / Won / Submitted / …).
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
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED'
    )
  );

commit;
