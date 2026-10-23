begin;

-- Serialize JSONB URL changes in PostgreSQL so concurrently-finalized Tender247
-- documents cannot lose a sibling URL through application read/modify/write.
create or replace function public.append_tender_document_url(
  p_tender_id uuid,
  p_document_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(btrim(p_document_url), '');
  v_urls jsonb;
begin
  if v_url is null then
    select document_urls into v_urls from public.agenttender_tenders where id = p_tender_id for update;
    return coalesce(v_urls, '[]'::jsonb);
  end if;

  update public.agenttender_tenders t
  set document_urls = (
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from (
      select distinct value
      from jsonb_array_elements(coalesce(t.document_urls, '[]'::jsonb)) value
      union
      select to_jsonb(v_url)
    ) urls
  )
  where t.id = p_tender_id
  returning document_urls into v_urls;

  if not found then raise exception 'Tender % not found', p_tender_id using errcode = 'P0002'; end if;
  return v_urls;
end;
$$;

revoke all on function public.append_tender_document_url(uuid, text) from public;
grant execute on function public.append_tender_document_url(uuid, text) to service_role;

-- Safe, non-network backfill: only existing canonical TENDER247 files with a
-- permanent URL are merged. Ambiguous/missing tender references are skipped.
do $$
declare r record;
begin
  for r in
    select d.tender_id, d.storage_url
    from public.agenttender_tender_documents d
    join public.agenttender_tenders t on t.id = d.tender_id
    where d.external_source = 'TENDER247'
      and nullif(btrim(d.storage_url), '') is not null
  loop
    perform public.append_tender_document_url(r.tender_id, r.storage_url);
  end loop;
end;
$$;
commit;
