begin;
create table if not exists public.agenttender_tender_document_upload_sessions (
 id uuid primary key default gen_random_uuid(),
 tender_document_id uuid not null references public.agenttender_tender_documents(id) on delete cascade,
 tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
 external_document_id text not null,
 graph_upload_url text not null,
 next_expected_byte bigint not null default 0,
 expected_bytes bigint,
 expires_at timestamptz,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','COMPLETED','FAILED','EXPIRED')),
 completion_metadata jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create unique index if not exists agenttender_tender_doc_upload_one_active
 on public.agenttender_tender_document_upload_sessions(tender_document_id) where status='ACTIVE';
alter table public.agenttender_tender_document_upload_sessions enable row level security;
revoke all on public.agenttender_tender_document_upload_sessions from anon, authenticated;
grant all on public.agenttender_tender_document_upload_sessions to service_role;
commit;
