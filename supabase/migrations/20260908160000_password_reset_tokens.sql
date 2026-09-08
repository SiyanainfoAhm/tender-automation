-- Password-reset tokens for self-service forgot/reset (TF-6).
-- Tokens are stored hashed; plaintext is emailed once via Power Automate.

begin;

create table if not exists public.agenttender_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.agenttender_users(id)
    on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agenttender_password_reset_tokens_expires_after_created
    check (expires_at > created_at)
);

create index if not exists agenttender_password_reset_tokens_user_id_idx
  on public.agenttender_password_reset_tokens(user_id);

create index if not exists agenttender_password_reset_tokens_expires_at_idx
  on public.agenttender_password_reset_tokens(expires_at);

alter table public.agenttender_password_reset_tokens enable row level security;

revoke all on public.agenttender_password_reset_tokens from anon, authenticated;
grant all on public.agenttender_password_reset_tokens to service_role;

alter table public.agenttender_auth_events
  drop constraint if exists agenttender_auth_events_event_type_check;

alter table public.agenttender_auth_events
  add constraint agenttender_auth_events_event_type_check
  check (
    event_type in (
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'ACCOUNT_LOCKED',
      'LOGOUT',
      'SESSION_EXPIRED',
      'PASSWORD_CHANGED',
      'PASSWORD_RESET',
      'PASSWORD_RESET_REQUESTED',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_DISABLED',
      'USER_ENABLED',
      'SESSIONS_REVOKED'
    )
  );

commit;
