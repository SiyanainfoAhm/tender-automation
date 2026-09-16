begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenttender_tenders'
      and column_name = 'documents_urls'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenttender_tenders'
      and column_name = 'document_urls'
  ) then
    alter table public.agenttender_tenders
      rename column documents_urls to document_urls;
  end if;
end
$$;

alter table public.agenttender_tenders
  add column if not exists document_urls jsonb not null default '[]'::jsonb;

update public.agenttender_tenders
set document_urls = '[]'::jsonb
where document_urls is null
   or jsonb_typeof(document_urls) <> 'array';

alter table public.agenttender_tenders
  alter column document_urls set default '[]'::jsonb,
  alter column document_urls set not null;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_documents_urls_array_check;
alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_document_urls_array_check;
alter table public.agenttender_tenders
  add constraint agenttender_tenders_document_urls_array_check
  check (jsonb_typeof(document_urls) = 'array');

create or replace function public.agenttender_sync_tender_artifact_urls()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_urls jsonb := coalesce(new.document_urls, '[]'::jsonb);
  v_now text := coalesce(new.updated_at, now())::text;
begin
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  into v_urls
  from jsonb_array_elements(v_urls) entry
  where coalesce(entry->>'document_type', '') not in (
    'documents_zip',
    'ai_summary'
  );

  if nullif(btrim(new.documents_zip_url), '') is not null then
    v_urls := v_urls || jsonb_build_array(
      jsonb_build_object(
        'url', btrim(new.documents_zip_url),
        'type', case
          when lower(new.documents_zip_url) like 'https://%.sharepoint.com/%'
            then 'sharepoint'
          else 'document'
        end,
        'document_type', 'documents_zip',
        'updated_at', v_now
      )
    );
  end if;

  if nullif(btrim(new.ai_summary_url), '') is not null then
    v_urls := v_urls || jsonb_build_array(
      jsonb_build_object(
        'url', btrim(new.ai_summary_url),
        'type', case
          when lower(new.ai_summary_url) like 'https://%.sharepoint.com/%'
            then 'sharepoint'
          else 'document'
        end,
        'document_type', 'ai_summary',
        'updated_at', v_now
      )
    );
  end if;

  new.document_urls := v_urls;
  return new;
end
$$;

drop trigger if exists agenttender_sync_tender_artifact_urls
  on public.agenttender_tenders;
create trigger agenttender_sync_tender_artifact_urls
before insert or update of documents_zip_url, ai_summary_url, document_urls
on public.agenttender_tenders
for each row
execute function public.agenttender_sync_tender_artifact_urls();

-- Populate the array for existing canonical URL values.
update public.agenttender_tenders
set
  documents_zip_url = documents_zip_url,
  ai_summary_url = ai_summary_url;

comment on column public.agenttender_tenders.document_urls is
  'Array of unique document objects: url, type, document_type and updated_at. SharePoint is canonical for new uploads.';

commit;
