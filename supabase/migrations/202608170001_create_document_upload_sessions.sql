-- Chunked company document uploads (Azure Block Blob sessions).
-- Incomplete documents stay off the library list until status = active.

begin;

alter table public.agenttender_company_documents
  add column if not exists content_hash text;

alter table public.agenttender_company_documents
  drop constraint if exists agenttender_company_documents_status_check;

alter table public.agenttender_company_documents
  add constraint agenttender_company_documents_status_check
  check (
    status in (
      'active',
      'archived',
      'deleted',
      'uploading',
      'processing',
      'failed'
    )
  );

create table if not exists public.agenttender_document_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.agenttender_company_documents(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  created_by uuid not null
    references public.agenttender_users(id)
    on delete cascade,

  blob_name text not null,
  original_file_name text not null,
  mime_type text,
  file_size_bytes bigint not null,
  chunk_size integer not null,
  total_chunks integer not null,
  received_indexes integer[] not null default '{}',
  content_hash text,
  error_message text,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'uploading',
        'finalizing',
        'complete',
        'aborted',
        'expired',
        'failed'
      )
    ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_document_upload_sessions_chunks_positive
    check (chunk_size > 0 and total_chunks > 0 and file_size_bytes > 0)
);

create index if not exists agenttender_document_upload_sessions_company_idx
  on public.agenttender_document_upload_sessions (company_id, created_by);

create index if not exists agenttender_document_upload_sessions_document_idx
  on public.agenttender_document_upload_sessions (document_id);

create index if not exists agenttender_document_upload_sessions_expiry_idx
  on public.agenttender_document_upload_sessions (expires_at)
  where status in ('pending', 'uploading', 'finalizing');

drop trigger if exists agenttender_document_upload_sessions_updated_at
  on public.agenttender_document_upload_sessions;
create trigger agenttender_document_upload_sessions_updated_at
before update on public.agenttender_document_upload_sessions
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_document_upload_sessions enable row level security;

revoke all on public.agenttender_document_upload_sessions from anon, authenticated;
grant all on public.agenttender_document_upload_sessions to service_role;

commit;
