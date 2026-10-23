-- READ ONLY: inventory Tender247 documents stored under the accidental date.
-- Do not add UPDATE, DELETE, or Graph move actions to this file.
select
  d.id as canonical_document_id,
  d.tender_id as canonical_tender_id,
  d.external_document_id,
  d.file_name,
  d.storage_url as current_storage_url,
  d.sharepoint_drive_item_id,
  replace(d.storage_url, '/tender247/2026-10-09/', '/tender247/2026-10-08/') as expected_target_url_hint,
  -- The Tender247 mirror is a different Supabase project, so mirror presence
  -- cannot be joined here. Use the separate mirror-project query below.
  null::boolean as mirror_present_in_separate_project,
  exists (
    select 1 from jsonb_array_elements(coalesce(t.document_urls, '[]'::jsonb)) u
    where u = to_jsonb(d.storage_url) or u->>'url' = d.storage_url
  ) as tender_document_urls_contains_old_url
from public.agenttender_tender_documents d
join public.agenttender_tenders t on t.id = d.tender_id
where d.external_source = 'TENDER247'
  and t.scraped_date = date '2026-10-08'
  and d.storage_url like '%/tender247/2026-10-09/%'
order by d.tender_id, d.external_document_id;

-- Run this second SELECT only while connected to the Tender247 MIRROR project.
-- Replace the canonical IDs with the output of the canonical-project query.
-- select canonical_document_id, canonical_tender_id, external_document_id,
--        storage_url, sharepoint_drive_item_id
-- from public.tender247_documents
-- where canonical_document_id = any(array['<canonical-document-uuid>']::uuid[]);
