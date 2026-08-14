begin;

alter table public.agenttender_bid_profile_templates
  add column if not exists company_logo_blob_name text,
  add column if not exists company_signatory_blob_name text;

commit;
