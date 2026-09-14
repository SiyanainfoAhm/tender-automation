begin;

-- Multi-company memberships (custom auth). users.company_id remains the
-- active company pointer; memberships are the access source of truth.

create table if not exists public.agenttender_company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.agenttender_users(id)
    on delete cascade,
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
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
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  created_by uuid
    references public.agenttender_users(id)
    on delete set null,
  constraint agenttender_company_memberships_user_company_unique
    unique (user_id, company_id)
);

create index if not exists agenttender_company_memberships_user_idx
  on public.agenttender_company_memberships (user_id);

create index if not exists agenttender_company_memberships_company_idx
  on public.agenttender_company_memberships (company_id, status);

-- Backfill from existing single-company assignments
insert into public.agenttender_company_memberships (
  user_id,
  company_id,
  role,
  status,
  created_at,
  created_by
)
select
  u.id,
  u.company_id,
  u.role,
  case when u.is_active then 'active' else 'disabled' end,
  coalesce(u.created_at, now()),
  u.created_by
from public.agenttender_users u
where u.company_id is not null
on conflict (user_id, company_id) do nothing;

alter table public.agenttender_company_memberships enable row level security;
revoke all on public.agenttender_company_memberships from anon, authenticated;
grant all on public.agenttender_company_memberships to service_role;

-- Atomic: create company + default prefs + ADMIN membership + set active
create or replace function public.agenttender_create_company_for_user(
  p_user_id uuid,
  p_name text,
  p_industry_type text default null,
  p_business_location text default null,
  p_website text default null,
  p_make_active boolean default true
)
returns table (
  company_id uuid,
  membership_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_membership_id uuid;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Company name is required';
  end if;

  if not exists (
    select 1 from public.agenttender_users u
    where u.id = p_user_id and u.is_active = true
  ) then
    raise exception 'User not found or inactive';
  end if;

  insert into public.agenttender_companies (
    name,
    industry_type,
    business_location,
    website
  ) values (
    btrim(p_name),
    nullif(btrim(coalesce(p_industry_type, '')), ''),
    nullif(btrim(coalesce(p_business_location, '')), ''),
    nullif(btrim(coalesce(p_website, '')), '')
  )
  returning id into v_company_id;

  insert into public.agenttender_company_bid_preferences (
    company_id,
    max_emd_inr,
    min_tender_value_inr,
    max_tender_value_inr,
    service_scope,
    excluded_scope
  ) values (
    v_company_id,
    1500000,
    null,
    50000000,
    '[]'::jsonb,
    '[]'::jsonb
  );

  insert into public.agenttender_company_memberships (
    user_id,
    company_id,
    role,
    status,
    created_by
  ) values (
    p_user_id,
    v_company_id,
    'ADMIN',
    'active',
    p_user_id
  )
  returning id into v_membership_id;

  if coalesce(p_make_active, true) then
    update public.agenttender_users
      set company_id = v_company_id,
          role = 'ADMIN',
          updated_at = now()
    where id = p_user_id;
  end if;

  company_id := v_company_id;
  membership_id := v_membership_id;
  return next;
end;
$$;

revoke all on function public.agenttender_create_company_for_user(
  uuid, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.agenttender_create_company_for_user(
  uuid, text, text, text, text, boolean
) to service_role;

-- Switch active company after membership check
create or replace function public.agenttender_switch_active_company(
  p_user_id uuid,
  p_company_id uuid
)
returns table (
  company_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.agenttender_company_memberships m
  where m.user_id = p_user_id
    and m.company_id = p_company_id
    and m.status = 'active'
  for update;

  if v_role is null then
    raise exception 'Not a member of that company';
  end if;

  update public.agenttender_users
    set company_id = p_company_id,
        role = v_role,
        updated_at = now()
  where id = p_user_id
    and is_active = true;

  if not found then
    raise exception 'User not found or inactive';
  end if;

  company_id := p_company_id;
  role := v_role;
  return next;
end;
$$;

revoke all on function public.agenttender_switch_active_company(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agenttender_switch_active_company(uuid, uuid)
  to service_role;

commit;
