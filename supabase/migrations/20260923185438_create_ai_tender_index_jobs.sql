-- Durable tender-level AI indexing jobs (Ask AI on-demand indexing).
-- Authoritative state for /ai-index-status polls across serverless isolates.
-- Does not replace per-source agenttender_ai_document_index_status rows.

begin;

create table if not exists public.agenttender_ai_tender_index_jobs (
  tender_id uuid primary key
    references public.agenttender_tenders(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,

  status text not null
    check (
      status in (
        'QUEUED',
        'INDEXING',
        'READY',
        'FAILED',
        'NO_DOCUMENTS'
      )
    ),

  source_count integer not null default 0
    check (source_count >= 0),
  request_id text,
  error_message text,
  last_stage text,

  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.agenttender_ai_tender_index_jobs is
  'Tender-level on-demand AI index job. Durable across Vercel isolates; service_role only.';

create index if not exists agenttender_ai_tender_index_jobs_company_idx
  on public.agenttender_ai_tender_index_jobs (company_id);

create index if not exists agenttender_ai_tender_index_jobs_status_idx
  on public.agenttender_ai_tender_index_jobs (status);

drop trigger if exists agenttender_ai_tender_index_jobs_updated_at
  on public.agenttender_ai_tender_index_jobs;
create trigger agenttender_ai_tender_index_jobs_updated_at
before update on public.agenttender_ai_tender_index_jobs
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_ai_tender_index_jobs enable row level security;
revoke all on public.agenttender_ai_tender_index_jobs from anon, authenticated;
grant all on public.agenttender_ai_tender_index_jobs to service_role;

commit;
