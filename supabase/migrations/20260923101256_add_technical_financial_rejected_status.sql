begin;

-- Post-submission rejection outcomes: Technical Rejected / Financial Rejected.
-- Also allow UNDER_EVALUATION (already used by the app) on the check constraint.
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
      'UNDER_EVALUATION',
      'NO_GO',
      'DUPLICATE',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED',
      'CANCELLED',
      'TECHNICAL_REJECTED',
      'FINANCIAL_REJECTED'
    )
  );

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
      'UNDER_EVALUATION',
      'NO_GO',
      'DUPLICATE',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED',
      'CANCELLED',
      'TECHNICAL_REJECTED',
      'FINANCIAL_REJECTED'
    )
  );

commit;
