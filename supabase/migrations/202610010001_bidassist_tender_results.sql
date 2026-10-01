begin;

-- BidAssist result data is deliberately separate from tender metadata: a source
-- result must never overwrite the team's qualification decision.
create table if not exists public.agenttender_tender_results (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null unique references public.agenttender_tenders(id) on delete cascade,
  source text not null default 'BIDASSIST',
  source_url text,
  result_stage text,
  contract_date date,
  contract_amount numeric(20,2),
  contract_amount_display text,
  currency text,
  number_of_bids integer,
  awarded_bidder_name text,
  scrape_status text not null default 'NOT_FOUND',
  scrape_reason text,
  result_checked_at timestamptz not null default now(),
  result_last_updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.agenttender_tender_bidders (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
  normalized_bidder_name text not null,
  bidder_name text not null, bidder_address text,
  bid_value numeric(20,2), bid_value_display text,
  award_amount numeric(20,2), award_amount_display text, currency text,
  rank text, status text, is_awarded boolean not null default false,
  source text not null default 'BIDASSIST', source_url text, raw_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tender_id, normalized_bidder_name)
);
create table if not exists public.agenttender_tender_aoc_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
  external_document_key text not null, document_name text not null, file_name text,
  description text, document_type text, mime_type text, source_url text, storage_url text,
  download_status text not null default 'METADATA_ONLY', source text not null default 'BIDASSIST',
  raw_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tender_id, external_document_key)
);
create index if not exists agenttender_tender_bidders_tender_idx on public.agenttender_tender_bidders(tender_id);
create index if not exists agenttender_tender_bidders_name_idx on public.agenttender_tender_bidders(normalized_bidder_name);
create index if not exists agenttender_tender_bidders_status_idx on public.agenttender_tender_bidders(status);
create index if not exists agenttender_tender_aoc_documents_tender_idx on public.agenttender_tender_aoc_documents(tender_id);
do $$ declare item text; begin foreach item in array array['agenttender_tender_results','agenttender_tender_bidders','agenttender_tender_aoc_documents'] loop
  execute format('drop trigger if exists %I_updated_at on public.%I', item, item);
  execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.agenttender_set_updated_at()', item, item);
  execute format('alter table public.%I enable row level security', item);
  execute format('revoke all on public.%I from anon, authenticated', item);
  execute format('grant all on public.%I to service_role', item);
end loop; end $$;
commit;
