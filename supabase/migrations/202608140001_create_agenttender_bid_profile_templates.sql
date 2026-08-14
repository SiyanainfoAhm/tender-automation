begin;

-- Bid profile templates (company-scoped). Custom auth + service_role.

create table if not exists public.agenttender_bid_profile_templates (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,

  template_name text not null,
  description text,

  is_default boolean not null default false,

  company_name text not null,
  reference_number text,
  tender_acceptance_undertaking_date date,

  minimum_local_content numeric(5,2),
  local_value_addition_location text,

  authorized_person_name text not null,
  authorized_person_position text,

  signatory_name text not null,
  signatory_designation text,

  department_name text not null,
  department_address text,
  company_address text,

  company_logo_url text,
  company_signatory_url text,

  status text not null default 'active'
    check (status in ('active', 'archived')),

  created_by uuid references public.agenttender_users(id) on delete set null,
  updated_by uuid references public.agenttender_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_bid_profile_templates_name_not_blank
    check (length(trim(template_name)) > 0),
  constraint agenttender_bid_profile_templates_company_name_not_blank
    check (length(trim(company_name)) > 0),
  constraint agenttender_bid_profile_templates_authorized_not_blank
    check (length(trim(authorized_person_name)) > 0),
  constraint agenttender_bid_profile_templates_signatory_not_blank
    check (length(trim(signatory_name)) > 0),
  constraint agenttender_bid_profile_templates_department_not_blank
    check (length(trim(department_name)) > 0),
  constraint agenttender_bid_profile_templates_local_content_range
    check (
      minimum_local_content is null
      or (
        minimum_local_content >= 0
        and minimum_local_content <= 100
      )
    )
);

create index if not exists idx_agenttender_bid_profile_templates_company
  on public.agenttender_bid_profile_templates (company_id);

create index if not exists idx_agenttender_bid_profile_templates_company_status
  on public.agenttender_bid_profile_templates (company_id, status);

create unique index if not exists
  uq_agenttender_bid_profile_templates_default_company
on public.agenttender_bid_profile_templates (company_id)
where is_default = true and status = 'active';

drop trigger if exists agenttender_bid_profile_templates_updated_at
  on public.agenttender_bid_profile_templates;
create trigger agenttender_bid_profile_templates_updated_at
before update on public.agenttender_bid_profile_templates
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_bid_profile_templates enable row level security;

revoke all on public.agenttender_bid_profile_templates from anon, authenticated;
grant all on public.agenttender_bid_profile_templates to service_role;

commit;
