begin;

alter table public.agenttender_company_documents
  drop constraint if exists agenttender_company_documents_storage_provider_check;
alter table public.agenttender_company_documents
  add constraint agenttender_company_documents_storage_provider_check
  check (storage_provider in ('none', 'azure', 'sharepoint', 'local'));

alter table public.agenttender_tender_documents
  drop constraint if exists agenttender_tender_documents_storage_provider_check;
alter table public.agenttender_tender_documents
  add constraint agenttender_tender_documents_storage_provider_check
  check (storage_provider in ('none', 'azure', 'sharepoint', 'local'));

alter table public.agenttender_won_project_documents
  drop constraint if exists agenttender_won_project_documents_storage_provider_check;
alter table public.agenttender_won_project_documents
  add constraint agenttender_won_project_documents_storage_provider_check
  check (storage_provider in ('none', 'azure', 'sharepoint', 'local'));

comment on column public.agenttender_company_documents.storage_provider is
  'Storage backend. New tender/manual uploads use SharePoint; azure is retained for legacy rows.';
comment on column public.agenttender_tender_documents.storage_provider is
  'Storage backend. New tender/manual uploads use SharePoint; azure is retained for legacy rows.';

commit;
