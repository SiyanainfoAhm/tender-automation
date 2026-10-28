-- Signed tender-document items (requirement_key SIGNED_TENDER_DOC_*) hold the actual RFP / GeM
-- bid PDF signed on every page. They must never be reclassified as AI drafts or regenerated.
create or replace function public.agenttender_guard_manual_only_requirement()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.requirement_key, '') like 'SIGNED_TENDER_DOC_%' then
    new.processing_type := 'MANUAL_ENTRY';
    new.generation_allowed := false;
    new.requirement_origin := 'RULE';
    new.requirement_kind := 'MANUAL_ACTION';
    return new;
  end if;

  if not public.agenttender_is_manual_only_requirement(new.requirement_name) then
    return new;
  end if;

  new.processing_type := 'MANUAL_ENTRY';
  new.generation_allowed := false;

  if coalesce(new.matched_by, '') in ('AI', 'SYSTEM')
     and (
       tg_op = 'INSERT'
       or new.matched_workspace_document_id is distinct from old.matched_workspace_document_id
       or new.matched_company_document_id is distinct from old.matched_company_document_id
       or new.matched_by is distinct from old.matched_by
     ) then
    new.matched_by := null;
    new.matched_document_source := null;
    new.matched_company_document_id := null;
    new.matched_workspace_document_id := null;
    new.match_confidence := null;
    new.match_reason := 'Manual section: attach the payment proof / BOQ yourself.';
    if new.manual_completed is not true then
      new.completion_status := 'ACTION_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;
