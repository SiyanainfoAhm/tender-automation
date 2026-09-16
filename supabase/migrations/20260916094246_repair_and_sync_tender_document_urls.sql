begin;

alter table public.agenttender_tenders
  add column if not exists documents_urls jsonb default '[]'::jsonb;

update public.agenttender_tenders
set documents_urls = '[]'::jsonb
where documents_urls is null
   or jsonb_typeof(documents_urls) <> 'array';

alter table public.agenttender_tenders
  alter column documents_urls set default '[]'::jsonb;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_documents_urls_array_check;
alter table public.agenttender_tenders
  add constraint agenttender_tenders_documents_urls_array_check
  check (jsonb_typeof(documents_urls) = 'array');

-- Remove URLs accidentally copied to unrelated tenders and normalize each
-- retained entry. A URL is retained only when its path contains that row's
-- source_tender_id.
update public.agenttender_tenders t
set documents_urls = coalesce(
  (
    select jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'url', e->>'url',
          'type',
            case
              when lower(e->>'url') like 'https://%.sharepoint.com/%'
                then 'sharepoint'
              else coalesce(nullif(e->>'type', ''), 'document')
            end,
          'document_type',
            case
              when lower(e->>'url') ~ '\.zip([?#].*)?$'
                then 'documents_zip'
              when lower(e->>'url') ~ '(ai[-_ ]*summary|summary[-_ ]*ai).*\.pdf([?#].*)?$'
                then 'ai_summary'
              else 'document'
            end,
          'updated_at', coalesce(e->>'updated_at', e->>'migrated_at')
        )
      )
      order by e->>'url'
    )
    from jsonb_array_elements(t.documents_urls) e
    where nullif(btrim(e->>'url'), '') is not null
      and nullif(btrim(t.source_tender_id), '') is not null
      and position(lower(t.source_tender_id) in lower(e->>'url')) > 0
  ),
  '[]'::jsonb
)
where jsonb_array_length(t.documents_urls) > 0;

-- Backfill the two canonical artifact columns from the repaired URL array.
update public.agenttender_tenders t
set
  documents_zip_url = coalesce(
    nullif(btrim(t.documents_zip_url), ''),
    (
      select e->>'url'
      from jsonb_array_elements(t.documents_urls) e
      where e->>'document_type' = 'documents_zip'
      limit 1
    )
  ),
  ai_summary_url = coalesce(
    nullif(btrim(t.ai_summary_url), ''),
    (
      select e->>'url'
      from jsonb_array_elements(t.documents_urls) e
      where e->>'document_type' = 'ai_summary'
      limit 1
    )
  ),
  document_archive_available =
    t.document_archive_available
    or exists (
      select 1
      from jsonb_array_elements(t.documents_urls) e
      where e->>'document_type' = 'documents_zip'
    ),
  ai_summary_available =
    t.ai_summary_available
    or exists (
      select 1
      from jsonb_array_elements(t.documents_urls) e
      where e->>'document_type' = 'ai_summary'
    )
where jsonb_array_length(t.documents_urls) > 0;

comment on column public.agenttender_tenders.documents_urls is
  'Array of unique document objects: url, type, document_type and updated_at. SharePoint is canonical for new uploads.';

commit;
