CREATE OR REPLACE FUNCTION public.agenttender_company_ocr_commit(p_document_id uuid, p_pages jsonb, p_engine text DEFAULT 'rapidocr'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  x public.agenttender_company_document_texts;
  pg jsonb; part text; rest text; idx int := 0; n_pages int := 0; n_empty int := 0; full_text text := '';
  cut int;
begin
  select * into x from public.agenttender_company_document_texts where document_id = p_document_id for update;
  if not found then raise exception 'No text row for %', p_document_id; end if;

  perform 1 from public.agenttender_company_documents d where d.id=p_document_id and d.company_id=x.company_id and d.status='active' and d.ai_index_enabled is not false and public.agenttender_company_source_fingerprint(d)=x.source_fingerprint for share;
  if not found then raise exception 'Document source changed or ineligible'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(p_pages,'[]'::jsonb)) p where length(trim(coalesce(p->>'text','')))>20) then raise exception 'OCR returned no readable pages'; end if;
  update public.agenttender_company_document_text_chunks set is_active = false, updated_at = now() where document_id = p_document_id and is_active;

  for pg in select value from jsonb_array_elements(coalesce(p_pages,'[]'::jsonb)) order by (value->>'member'), (value->>'page')::int loop
    n_pages := n_pages + 1;
    rest := trim(replace(coalesce(pg->>'text',''), chr(65533), ''));
    if length(regexp_replace(rest, '\s', '', 'g')) <= 20 then n_empty := n_empty + 1; continue; end if;
    full_text := full_text || E'\n\n--- PAGE ' || (pg->>'page') || E' ---\n' || rest;
    while length(rest) > 0 loop
      if length(rest) <= 3000 then part := rest; rest := '';
      else
        cut := 3000 - strpos(reverse(left(rest, 3000)), E'\n');
        if cut < 1500 then cut := 3000 - strpos(reverse(left(rest, 3000)), ' '); end if;
        if cut < 1500 then cut := 3000; end if;
        part := left(rest, cut); rest := trim(substr(rest, cut + 1));
      end if;
      insert into public.agenttender_company_document_text_chunks
        (document_id, company_id, source_fingerprint, member_name, chunk_index, content, content_hash,
         page_number, page_start, page_end, section, metadata, is_active)
      values (p_document_id, x.company_id, x.source_fingerprint, coalesce(pg->>'member',''), idx, part, md5(part),
              (pg->>'page')::int, (pg->>'page')::int, (pg->>'page')::int, 'other',
              jsonb_build_object('parser','ocr-' || p_engine, 'ocr', (pg->>'native')::boolean is not true), true)
      on conflict(document_id,source_fingerprint,member_name,chunk_index) do update set content=excluded.content,content_hash=excluded.content_hash,page_number=excluded.page_number,page_start=excluded.page_start,page_end=excluded.page_end,metadata=excluded.metadata,is_active=true,updated_at=now();
      idx := idx + 1;
    end loop;
  end loop;

  update public.agenttender_company_document_texts
     set extracted_text = trim(full_text),
         extraction_status = case when idx = 0 then 'OCR_REQUIRED' when n_empty > 0 then 'PARTIAL' else 'READY' end,
         chunk_count = idx,
         content_hash = md5(trim(full_text)),
         extraction_metadata = coalesce(extraction_metadata,'{}'::jsonb) || jsonb_build_object(
            'ocr', p_engine, 'ocr_at', now(), 'ocr_pages', n_pages, 'ocr_empty_pages', n_empty),
         last_error = case when idx = 0 then 'OCR found no readable text' when n_empty>0 then 'OCR incomplete: '||n_empty||' pages contain no readable text' else null end,
         extracted_at = now(), updated_at = now()
   where document_id = p_document_id;
  return jsonb_build_object('chunks', idx, 'pages', n_pages, 'empty_pages', n_empty);
end $function$
