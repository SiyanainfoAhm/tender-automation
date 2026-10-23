begin;

-- Backward-compatible source identity for server-ingested provider documents.
alter table public.agenttender_tender_documents
  add column if not exists external_source text,
  add column if not exists external_document_id text,
  add column if not exists storage_status text,
  add column if not exists sharepoint_drive_item_id text,
  add column if not exists completed_at timestamptz;

alter table public.agenttender_tender_documents
  drop constraint if exists agenttender_tender_documents_storage_status_check;
alter table public.agenttender_tender_documents
  add constraint agenttender_tender_documents_storage_status_check
  check (storage_status in ('PENDING','UPLOADING','COMPLETED','FAILED'));

-- Existing rows predate lifecycle state. A non-empty canonical storage URL is
-- the only established completion signal available on this table; leave all
-- other legacy rows NULL rather than falsely classifying them as pending.
update public.agenttender_tender_documents
set storage_status = 'COMPLETED', completed_at = coalesce(completed_at, updated_at)
where nullif(btrim(storage_url), '') is not null;

create unique index if not exists agenttender_tender_documents_external_identity_uidx
  on public.agenttender_tender_documents (tender_id, external_source, external_document_id)
  where external_document_id is not null;

commit;
