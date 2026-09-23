-- RAG foundation: durable document chunks + index status (Ask AI Phase 2).
-- Does not change Ask AI runtime behavior.
--
-- Embedding contract (fixed for this table):
--   AI_EMBEDDING_MODEL = text-embedding-3-small
--   dimensions = 1536
--   similarity = cosine (pgvector <=> / vector_cosine_ops)
-- Changing the embedding model requires a new column/table or full reindex migration.

begin;

-- Already enabled on hosted VBDC; keep idempotent for local / fresh envs.
create extension if not exists vector with schema extensions;

-- =========================================================
-- agenttender_ai_document_chunks
-- =========================================================
-- source_id is text (not a FK): supports UUID document rows AND synthetic
-- ids for portal zips, zip members, and company_profile aggregates.
--
-- Lifecycle (Phase 3 ingestion):
--   1) Same content_hash → skip
--   2) Changed hash → set is_active=false for prior rows of (source_type, source_id)
--      then insert new active chunks
--   3) Or delete inactive rows after successful reindex (optional cleanup)

create table if not exists public.agenttender_ai_document_chunks (
  id uuid primary key default gen_random_uuid(),

  company_id uuid
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid
    references public.agenttender_tenders(id)
    on delete cascade,

  source_type text not null
    check (
      source_type in (
        'TENDER_DOCUMENT',
        'COMPANY_DOCUMENT',
        'COMPANY_PROFILE'
      )
    ),
  -- Stable logical document key (UUID string or synthetic id).
  source_id text not null,

  document_name text,
  document_url text,
  document_type text,
  page_number integer,
  section text,
  chunk_index integer not null
    check (chunk_index >= 0),

  content text not null
    check (length(trim(content)) > 0),
  content_hash text not null
    check (length(trim(content_hash)) > 0),

  -- OpenAI text-embedding-3-small default output size.
  embedding extensions.vector(1536) not null,

  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_ai_document_chunks_source_id_not_blank
    check (length(trim(source_id)) > 0),

  constraint agenttender_ai_document_chunks_scope_check
    check (
      (
        source_type = 'TENDER_DOCUMENT'
        and tender_id is not null
      )
      or (
        source_type in ('COMPANY_DOCUMENT', 'COMPANY_PROFILE')
        and company_id is not null
        and tender_id is null
      )
    ),

  -- ZIP member / archive hints live in metadata, e.g.:
  -- {
  --   "archive_source_id": "tender_portal_zip:<tender_id>",
  --   "archive_name": "Tender_All_Documents.zip",
  --   "member_path": "folder/eligibility.pdf"
  -- }
  constraint agenttender_ai_document_chunks_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.agenttender_ai_document_chunks is
  'Pre-indexed RAG chunks for Ask AI. Queried only via service_role server code.';
comment on column public.agenttender_ai_document_chunks.embedding is
  'OpenAI text-embedding-3-small vector (1536). Do not mix embedding models in this column.';
comment on column public.agenttender_ai_document_chunks.source_id is
  'Stable document key: tender/company document UUID, portal zip id, zip member id, or company_profile:<company_id>.';
comment on column public.agenttender_ai_document_chunks.metadata is
  'Optional extras including ZIP archive_source_id / archive_name / member_path.';
comment on column public.agenttender_ai_document_chunks.is_active is
  'False for superseded chunks after reindex. Retrieval must filter is_active = true.';

-- One active chunk slot per source version index.
create unique index if not exists agenttender_ai_document_chunks_active_uidx
  on public.agenttender_ai_document_chunks (
    source_type,
    source_id,
    content_hash,
    chunk_index
  )
  where is_active;

-- Relational filters
create index if not exists agenttender_ai_document_chunks_tender_idx
  on public.agenttender_ai_document_chunks (tender_id)
  where tender_id is not null and is_active;

create index if not exists agenttender_ai_document_chunks_company_idx
  on public.agenttender_ai_document_chunks (company_id)
  where company_id is not null and is_active;

create index if not exists agenttender_ai_document_chunks_source_type_idx
  on public.agenttender_ai_document_chunks (source_type)
  where is_active;

create index if not exists agenttender_ai_document_chunks_source_id_idx
  on public.agenttender_ai_document_chunks (source_type, source_id)
  where is_active;

create index if not exists agenttender_ai_document_chunks_content_hash_idx
  on public.agenttender_ai_document_chunks (content_hash);

create index if not exists agenttender_ai_document_chunks_tender_source_type_idx
  on public.agenttender_ai_document_chunks (tender_id, source_type)
  where tender_id is not null and is_active;

create index if not exists agenttender_ai_document_chunks_company_source_type_idx
  on public.agenttender_ai_document_chunks (company_id, source_type)
  where company_id is not null and is_active;

-- Full-text (hybrid retrieval later)
alter table public.agenttender_ai_document_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists agenttender_ai_document_chunks_content_tsv_gin
  on public.agenttender_ai_document_chunks
  using gin (content_tsv)
  where is_active;

-- Vector index: HNSW + cosine (default choice for OpenAI embeddings).
-- Safe to create on empty table; fills as rows are inserted.
create index if not exists agenttender_ai_document_chunks_embedding_hnsw
  on public.agenttender_ai_document_chunks
  using hnsw (embedding vector_cosine_ops)
  where is_active;

drop trigger if exists agenttender_ai_document_chunks_updated_at
  on public.agenttender_ai_document_chunks;
create trigger agenttender_ai_document_chunks_updated_at
before update on public.agenttender_ai_document_chunks
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_ai_document_chunks enable row level security;
revoke all on public.agenttender_ai_document_chunks from anon, authenticated;
grant all on public.agenttender_ai_document_chunks to service_role;

-- =========================================================
-- agenttender_ai_document_index_status
-- =========================================================

create table if not exists public.agenttender_ai_document_index_status (
  id uuid primary key default gen_random_uuid(),

  company_id uuid
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid
    references public.agenttender_tenders(id)
    on delete cascade,

  source_type text not null
    check (
      source_type in (
        'TENDER_DOCUMENT',
        'COMPANY_DOCUMENT',
        'COMPANY_PROFILE'
      )
    ),
  source_id text not null,

  document_name text,
  document_url text,
  content_hash text,

  status text not null default 'NOT_INDEXED'
    check (
      status in (
        'NOT_INDEXED',
        'INDEXING',
        'INDEXED',
        'INDEX_FAILED',
        'NEEDS_REINDEX'
      )
    ),

  chunk_count integer not null default 0
    check (chunk_count >= 0),
  last_indexed_at timestamptz,
  last_attempted_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_ai_index_status_source_id_not_blank
    check (length(trim(source_id)) > 0),

  constraint agenttender_ai_index_status_scope_check
    check (
      (
        source_type = 'TENDER_DOCUMENT'
        and tender_id is not null
      )
      or (
        source_type in ('COMPANY_DOCUMENT', 'COMPANY_PROFILE')
        and company_id is not null
        and tender_id is null
      )
    )
);

comment on table public.agenttender_ai_document_index_status is
  'Per-source AI indexing state for Ask AI. Server/service_role only.';

-- One status row per logical source.
create unique index if not exists agenttender_ai_document_index_status_source_uidx
  on public.agenttender_ai_document_index_status (source_type, source_id);

create index if not exists agenttender_ai_document_index_status_tender_idx
  on public.agenttender_ai_document_index_status (tender_id)
  where tender_id is not null;

create index if not exists agenttender_ai_document_index_status_company_idx
  on public.agenttender_ai_document_index_status (company_id)
  where company_id is not null;

create index if not exists agenttender_ai_document_index_status_status_idx
  on public.agenttender_ai_document_index_status (status);

drop trigger if exists agenttender_ai_document_index_status_updated_at
  on public.agenttender_ai_document_index_status;
create trigger agenttender_ai_document_index_status_updated_at
before update on public.agenttender_ai_document_index_status
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_ai_document_index_status enable row level security;
revoke all on public.agenttender_ai_document_index_status from anon, authenticated;
grant all on public.agenttender_ai_document_index_status to service_role;

-- =========================================================
-- Company document opt-in for AI indexing (default enabled)
-- =========================================================
-- Additive, non-breaking. Phase 3 ingestion should skip rows where false.

alter table public.agenttender_company_documents
  add column if not exists ai_index_enabled boolean not null default true;

comment on column public.agenttender_company_documents.ai_index_enabled is
  'When false, Ask AI ingestion must skip this company document. Default true.';

create index if not exists agenttender_company_documents_ai_index_enabled_idx
  on public.agenttender_company_documents (company_id)
  where ai_index_enabled and status = 'active';

commit;
