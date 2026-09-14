begin;

-- =========================================================
-- Won Tenders / Project Execution
-- Tables live in public.agenttender_* (no tenderflow schema).
-- =========================================================

create sequence if not exists public.agenttender_won_project_code_seq;

create table if not exists public.agenttender_won_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,

  project_code text not null,
  execution_status text not null default 'awarded'
    check (
      execution_status in (
        'awarded',
        'in_execution',
        'on_hold',
        'completed',
        'cancelled'
      )
    ),

  award_date date not null,
  final_award_value numeric(20, 2) not null
    check (final_award_value >= 0),

  po_number text,
  po_date date,
  contract_number text,
  contract_start_date date,
  contract_end_date date,

  client_department text,
  project_manager_id uuid
    references public.agenttender_users(id)
    on delete set null,

  pbg_applicable boolean not null default false,
  pbg_number text,
  pbg_amount numeric(20, 2)
    check (pbg_amount is null or pbg_amount >= 0),
  pbg_issue_date date,
  pbg_expiry_date date,
  pbg_bank text,
  pbg_status text
    check (
      pbg_status is null
      or pbg_status in (
        'pending',
        'active',
        'released',
        'expired',
        'invoked'
      )
    ),

  jira_project_key text,
  jira_url text,
  repository_url text,
  deployment_url text,
  staging_url text,
  production_url text,
  development_notes text,

  notes text,

  created_by uuid references public.agenttender_users(id) on delete set null,
  updated_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_won_projects_tender_unique unique (tender_id),
  constraint agenttender_won_projects_code_unique unique (company_id, project_code)
);

create index if not exists agenttender_won_projects_company_idx
  on public.agenttender_won_projects (company_id);

create index if not exists agenttender_won_projects_status_idx
  on public.agenttender_won_projects (company_id, execution_status);

create index if not exists agenttender_won_projects_manager_idx
  on public.agenttender_won_projects (project_manager_id);

drop trigger if exists agenttender_won_projects_updated_at
  on public.agenttender_won_projects;
create trigger agenttender_won_projects_updated_at
before update on public.agenttender_won_projects
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_won_project_milestones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  won_project_id uuid not null
    references public.agenttender_won_projects(id)
    on delete cascade,

  title text not null,
  description text,
  due_date date not null,
  milestone_value numeric(20, 2)
    check (milestone_value is null or milestone_value >= 0),
  payment_linked boolean not null default false,
  status text not null default 'not_started'
    check (
      status in (
        'not_started',
        'in_progress',
        'completed',
        'delayed',
        'on_hold'
      )
    ),
  owner_id uuid
    references public.agenttender_users(id)
    on delete set null,
  completed_at date,
  notes text,
  sort_order integer not null default 0,

  created_by uuid references public.agenttender_users(id) on delete set null,
  updated_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_won_milestones_title_not_blank
    check (length(btrim(title)) > 0)
);

create index if not exists agenttender_won_milestones_project_idx
  on public.agenttender_won_project_milestones (won_project_id, sort_order);

create index if not exists agenttender_won_milestones_company_idx
  on public.agenttender_won_project_milestones (company_id);

drop trigger if exists agenttender_won_milestones_updated_at
  on public.agenttender_won_project_milestones;
create trigger agenttender_won_milestones_updated_at
before update on public.agenttender_won_project_milestones
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_won_project_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  won_project_id uuid not null
    references public.agenttender_won_projects(id)
    on delete cascade,
  milestone_id uuid
    references public.agenttender_won_project_milestones(id)
    on delete set null,

  title text not null,
  invoice_number text,
  invoice_date date,
  amount numeric(20, 2) not null
    check (amount > 0),
  due_date date not null,
  received_amount numeric(20, 2) not null default 0
    check (received_amount >= 0),
  received_date date,
  payment_mode text
    check (
      payment_mode is null
      or payment_mode in (
        'bank_transfer',
        'cheque',
        'neft',
        'rtgs',
        'upi',
        'other'
      )
    ),
  transaction_reference text,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'partially_received',
        'received',
        'overdue',
        'cancelled'
      )
    ),
  notes text,

  created_by uuid references public.agenttender_users(id) on delete set null,
  updated_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_won_payments_title_not_blank
    check (length(btrim(title)) > 0)
);

