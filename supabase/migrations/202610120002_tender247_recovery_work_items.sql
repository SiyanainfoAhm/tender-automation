begin;

-- A pipeline-run summary is an audit record, not a queue.  Keep manifest
-- failures as first-class work even when the tender currently has no
-- incomplete canonical document row.
create table if not exists public.agenttender_tender247_recovery_work_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agenttender_pipeline_runs(id) on delete cascade,
  canonical_tender_id uuid references public.agenttender_tenders(id) on delete set null,
  tender247_tender_id text not null,
  work_key text not null,
  work_type text not null check (work_type in ('MANIFEST')),
  status text not null check (status in ('PENDING', 'COMPLETED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, work_key)
);

create index if not exists agenttender_t247_recovery_work_pending_idx
  on public.agenttender_tender247_recovery_work_items (run_id, status, last_attempt_at);

drop trigger if exists agenttender_t247_recovery_work_updated_at
  on public.agenttender_tender247_recovery_work_items;
create trigger agenttender_t247_recovery_work_updated_at
before update on public.agenttender_tender247_recovery_work_items
for each row execute function public.agenttender_set_updated_at();

alter table public.agenttender_tender247_recovery_work_items enable row level security;
revoke all on public.agenttender_tender247_recovery_work_items from anon, authenticated;
grant all on public.agenttender_tender247_recovery_work_items to service_role;

-- Atomic attempt accounting prevents concurrent recovery invocations from
-- erasing one another's failure history.
create or replace function public.agenttender_record_tender247_manifest_recovery_work(
  p_run_id uuid,
  p_canonical_tender_id uuid,
  p_tender247_tender_id text,
  p_status text,
  p_last_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agenttender_tender247_recovery_work_items (
    run_id, canonical_tender_id, tender247_tender_id, work_key, work_type,
    status, attempt_count, last_error, last_attempt_at, completed_at
  ) values (
    p_run_id, p_canonical_tender_id, p_tender247_tender_id,
    'manifest:' || p_tender247_tender_id, 'MANIFEST', p_status, 1,
    p_last_error, now(), case when p_status = 'COMPLETED' then now() else null end
  ) on conflict (run_id, work_key) do update set
    canonical_tender_id = excluded.canonical_tender_id,
    status = excluded.status,
    attempt_count = public.agenttender_tender247_recovery_work_items.attempt_count + 1,
    last_error = excluded.last_error,
    last_attempt_at = now(),
    completed_at = case when excluded.status = 'COMPLETED' then now() else null end;
end;
$$;

revoke all on function public.agenttender_record_tender247_manifest_recovery_work(uuid, uuid, text, text, text) from public;
grant execute on function public.agenttender_record_tender247_manifest_recovery_work(uuid, uuid, text, text, text) to service_role;

commit;
