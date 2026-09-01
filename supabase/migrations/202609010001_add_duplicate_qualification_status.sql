begin;

-- Phase-1 screening can mark duplicate / already-reviewed tenders as DUPLICATE.
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
      'DUPLICATE',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED'
    )
  );

commit;
