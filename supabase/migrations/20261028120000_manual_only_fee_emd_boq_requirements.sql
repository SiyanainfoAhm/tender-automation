-- Tender fee / processing fee / EMD and BOQ / financial-bid checklist items are always manual.
-- No worker or rematch may attach a document to them automatically; only a person can
-- (matched_by = 'USER'). Owner request 2026-10-28.

create or replace function public.agenttender_is_manual_only_requirement(p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name, '') ~* (
      '(\m(tender|bid|bidding|document|processing|application|e-?tender|portal)\s*(fee|fees|cost)\M'
      || '|\memd\M|earnest\s+money|bid\s+secur|security\s+deposit'
      || '|performance\s+(security|guarantee|bank\s+guarantee)'
      || '|\mboq\M|bill\s+of\s+quantit|schedule\s+of\s+(rates|quantit)'
      || '|price\s*(bid|schedule|break\s*-?\s*up|quote|quotation|format|offer|proposal)'
      || '|(financial|commercial)\s*(bid|proposal|offer|quote|quotation|format|cover|envelope)'
      || '|rate\s+(quote|quotation|schedule|contract))'
    )
    and coalesce(p_name, '') !~* '(exemption|turnover|capacity|solvency|net\s*worth|undertaking|declaration|affidavit)';
$$;

create or replace function public.agenttender_guard_manual_only_requirement()
returns trigger
language plpgsql
as $$
begin
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

drop trigger if exists agenttender_guard_manual_only_requirement on public.agenttender_bid_checklist_items;
create trigger agenttender_guard_manual_only_requirement
  before insert or update on public.agenttender_bid_checklist_items
  for each row execute function public.agenttender_guard_manual_only_requirement();
