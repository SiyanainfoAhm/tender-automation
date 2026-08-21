begin;

-- =========================================================
-- Bid fees + tender-scoped documents (shared source of truth)
-- =========================================================

create table if not exists public.agenttender_bid_fees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,

  fee_type text not null
    check (
      fee_type in (
        'tender_fee',
        'emd',
        'processing',
        'pbg',
        'other'
      )
    ),

  amount numeric(20, 2) not null default 0
    check (amount >= 0),
  currency text not null default 'INR',

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'submitted',
        'paid',
        'refunded',
        'released',
        'expired'
      )
    ),

  payment_mode text
    check (
      payment_mode is null
      or payment_mode in (
        'neft_rtgs',
        'netbanking_upi',
        'dd',
        'fdr',
        'bank_guarantee',
        'cash_other'
      )
    ),

  payment_date date,
  due_date date,
  refundable boolean not null default false,
  notes text,

  -- Mode-specific reference payload (UTR, DD no, BG fields, etc.)
  payment_reference jsonb not null default '{}'::jsonb,

  -- PBG-specific convenience columns (also mirrored in payment_reference)
  bg_number text,
  bank_name text,
  issue_date date,
  expiry_date date,
  claim_period_days integer,
  urn text,
  pbg_status text
    check (
      pbg_status is null
      or pbg_status in ('active', 'released', 'expired')
    ),

  created_by uuid references public.agenttender_users(id) on delete set null,
  updated_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenttender_bid_fees_company_idx
  on public.agenttender_bid_fees (company_id);

create index if not exists agenttender_bid_fees_tender_idx
  on public.agenttender_bid_fees (tender_id);

create index if not exists agenttender_bid_fees_type_idx
  on public.agenttender_bid_fees (company_id, fee_type);

create index if not exists agenttender_bid_fees_status_idx
  on public.agenttender_bid_fees (company_id, status);

drop trigger if exists agenttender_bid_fees_updated_at
  on public.agenttender_bid_fees;
create trigger agenttender_bid_fees_updated_at
before update on public.agenttender_bid_fees
for each row
execute function public.agenttender_set_updated_at();

-- Unified tender document rows (one attachment, many views)
create table if not exists public.agenttender_tender_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agenttender_companies(id)
    on delete cascade,
  tender_id uuid not null
    references public.agenttender_tenders(id)
    on delete cascade,

  section text not null
    check (
      section in (
        'tender',
        'bidding',
        'financial',
        'deliverable'
      )
    ),

  entity_type text
    check (
      entity_type is null
      or entity_type in ('fee', 'pbg', 'archive', 'manual', 'workspace')
    ),
  entity_id uuid,

  fee_id uuid
    references public.agenttender_bid_fees(id)
    on delete set null,

  -- Prefer linking company library storage when uploaded via Edge
  company_document_id uuid
    references public.agenttender_company_documents(id)
    on delete set null,

  file_name text not null,
  original_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_provider text not null default 'azure'
    check (storage_provider in ('none', 'azure', 'local')),
  storage_url text,

  created_by uuid references public.agenttender_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenttender_tender_documents_name_not_blank
    check (length(trim(file_name)) > 0)
);

create index if not exists agenttender_tender_documents_tender_idx
  on public.agenttender_tender_documents (tender_id, section);

create index if not exists agenttender_tender_documents_fee_idx
  on public.agenttender_tender_documents (fee_id)
  where fee_id is not null;

create index if not exists agenttender_tender_documents_company_idx
  on public.agenttender_tender_documents (company_id);

drop trigger if exists agenttender_tender_documents_updated_at
  on public.agenttender_tender_documents;
create trigger agenttender_tender_documents_updated_at
before update on public.agenttender_tender_documents
for each row
execute function public.agenttender_set_updated_at();

-- Expand qualification statuses for lifecycle UI (Lost / Disqualified / Submitted)
alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_qualification_status_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_qualification_status_check
  check (
    qualification_status is null
    or qualification_status in (
      'GO',
      'CONDITIONAL_GO',
      'PARTNER_BID',
      'VERIFY',
      'NO_GO',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'SUBMITTED'
    )
  );

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'agenttender_qualification_results'
  ) then
    alter table public.agenttender_qualification_results
      drop constraint if exists agenttender_qualification_results_status_check;
    alter table public.agenttender_qualification_results
      add constraint agenttender_qualification_results_status_check
      check (
        status in (
          'GO',
          'CONDITIONAL_GO',
          'PARTNER_BID',
          'VERIFY',
          'NO_GO',
          'WON',
          'LOST',
          'DISQUALIFIED',
          'SUBMITTED'
        )
      );
  end if;
end $$;

alter table public.agenttender_bid_fees enable row level security;
alter table public.agenttender_tender_documents enable row level security;

revoke all on public.agenttender_bid_fees from anon, authenticated;
revoke all on public.agenttender_tender_documents from anon, authenticated;

grant all on public.agenttender_bid_fees to service_role;
grant all on public.agenttender_tender_documents to service_role;

commit;