create index if not exists agenttender_won_payments_project_idx
  on public.agenttender_won_project_payments (won_project_id);

create index if not exists agenttender_won_payments_company_idx
  on public.agenttender_won_project_payments (company_id);

drop trigger if exists agenttender_won_payments_updated_at
  on public.agenttender_won_project_payments;
create trigger agenttender_won_payments_updated_at
before update on public.agenttender_won_project_payments
for each row
execute function public.agenttender_set_updated_at();

create table if not exists public.agenttender_won_project_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  payment_id uuid not null
    references public.agenttender_won_project_payments(id)
    on delete cascade,

  amount numeric(20, 2) not null
    check (amount > 0),
  received_date date not null,
  payment_mode text not null
    check (
      payment_mode in (
        'bank_transfer',
        'cheque',
        'neft',
        'rtgs',
        'upi',
        'other'
      )
    ),
  transaction_reference text,
  notes text,

  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists agenttender_won_receipts_payment_idx
  on public.agenttender_won_project_payment_receipts (payment_id);

create table if not exists public.agenttender_won_project_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  won_project_id uuid not null
    references public.agenttender_won_projects(id)
    on delete cascade,
  milestone_id uuid
    references public.agenttender_won_project_milestones(id)
    on delete set null,
  payment_id uuid
    references public.agenttender_won_project_payments(id)
    on delete set null,
  tender_document_id uuid
    references public.agenttender_tender_documents(id)
    on delete set null,

  title text not null,
  category text not null
    check (
      category in (
        'purchase_order',
        'contract',
        'letter_of_intent',
        'pbg',
        'invoice',
        'payment_receipt',
        'milestone_deliverable',
        'acceptance_certificate',
        'completion_certificate',
        'correspondence',
        'technical_document',
        'other'
      )
    ),
  file_name text not null,
  original_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_provider text not null default 'azure'
    check (storage_provider in ('none', 'azure', 'local')),
  storage_url text,
  document_date date,
  description text,

  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_won_documents_title_not_blank
    check (length(btrim(title)) > 0)
);

create index if not exists agenttender_won_documents_project_idx
  on public.agenttender_won_project_documents (won_project_id);

drop trigger if exists agenttender_won_documents_updated_at
  on public.agenttender_won_project_documents;
create trigger agenttender_won_documents_updated_at
before update on public.agenttender_won_project_documents
for each row
execute function public.agenttender_set_updated_at();

