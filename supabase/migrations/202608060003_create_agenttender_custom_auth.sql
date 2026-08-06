begin;

-- =========================================================
-- CUSTOM AUTH (no Supabase Auth)
-- Trusted Next.js server uses service_role only.
-- =========================================================

create extension if not exists pgcrypto;

create or replace function public.agenttender_hash_password(plain_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if plain_password is null or length(plain_password) < 8 then
    raise exception 'Password does not meet minimum length requirements';
  end if;
  return crypt(plain_password, gen_salt('bf', 12));
end;
$$;

create or replace function public.agenttender_verify_password(
  plain_password text,
  stored_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if plain_password is null or stored_hash is null or stored_hash = '' then
    return false;
  end if;
  return crypt(plain_password, stored_hash) = stored_hash;
end;
$$;

revoke all on function public.agenttender_hash_password(text) from public;
revoke all on function public.agenttender_verify_password(text, text) from public;
grant execute on function public.agenttender_hash_password(text) to service_role;
grant execute on function public.agenttender_verify_password(text, text) to service_role;

-- =========================================================
-- USERS
-- =========================================================

create table if not exists public.agenttender_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  password_hash text not null,
  role text not null default 'VIEWER'
    check (role in ('ADMIN', 'BID_MANAGER', 'ANALYST', 'VIEWER')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  failed_login_attempts integer not null default 0
    check (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_users_email_not_blank
    check (length(trim(email)) > 0),
  constraint agenttender_users_full_name_not_blank
    check (length(trim(full_name)) > 0)
);

create unique index if not exists agenttender_users_email_lower_uidx
  on public.agenttender_users (lower(email));

create index if not exists agenttender_users_role_idx
  on public.agenttender_users (role);

create index if not exists agenttender_users_is_active_idx
  on public.agenttender_users (is_active);

create index if not exists agenttender_users_locked_until_idx
  on public.agenttender_users (locked_until);

create index if not exists agenttender_users_created_at_idx
  on public.agenttender_users (created_at);

drop trigger if exists agenttender_users_updated_at on public.agenttender_users;
create trigger agenttender_users_updated_at
before update on public.agenttender_users
for each row
execute function public.agenttender_set_updated_at();

-- =========================================================
-- SESSIONS
-- =========================================================

create table if not exists public.agenttender_user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.agenttender_users(id)
    on delete cascade,
  token_hash text not null unique,
  ip_address inet,
  user_agent text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_user_sessions_user_id_idx
  on public.agenttender_user_sessions(user_id);

create index if not exists agenttender_user_sessions_expires_at_idx
  on public.agenttender_user_sessions(expires_at);

create index if not exists agenttender_user_sessions_revoked_at_idx
  on public.agenttender_user_sessions(revoked_at);

create index if not exists agenttender_user_sessions_token_hash_idx
  on public.agenttender_user_sessions(token_hash);

-- =========================================================
-- AUTH EVENTS
-- =========================================================

create table if not exists public.agenttender_auth_events (
  id bigserial primary key,
  user_id uuid references public.agenttender_users(id) on delete set null,
  attempted_email text,
  event_type text not null
    check (
      event_type in (
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'ACCOUNT_LOCKED',
        'LOGOUT',
        'SESSION_EXPIRED',
        'PASSWORD_CHANGED',
        'PASSWORD_RESET',
        'USER_CREATED',
        'USER_UPDATED',
        'USER_DISABLED',
        'USER_ENABLED',
        'SESSIONS_REVOKED'
      )
    ),
  success boolean not null,
  ip_address inet,
  user_agent text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_auth_events_user_id_idx
  on public.agenttender_auth_events(user_id);

create index if not exists agenttender_auth_events_event_type_idx
  on public.agenttender_auth_events(event_type);

create index if not exists agenttender_auth_events_created_at_idx
  on public.agenttender_auth_events(created_at desc);

create index if not exists agenttender_auth_events_attempted_email_idx
  on public.agenttender_auth_events(attempted_email);

-- =========================================================
-- USER PREFERENCES
-- =========================================================

create table if not exists public.agenttender_user_preferences (
  user_id uuid primary key
    references public.agenttender_users(id)
    on delete cascade,
  theme text not null default 'system'
    check (theme in ('light', 'dark', 'system')),
  table_density text not null default 'comfortable'
    check (table_density in ('compact', 'comfortable', 'spacious')),
  sidebar_collapsed boolean not null default false,
  default_date_filter text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists agenttender_user_preferences_updated_at
  on public.agenttender_user_preferences;
create trigger agenttender_user_preferences_updated_at
before update on public.agenttender_user_preferences
for each row
execute function public.agenttender_set_updated_at();

-- =========================================================
-- RLS — service_role only
-- =========================================================

alter table public.agenttender_users enable row level security;
alter table public.agenttender_user_sessions enable row level security;
alter table public.agenttender_auth_events enable row level security;
alter table public.agenttender_user_preferences enable row level security;

revoke all on public.agenttender_users from anon, authenticated;
revoke all on public.agenttender_user_sessions from anon, authenticated;
revoke all on public.agenttender_auth_events from anon, authenticated;
revoke all on public.agenttender_user_preferences from anon, authenticated;

grant all on public.agenttender_users to service_role;
grant all on public.agenttender_user_sessions to service_role;
grant all on public.agenttender_auth_events to service_role;
grant all on public.agenttender_user_preferences to service_role;
grant usage, select on sequence public.agenttender_auth_events_id_seq to service_role;

commit;
