begin;
alter table public.agenttender_tender_document_upload_sessions
  add column if not exists staging_metadata jsonb;
comment on column public.agenttender_tender_document_upload_sessions.staging_metadata is
  'Non-secret Tender247 gateway stage identity and TTL metadata; cleared once SharePoint finalization succeeds.';
commit;
