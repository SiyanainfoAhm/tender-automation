begin;

-- Atomically replace one permanent document URL without reconstructing a
-- tender's JSON array from application-side state.  Preserve both legacy
-- string entries and object entries, and deduplicate the resulting values.
create or replace function public.replace_tender_document_url(
  p_tender_id uuid,
  p_old_document_url text,
  p_new_document_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := nullif(btrim(p_old_document_url), '');
  v_new text := nullif(btrim(p_new_document_url), '');
  v_urls jsonb;
begin
  if v_new is null then raise exception 'New document URL is required' using errcode = '22023'; end if;

  update public.agenttender_tenders t
  set document_urls = (
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from (
      select distinct case
        when v_old is not null and value = to_jsonb(v_old) then to_jsonb(v_new)
        when v_old is not null and jsonb_typeof(value) = 'object' and value->>'url' = v_old
          then jsonb_set(value, '{url}', to_jsonb(v_new))
        else value
      end as value
      from jsonb_array_elements(coalesce(t.document_urls, '[]'::jsonb)) value
      union
      select to_jsonb(v_new)
    ) urls
  )
  where t.id = p_tender_id
  returning document_urls into v_urls;

  if not found then raise exception 'Tender % not found', p_tender_id using errcode = 'P0002'; end if;
  return v_urls;
end;
$$;

revoke all on function public.replace_tender_document_url(uuid, text, text) from public;
grant execute on function public.replace_tender_document_url(uuid, text, text) to service_role;

commit;
