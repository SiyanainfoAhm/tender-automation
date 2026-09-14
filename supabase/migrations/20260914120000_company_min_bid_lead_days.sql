begin;

alter table public.agenttender_company_bid_preferences
  add column if not exists min_bid_lead_days integer;

alter table public.agenttender_company_bid_preferences
  drop constraint if exists agenttender_company_bid_preferences_min_bid_lead_days_chk;

alter table public.agenttender_company_bid_preferences
  add constraint agenttender_company_bid_preferences_min_bid_lead_days_chk
  check (min_bid_lead_days is null or min_bid_lead_days >= 0);

comment on column public.agenttender_company_bid_preferences.min_bid_lead_days is
  'Minimum calendar days remaining before closing; tenders with this many or fewer days are not eligible to bid.';

commit;
