begin;

-- Reuse the existing saved-run recovery queue; document outcomes are not a
-- second tracking system. Historical rows remain MANIFEST/PENDING untouched.
alter table public.agenttender_tender247_recovery_work_items
  drop constraint if exists agenttender_tender247_recovery_work_items_work_type_check;
alter table public.agenttender_tender247_recovery_work_items
  add constraint agenttender_tender247_recovery_work_items_work_type_check
  check (work_type in ('MANIFEST', 'DOCUMENT'));

alter table public.agenttender_tender247_recovery_work_items
  drop constraint if exists agenttender_tender247_recovery_work_items_status_check;
alter table public.agenttender_tender247_recovery_work_items
  add constraint agenttender_tender247_recovery_work_items_status_check
  check (status in ('PENDING', 'COMPLETED', 'RECONCILED', 'SOURCE_EMPTY', 'SOURCE_INVALID', 'SOURCE_UNAVAILABLE', 'RETRY_PENDING', 'UPLOAD_FAILED', 'INTERNAL_FAILED'));

alter table public.agenttender_tender247_recovery_work_items
  add column if not exists external_document_id text,
  add column if not exists display_filename text,
  add column if not exists retry_eligible_at timestamptz,
  add column if not exists evidence jsonb,
  add column if not exists sharepoint_drive_item_id text,
  add column if not exists sharepoint_storage_url text;

create index if not exists agenttender_t247_recovery_document_outcome_idx
  on public.agenttender_tender247_recovery_work_items (run_id, work_type, status, retry_eligible_at);

create or replace function public.agenttender_record_tender247_document_recovery_outcome(
  p_run_id uuid, p_canonical_tender_id uuid, p_tender247_tender_id text,
  p_external_document_id text, p_display_filename text, p_status text,
  p_last_error text default null, p_retry_eligible_at timestamptz default null,
  p_evidence jsonb default null, p_sharepoint_drive_item_id text default null,
  p_sharepoint_storage_url text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.agenttender_tender247_recovery_work_items (
    run_id, canonical_tender_id, tender247_tender_id, work_key, work_type, status,
    external_document_id, display_filename, attempt_count, last_error, last_attempt_at,
    retry_eligible_at, evidence, sharepoint_drive_item_id, sharepoint_storage_url, completed_at
  ) values (
    p_run_id, p_canonical_tender_id, p_tender247_tender_id,
    'document:' || p_external_document_id, 'DOCUMENT', p_status,
    p_external_document_id, p_display_filename, 1, p_last_error, now(),
    p_retry_eligible_at, p_evidence, p_sharepoint_drive_item_id, p_sharepoint_storage_url,
    case when p_status in ('COMPLETED', 'RECONCILED') then now() else null end
  ) on conflict (run_id, work_key) do update set
    canonical_tender_id = excluded.canonical_tender_id, status = excluded.status,
    display_filename = excluded.display_filename,
    attempt_count = public.agenttender_tender247_recovery_work_items.attempt_count + 1,
    last_error = excluded.last_error, last_attempt_at = now(),
    retry_eligible_at = excluded.retry_eligible_at, evidence = excluded.evidence,
    sharepoint_drive_item_id = coalesce(excluded.sharepoint_drive_item_id, public.agenttender_tender247_recovery_work_items.sharepoint_drive_item_id),
    sharepoint_storage_url = coalesce(excluded.sharepoint_storage_url, public.agenttender_tender247_recovery_work_items.sharepoint_storage_url),
    completed_at = case when excluded.status in ('COMPLETED', 'RECONCILED') then now() else public.agenttender_tender247_recovery_work_items.completed_at end
  where public.agenttender_tender247_recovery_work_items.status not in ('COMPLETED', 'RECONCILED')
     or excluded.status in ('COMPLETED', 'RECONCILED');
end; $$;
revoke all on function public.agenttender_record_tender247_document_recovery_outcome(uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text) from public;
grant execute on function public.agenttender_record_tender247_document_recovery_outcome(uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text) to service_role;

commit;
