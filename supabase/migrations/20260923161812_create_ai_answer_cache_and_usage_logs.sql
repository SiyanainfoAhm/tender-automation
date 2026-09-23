-- Phase 8: Ask AI answer cache + usage logs (production hardening).
-- Service-role only. No question/answer content in usage logs.

begin;

-- =========================================================
-- agenttender_ai_answer_cache
-- =========================================================
create table if not exists public.agenttender_ai_answer_cache (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,
  action text not null
    check (
      action in (
        'ASSESS_TENDER',
        'CHECK_ELIGIBILITY',
        'CHECK_SIMILAR_EXPERIENCE',
        'CHECK_TURNOVER',
        'CHECK_GOVERNMENT_EXPERIENCE',
        'CHECK_REQUIRED_DOCUMENTS',
        'CHECK_EMD_MSME',
        'IDENTIFY_RISKS',
        'SUMMARIZE_TENDER'
      )
    ),
  -- Deterministic cache key (sha256 hex of composite parts).
  cache_key text not null
    check (length(trim(cache_key)) = 64),
  model text not null,
  prompt_version text not null,
  retrieval_version text not null,
  tender_evidence_hash text not null,
  company_evidence_hash text not null,
  -- Safe replay payload (answer + structured sources + warnings). No embeddings/prompts.
  answer text not null
    check (length(trim(answer)) > 0),
  sources jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_ai_answer_cache_key_unique unique (cache_key)
);

create index if not exists agenttender_ai_answer_cache_lookup_idx
  on public.agenttender_ai_answer_cache (company_id, tender_id, action, expires_at);

create index if not exists agenttender_ai_answer_cache_expires_idx
  on public.agenttender_ai_answer_cache (expires_at);

alter table public.agenttender_ai_answer_cache enable row level security;

revoke all on table public.agenttender_ai_answer_cache from public, anon, authenticated;
grant all on table public.agenttender_ai_answer_cache to service_role;

-- =========================================================
-- agenttender_ai_usage_logs
-- =========================================================
-- Privacy: no question, answer, prompt, or document contents.
create table if not exists public.agenttender_ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  company_id uuid
    references public.agenttender_companies(id)
    on delete set null,
  user_id uuid,
  tender_id uuid
    references public.agenttender_tenders(id)
    on delete set null,
  action text,
  model text,
  embedding_model text,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  embedding_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(12, 6),
  cache_hit boolean not null default false,
  tender_chunks integer,
  company_chunks integer,
  context_tokens integer,
  retrieval_ms integer,
  first_token_ms integer,
  llm_total_ms integer,
  total_ms integer,
  status text not null
    check (
      status in (
        'success',
        'cache_hit',
        'error',
        'cancelled',
        'rate_limited',
        'concurrent'
      )
    ),
  error_code text,
  source_type text,
  source_id text,
  chunk_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_ai_usage_logs_company_created_idx
  on public.agenttender_ai_usage_logs (company_id, created_at desc);

create index if not exists agenttender_ai_usage_logs_user_created_idx
  on public.agenttender_ai_usage_logs (user_id, created_at desc);

create index if not exists agenttender_ai_usage_logs_request_idx
  on public.agenttender_ai_usage_logs (request_id);

create index if not exists agenttender_ai_usage_logs_action_created_idx
  on public.agenttender_ai_usage_logs (company_id, action, created_at desc);

alter table public.agenttender_ai_usage_logs enable row level security;

revoke all on table public.agenttender_ai_usage_logs from public, anon, authenticated;
grant all on table public.agenttender_ai_usage_logs to service_role;

-- =========================================================
-- Rate-limit helper: count recent Ask AI requests for user/company.
-- =========================================================
create or replace function public.agenttender_ai_count_recent_requests(
  p_company_id uuid,
  p_user_id uuid,
  p_window_seconds integer,
  p_scope text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_since timestamptz := now() - make_interval(secs => greatest(p_window_seconds, 1));
begin
  if p_scope = 'user' then
    select count(*)::integer into v_count
    from public.agenttender_ai_usage_logs
    where company_id = p_company_id
      and user_id = p_user_id
      and created_at >= v_since
      and action is not null;
  else
    select count(*)::integer into v_count
    from public.agenttender_ai_usage_logs
    where company_id = p_company_id
      and created_at >= v_since
      and action is not null;
  end if;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.agenttender_ai_count_recent_requests(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.agenttender_ai_count_recent_requests(uuid, uuid, integer, text)
  to service_role;

commit;
