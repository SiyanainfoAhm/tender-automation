begin;

-- Reconcile only the unambiguous half of a Tender247 stable/legacy duplicate.
-- A row with workflow columns or any inbound tender reference is meaningful.
-- If both rows are meaningful, the function returns MANUAL_REQUIRED and makes
-- no changes. This keeps all referential work inside one transaction.
create or replace function public.reconcile_tender247_identity_conflict(
  p_legacy_id uuid,
  p_stable_id uuid,
  p_stable_source_tender_id text
)
returns table(status text, survivor_id uuid, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  legacy public.agenttender_tenders%rowtype;
  stable public.agenttender_tenders%rowtype;
  legacy_meaningful boolean := false;
  stable_meaningful boolean := false;
  fk record;
  has_reference boolean;
  survivor uuid;
  loser uuid;
begin
  select * into legacy from public.agenttender_tenders where id = p_legacy_id for update;
  select * into stable from public.agenttender_tenders where id = p_stable_id for update;
  if not found or legacy.id is null or stable.id is null then
    return query select 'MANUAL_REQUIRED'::text, null::uuid, 'Canonical rows no longer exist'; return;
  end if;
  if legacy.source_portal <> 'TENDER247' or stable.source_portal <> 'TENDER247'
     or stable.source_tender_id <> p_stable_source_tender_id then
    return query select 'MANUAL_REQUIRED'::text, null::uuid, 'Rows no longer match the expected Tender247 identities'; return;
  end if;

  legacy_meaningful := legacy.qualification_status is not null
    or legacy.prescreen_status is not null or legacy.decision_source is not null
    or legacy.raw_metadata ? 'notes';
  stable_meaningful := stable.qualification_status is not null
    or stable.prescreen_status is not null or stable.decision_source is not null
    or stable.raw_metadata ? 'notes';

  -- Treat every single-column FK into the tender master as meaningful. This
  -- includes documents, workspaces, checklists, results, and mirror rows.
  for fk in
    select conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.agenttender_tenders'::regclass
      and array_length(c.conkey, 1) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', fk.table_name, fk.column_name)
      into has_reference using legacy.id;
    legacy_meaningful := legacy_meaningful or has_reference;
    execute format('select exists (select 1 from %s where %I = $1)', fk.table_name, fk.column_name)
      into has_reference using stable.id;
    stable_meaningful := stable_meaningful or has_reference;
  end loop;

  if legacy_meaningful and stable_meaningful then
    return query select 'MANUAL_REQUIRED'::text, null::uuid, 'Both duplicate rows contain workflow or dependent data'; return;
  end if;

  -- Preserve the row with meaningful business state; otherwise preserve the
  -- already-canonical stable-id row. The other row is API-only by construction.
  survivor := case when legacy_meaningful then legacy.id else stable.id end;
  loser := case when survivor = legacy.id then stable.id else legacy.id end;

  -- The chosen stable row has no dependencies when it loses. If the legacy row
  -- loses, all of its references are moved before deletion.
  if loser = legacy.id then
    for fk in
      select conrelid::regclass as table_name, a.attname as column_name
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'public.agenttender_tenders'::regclass
        and array_length(c.conkey, 1) = 1
    loop
      execute format('update %s set %I = $1 where %I = $2', fk.table_name, fk.column_name, fk.column_name)
        using survivor, loser;
    end loop;
  end if;

  delete from public.agenttender_tenders where id = loser;
  if survivor = legacy.id then
    update public.agenttender_tenders set source_tender_id = p_stable_source_tender_id where id = survivor;
  end if;
  return query select 'RECONCILED'::text, survivor, 'Merged API-only duplicate into workflow-preserving canonical row';
end;
$$;

revoke all on function public.reconcile_tender247_identity_conflict(uuid, uuid, text) from public;
grant execute on function public.reconcile_tender247_identity_conflict(uuid, uuid, text) to service_role;

commit;
