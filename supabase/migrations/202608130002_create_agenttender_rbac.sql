begin;

-- Expand user roles for TenderFlow company RBAC
alter table public.agenttender_users
  drop constraint if exists agenttender_users_role_check;

-- Migrate legacy roles before adding new constraint
update public.agenttender_users
set role = 'FINANCIAL_ANALYST'
where role = 'ANALYST';

update public.agenttender_users
set role = 'BID_COORDINATOR'
where role = 'VIEWER';

alter table public.agenttender_users
  add constraint agenttender_users_role_check
  check (
    role in (
      'ADMIN',
      'BID_MANAGER',
      'TECHNICAL_LEAD',
      'FINANCIAL_ANALYST',
      'BID_COORDINATOR',
      'DOCUMENT_SPECIALIST'
    )
  );

-- Permissions catalog
create table if not exists public.agenttender_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_permissions_category_idx
  on public.agenttender_permissions (category, sort_order);

-- Role → permission mapping (role is system key matching users.role)
create table if not exists public.agenttender_role_permissions (
  role text not null
    check (
      role in (
        'ADMIN',
        'BID_MANAGER',
        'TECHNICAL_LEAD',
        'FINANCIAL_ANALYST',
        'BID_COORDINATOR',
        'DOCUMENT_SPECIALIST'
      )
    ),
  permission_id uuid not null
    references public.agenttender_permissions(id)
    on delete cascade,
  primary key (role, permission_id)
);

create index if not exists agenttender_role_permissions_role_idx
  on public.agenttender_role_permissions (role);

-- Company invitations
create table if not exists public.agenttender_company_user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  email text not null,
  full_name text,
  role text not null
    check (
      role in (
        'ADMIN',
        'BID_MANAGER',
        'TECHNICAL_LEAD',
        'FINANCIAL_ANALYST',
        'BID_COORDINATOR',
        'DOCUMENT_SPECIALIST'
      )
    ),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'cancelled')),
  invited_by uuid references public.agenttender_users(id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_invites_email_not_blank
    check (length(trim(email)) > 0)
);

create unique index if not exists agenttender_invites_pending_company_email_uidx
  on public.agenttender_company_user_invitations (company_id, lower(email))
  where status = 'pending';

create index if not exists agenttender_invites_company_idx
  on public.agenttender_company_user_invitations (company_id, status);

drop trigger if exists agenttender_invites_updated_at
  on public.agenttender_company_user_invitations;
create trigger agenttender_invites_updated_at
before update on public.agenttender_company_user_invitations
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_permissions enable row level security;
alter table public.agenttender_role_permissions enable row level security;
alter table public.agenttender_company_user_invitations enable row level security;

revoke all on public.agenttender_permissions from anon, authenticated;
revoke all on public.agenttender_role_permissions from anon, authenticated;
revoke all on public.agenttender_company_user_invitations from anon, authenticated;

grant all on public.agenttender_permissions to service_role;
grant all on public.agenttender_role_permissions to service_role;
grant all on public.agenttender_company_user_invitations to service_role;

commit;
