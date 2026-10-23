begin;

-- Preserve object metadata where it exists, while deduplicating the semantic
-- URL identity across legacy string and object entries.
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
    with transformed as (
      select ord,
        case
          when v_old is not null and jsonb_typeof(value) = 'string' and lower(trim(both '"' from value::text)) = lower(v_old) then to_jsonb(v_new)
          when v_old is not null and jsonb_typeof(value) = 'object' and lower(value->>'url') = lower(v_old)
            then jsonb_set(value, '{url}', to_jsonb(v_new))
          else value
        end as value
      from jsonb_array_elements(coalesce(t.document_urls, '[]'::jsonb)) with ordinality as x(value, ord)
      union all select 2147483647::bigint, to_jsonb(v_new)
    ), keyed as (
      select ord, value,
        coalesce(nullif(case when jsonb_typeof(value) = 'string' then trim(both '"' from value::text) when jsonb_typeof(value) = 'object' then nullif(btrim(value->>'url'), '') end, ''), '__raw__' || ord::text) as key,
        case when jsonb_typeof(value) = 'object' and nullif(btrim(value->>'url'), '') is not null then 0 else 1 end as preference
      from transformed
    ), deduped as (
      select distinct on (key) value, ord
      from keyed
      order by key, preference, ord
    )
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb) from deduped
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