-- Atomic mark-as-won: status + project create in one transaction.
create or replace function public.agenttender_mark_tender_won(
  p_tender_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_award_date date,
  p_final_award_value numeric,
  p_po_number text default null,
  p_po_date date default null,
  p_contract_number text default null,
  p_contract_start_date date default null,
  p_contract_end_date date default null,
  p_client_department text default null,
  p_project_manager_id uuid default null,
  p_pbg_applicable boolean default false,
  p_pbg_amount numeric default null,
  p_pbg_expiry_date date default null,
  p_notes text default null
)
returns table (
  won_project_id uuid,
  project_code text,
  already_existed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_code text;
  v_code text;
  v_new_id uuid;
  v_tender_id uuid;
begin
  if p_final_award_value is null or p_final_award_value < 0 then
    raise exception 'Final award value must be >= 0';
  end if;
  if p_award_date is null then
    raise exception 'Award date is required';
  end if;
  if p_company_id is null then
    raise exception 'Company id is required';
  end if;

  select t.id into v_tender_id
  from public.agenttender_tenders t
  where t.id = p_tender_id
  for update;

  if v_tender_id is null then
    raise exception 'Tender not found';
  end if;

  select wp.id, wp.project_code
    into v_existing_id, v_existing_code
  from public.agenttender_won_projects wp
  where wp.tender_id = p_tender_id
  for update;

  if v_existing_id is not null then
    update public.agenttender_tenders
      set qualification_status = 'WON',
          updated_at = now()
    where id = p_tender_id
      and (qualification_status is distinct from 'WON');

    update public.agenttender_qualification_results
      set status = 'WON',
          decision_label = 'Won',
          required_action = 'Execute project',
          updated_at = now()
    where tender_id = p_tender_id;

    won_project_id := v_existing_id;
    project_code := v_existing_code;
    already_existed := true;
    return next;
    return;
  end if;

  v_code := 'WON-' || lpad(
    nextval('public.agenttender_won_project_code_seq')::text,
    3,
    '0'
  );

  insert into public.agenttender_won_projects (
    company_id,
    tender_id,
    project_code,
    execution_status,
    award_date,
    final_award_value,
    po_number,
    po_date,
    contract_number,
    contract_start_date,
    contract_end_date,
    client_department,
    project_manager_id,
    pbg_applicable,
    pbg_amount,
    pbg_expiry_date,
    pbg_status,
    notes,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_tender_id,
    v_code,
    'awarded',
    p_award_date,
    p_final_award_value,
    nullif(btrim(coalesce(p_po_number, '')), ''),
    p_po_date,
    nullif(btrim(coalesce(p_contract_number, '')), ''),
    p_contract_start_date,
    p_contract_end_date,
    nullif(btrim(coalesce(p_client_department, '')), ''),
    p_project_manager_id,
    coalesce(p_pbg_applicable, false),
    p_pbg_amount,
    p_pbg_expiry_date,
    case when coalesce(p_pbg_applicable, false) then 'pending' else null end,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_user_id,
    p_user_id
  )
  returning id into v_new_id;

  update public.agenttender_tenders
    set qualification_status = 'WON',
        updated_at = now()
  where id = p_tender_id;

  update public.agenttender_qualification_results
    set status = 'WON',
        decision_label = 'Won',
        required_action = 'Execute project',
        updated_at = now()
  where tender_id = p_tender_id;

  won_project_id := v_new_id;
  project_code := v_code;
  already_existed := false;
  return next;
end;
$$;

revoke all on function public.agenttender_mark_tender_won(
  uuid, uuid, uuid, date, numeric, text, date, text, date, date, text, uuid,
  boolean, numeric, date, text
) from public, anon, authenticated;
grant execute on function public.agenttender_mark_tender_won(
  uuid, uuid, uuid, date, numeric, text, date, text, date, date, text, uuid,
  boolean, numeric, date, text
) to service_role;

alter table public.agenttender_won_projects enable row level security;
alter table public.agenttender_won_project_milestones enable row level security;
alter table public.agenttender_won_project_payments enable row level security;
alter table public.agenttender_won_project_payment_receipts enable row level security;
alter table public.agenttender_won_project_documents enable row level security;

revoke all on public.agenttender_won_projects from anon, authenticated;
revoke all on public.agenttender_won_project_milestones from anon, authenticated;
revoke all on public.agenttender_won_project_payments from anon, authenticated;
revoke all on public.agenttender_won_project_payment_receipts from anon, authenticated;
revoke all on public.agenttender_won_project_documents from anon, authenticated;

grant all on public.agenttender_won_projects to service_role;
grant all on public.agenttender_won_project_milestones to service_role;
grant all on public.agenttender_won_project_payments to service_role;
grant all on public.agenttender_won_project_payment_receipts to service_role;
grant all on public.agenttender_won_project_documents to service_role;

grant usage, select on sequence public.agenttender_won_project_code_seq to service_role;

commit;
