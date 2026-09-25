-- Persistent, tenant-isolated Ask AI conversations. Application APIs use service role
-- only after deriving the user/company from the authenticated server session.
begin;

create table if not exists public.agenttender_ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.agenttender_companies(id) on delete cascade,
  user_id uuid not null,
  tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists agenttender_ai_chat_sessions_scope_idx
  on public.agenttender_ai_chat_sessions (company_id, user_id, tender_id, is_archived, last_message_at desc);

create table if not exists public.agenttender_ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.agenttender_ai_chat_sessions(id) on delete cascade,
  company_id uuid not null references public.agenttender_companies(id) on delete cascade,
  user_id uuid not null,
  tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  action text,
  sources jsonb,
  warnings jsonb,
  status text not null default 'complete' check (status in ('complete', 'interrupted', 'cancelled', 'error')),
  model text,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_ai_chat_messages_session_idx
  on public.agenttender_ai_chat_messages (session_id, created_at);

alter table public.agenttender_ai_chat_sessions enable row level security;
alter table public.agenttender_ai_chat_messages enable row level security;
revoke all on public.agenttender_ai_chat_sessions from public, anon, authenticated;
revoke all on public.agenttender_ai_chat_messages from public, anon, authenticated;
grant all on public.agenttender_ai_chat_sessions to service_role;
grant all on public.agenttender_ai_chat_messages to service_role;
commit;
