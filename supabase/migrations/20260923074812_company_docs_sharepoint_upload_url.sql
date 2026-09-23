-- Company document chunked uploads: store Graph upload-session URL so Edge
-- can forward browser chunks to SharePoint (same pattern as tender direct-upload).

begin;

alter table public.agenttender_document_upload_sessions
  add column if not exists sharepoint_upload_url text;

comment on column public.agenttender_document_upload_sessions.sharepoint_upload_url is
  'Temporary Microsoft Graph createUploadSession URL. Never expose to the browser.';

commit;
