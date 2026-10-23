begin;

-- Enforce the API contract at the canonical write boundary as well as in the
-- application mapper. This covers future lower-case Tender247 payloads until
-- every deployed sync worker is on the corrected mapper.
create or replace function public.agenttender_normalize_tender247_api_sync()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  j jsonb := new.raw_metadata->'tender247_sync';
  loc jsonb := j->'location'->0;
begin
  if new.source_portal <> 'TENDER247' or new.tender247_api_sync is not true or jsonb_typeof(j) <> 'object' then
    return new;
  end if;
  new.title := coalesce(nullif(btrim(j->>'title'), ''), nullif(btrim(j->>'name'), ''), nullif(btrim(j->>'tenderTitle'), ''), nullif(btrim(j->>'tendername'), ''), nullif(btrim(j->>'tenderdescription'), ''), nullif(btrim(j->>'tenderdetails'), ''), nullif(btrim(new.title), ''), case when tg_op = 'UPDATE' then old.title end, '');
  new.organization := coalesce(nullif(btrim(j->>'organization'), ''), nullif(btrim(j->>'organisation'), ''), nullif(btrim(j->>'buyer'), ''), nullif(btrim(j->>'authority'), ''), new.organization, case when tg_op = 'UPDATE' then old.organization end);
  new.department := coalesce(nullif(btrim(j->>'department'), ''), nullif(btrim(j->>'departmentName'), ''), new.department, case when tg_op = 'UPDATE' then old.department end);
  new.authority := coalesce(nullif(btrim(j->>'authority'), ''), new.authority, case when tg_op = 'UPDATE' then old.authority end);
  new.description := coalesce(nullif(btrim(j->>'description'), ''), nullif(btrim(j->>'tenderdescription'), ''), nullif(btrim(j->>'tenderdetails'), ''), new.description, case when tg_op = 'UPDATE' then old.description end);
  new.city := coalesce(nullif(btrim(j->>'city'), ''), nullif(btrim(loc->>'city'), ''), new.city, case when tg_op = 'UPDATE' then old.city end);
  new.state := coalesce(nullif(btrim(j->>'state'), ''), nullif(btrim(loc->>'state'), ''), new.state, case when tg_op = 'UPDATE' then old.state end);
  new.location_text := coalesce(nullif(btrim(case when jsonb_typeof(j->'location') = 'string' then j->>'location' end), ''), nullif(concat_ws(', ', nullif(btrim(loc->>'city'), ''), nullif(btrim(loc->>'state'), ''), nullif(btrim(loc->>'country'), '')), ''), new.location_text, case when tg_op = 'UPDATE' then old.location_text end);
  new.tender_value := coalesce(case when coalesce(j->>'tenderValue', j->>'estimatedValue', j->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(j->>'tenderValue', j->>'estimatedValue', j->>'value')::numeric end, new.tender_value, case when tg_op = 'UPDATE' then old.tender_value end);
  new.emd_amount := coalesce(case when coalesce(j->>'emdAmount', j->>'emd') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(j->>'emdAmount', j->>'emd')::numeric end, new.emd_amount, case when tg_op = 'UPDATE' then old.emd_amount end);
  new.currency := coalesce(nullif(btrim(j->>'currency'), ''), new.currency, case when tg_op = 'UPDATE' then old.currency end, 'INR');
  new.source_url := coalesce(nullif(btrim(j->>'sourceUrl'), ''), nullif(btrim(j->>'sourceurl'), ''), new.source_url, case when tg_op = 'UPDATE' then old.source_url end);
  new.published_date := coalesce(case when coalesce(j->>'publishedDate', j->>'publishDate', j->>'datecreated') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(j->>'publishedDate', j->>'publishDate', j->>'datecreated'), 10)::date end, new.published_date, case when tg_op = 'UPDATE' then old.published_date end);
  new.bid_submission_date := coalesce(case when coalesce(j->>'bidSubmissionDate', j->>'biddeadline') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(j->>'bidSubmissionDate', j->>'biddeadline'), 10)::date end, new.bid_submission_date, case when tg_op = 'UPDATE' then old.bid_submission_date end);
  new.closing_date := coalesce(case when coalesce(j->>'closingDate', j->>'bidSubmissionDate', j->>'biddeadline') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(j->>'closingDate', j->>'bidSubmissionDate', j->>'biddeadline'), 10)::date end, new.closing_date, case when tg_op = 'UPDATE' then old.closing_date end);
  new.qualification_status := coalesce(new.qualification_status, case when tg_op = 'UPDATE' then old.qualification_status end, 'VERIFY');
  return new;
end;
$$;

drop trigger if exists agenttender_normalize_tender247_api_sync_trigger on public.agenttender_tenders;
create trigger agenttender_normalize_tender247_api_sync_trigger
before insert or update on public.agenttender_tenders
for each row execute function public.agenttender_normalize_tender247_api_sync();

commit;
