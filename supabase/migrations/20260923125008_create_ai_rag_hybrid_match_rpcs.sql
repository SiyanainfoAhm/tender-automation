-- Phase 4: hybrid retrieval RPCs for Ask AI RAG.
-- Service-role only. Filters are mandatory in each function body.

begin;

-- =========================================================
-- Tender vector match (cosine similarity via <=> )
-- =========================================================
create or replace function public.agenttender_match_tender_chunks(
  p_tender_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 16,
  p_min_similarity double precision default 0.22
)
returns table (
  id uuid,
  company_id uuid,
  tender_id uuid,
  source_type text,
  source_id text,
  document_name text,
  document_url text,
  document_type text,
  page_number integer,
  section text,
  chunk_index integer,
  content text,
  content_hash text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.company_id,
    c.tender_id,
    c.source_type,
    c.source_id,
    c.document_name,
    c.document_url,
    c.document_type,
    c.page_number,
    c.section,
    c.chunk_index,
    c.content,
    c.content_hash,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::double precision as similarity
  from public.agenttender_ai_document_chunks c
  where c.is_active = true
    and c.source_type = 'TENDER_DOCUMENT'
    and c.tender_id = p_tender_id
    and (1 - (c.embedding <=> p_query_embedding)) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 16), 48));
$$;

comment on function public.agenttender_match_tender_chunks is
  'Ask AI Phase 4: vector retrieval for one tender. Always filters tender_id + TENDER_DOCUMENT + is_active.';

-- =========================================================
-- Tender FTS match
-- =========================================================
create or replace function public.agenttender_match_tender_chunks_fts(
  p_tender_id uuid,
  p_query text,
  p_match_count integer default 16
)
returns table (
  id uuid,
  company_id uuid,
  tender_id uuid,
  source_type text,
  source_id text,
  document_name text,
  document_url text,
  document_type text,
  page_number integer,
  section text,
  chunk_index integer,
  content text,
  content_hash text,
  metadata jsonb,
  fts_rank double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(nullif(trim(p_query), ''), 'tender')) as tsq
  )
  select
    c.id,
    c.company_id,
    c.tender_id,
    c.source_type,
    c.source_id,
    c.document_name,
    c.document_url,
    c.document_type,
    c.page_number,
    c.section,
    c.chunk_index,
    c.content,
    c.content_hash,
    c.metadata,
    ts_rank_cd(c.content_tsv, q.tsq)::double precision as fts_rank
  from public.agenttender_ai_document_chunks c
  cross join q
  where c.is_active = true
    and c.source_type = 'TENDER_DOCUMENT'
    and c.tender_id = p_tender_id
    and c.content_tsv @@ q.tsq
  order by ts_rank_cd(c.content_tsv, q.tsq) desc
  limit greatest(1, least(coalesce(p_match_count, 16), 48));
$$;

comment on function public.agenttender_match_tender_chunks_fts is
  'Ask AI Phase 4: FTS retrieval for one tender. Always filters tender_id + TENDER_DOCUMENT + is_active.';

-- =========================================================
-- Company vector match
-- =========================================================
create or replace function public.agenttender_match_company_chunks(
  p_company_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 12,
  p_min_similarity double precision default 0.22
)
returns table (
  id uuid,
  company_id uuid,
  tender_id uuid,
  source_type text,
  source_id text,
  document_name text,
  document_url text,
  document_type text,
  page_number integer,
  section text,
  chunk_index integer,
  content text,
  content_hash text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.company_id,
    c.tender_id,
    c.source_type,
    c.source_id,
    c.document_name,
    c.document_url,
    c.document_type,
    c.page_number,
    c.section,
    c.chunk_index,
    c.content,
    c.content_hash,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::double precision as similarity
  from public.agenttender_ai_document_chunks c
  where c.is_active = true
    and c.company_id = p_company_id
    and c.tender_id is null
    and c.source_type in ('COMPANY_DOCUMENT', 'COMPANY_PROFILE')
    and (1 - (c.embedding <=> p_query_embedding)) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 12), 32));
$$;

comment on function public.agenttender_match_company_chunks is
  'Ask AI Phase 4: vector retrieval for one company. Always filters company_id + company sources + is_active.';

-- =========================================================
-- Company FTS match
-- =========================================================
create or replace function public.agenttender_match_company_chunks_fts(
  p_company_id uuid,
  p_query text,
  p_match_count integer default 12
)
returns table (
  id uuid,
  company_id uuid,
  tender_id uuid,
  source_type text,
  source_id text,
  document_name text,
  document_url text,
  document_type text,
  page_number integer,
  section text,
  chunk_index integer,
  content text,
  content_hash text,
  metadata jsonb,
  fts_rank double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(nullif(trim(p_query), ''), 'company')) as tsq
  )
  select
    c.id,
    c.company_id,
    c.tender_id,
    c.source_type,
    c.source_id,
    c.document_name,
    c.document_url,
    c.document_type,
    c.page_number,
    c.section,
    c.chunk_index,
    c.content,
    c.content_hash,
    c.metadata,
    ts_rank_cd(c.content_tsv, q.tsq)::double precision as fts_rank
  from public.agenttender_ai_document_chunks c
  cross join q
  where c.is_active = true
    and c.company_id = p_company_id
    and c.tender_id is null
    and c.source_type in ('COMPANY_DOCUMENT', 'COMPANY_PROFILE')
    and c.content_tsv @@ q.tsq
  order by ts_rank_cd(c.content_tsv, q.tsq) desc
  limit greatest(1, least(coalesce(p_match_count, 12), 32));
$$;

comment on function public.agenttender_match_company_chunks_fts is
  'Ask AI Phase 4: FTS retrieval for one company. Always filters company_id + company sources + is_active.';

revoke all on function public.agenttender_match_tender_chunks(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
revoke all on function public.agenttender_match_tender_chunks_fts(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.agenttender_match_company_chunks(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
revoke all on function public.agenttender_match_company_chunks_fts(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.agenttender_match_tender_chunks(uuid, extensions.vector, integer, double precision) to service_role;
grant execute on function public.agenttender_match_tender_chunks_fts(uuid, text, integer) to service_role;
grant execute on function public.agenttender_match_company_chunks(uuid, extensions.vector, integer, double precision) to service_role;
grant execute on function public.agenttender_match_company_chunks_fts(uuid, text, integer) to service_role;

commit;
