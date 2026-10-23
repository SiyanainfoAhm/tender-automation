begin;

-- The first API-sync mapper expected camelCase fields. Production Tender247
-- payloads also use lower-case names such as value, emd, biddeadline,
-- tenderdescription and an object-array location. Repair only rows explicitly
-- owned by that integration; retain a non-null canonical value when upstream
-- did not supply that field.
with source as (
  select id, raw_metadata->'tender247_sync' as j
  from public.agenttender_tenders
  where tender247_api_sync is true
    and jsonb_typeof(raw_metadata->'tender247_sync') = 'object'
)
update public.agenttender_tenders t
set
  title = coalesce(nullif(btrim(s.j->>'title'), ''), nullif(btrim(s.j->>'name'), ''), nullif(btrim(s.j->>'tenderTitle'), ''), nullif(btrim(s.j->>'tendername'), ''), nullif(btrim(s.j->>'tenderdescription'), ''), nullif(btrim(s.j->>'tenderdetails'), ''), t.title),
  organization = coalesce(nullif(btrim(s.j->>'organization'), ''), nullif(btrim(s.j->>'organisation'), ''), nullif(btrim(s.j->>'buyer'), ''), nullif(btrim(s.j->>'authority'), ''), t.organization),
  department = coalesce(nullif(btrim(s.j->>'department'), ''), nullif(btrim(s.j->>'departmentName'), ''), t.department),
  authority = coalesce(nullif(btrim(s.j->>'authority'), ''), t.authority),
  category = coalesce(nullif(btrim(s.j->>'category'), ''), t.category),
  tender_type = coalesce(nullif(btrim(s.j->>'tenderType'), ''), nullif(btrim(s.j->>'tendertype'), ''), nullif(btrim(s.j->>'type'), ''), t.tender_type),
  description = coalesce(nullif(btrim(s.j->>'description'), ''), nullif(btrim(s.j->>'tenderdescription'), ''), nullif(btrim(s.j->>'tenderdetails'), ''), t.description),
  city = coalesce(nullif(btrim(s.j->>'city'), ''), nullif(btrim(s.j->'location'->0->>'city'), ''), t.city),
  state = coalesce(nullif(btrim(s.j->>'state'), ''), nullif(btrim(s.j->'location'->0->>'state'), ''), t.state),
  location_text = coalesce(nullif(btrim(case when jsonb_typeof(s.j->'location') = 'string' then s.j->>'location' end), ''), nullif(concat_ws(', ', nullif(btrim(s.j->'location'->0->>'city'), ''), nullif(btrim(s.j->'location'->0->>'state'), ''), nullif(btrim(s.j->'location'->0->>'country'), '')), ''), t.location_text),
  published_date = coalesce(nullif(left(s.j->>'publishedDate', 10), '')::date, nullif(left(s.j->>'publishDate', 10), '')::date, nullif(left(s.j->>'datecreated', 10), '')::date, t.published_date),
  closing_date = coalesce(nullif(left(s.j->>'closingDate', 10), '')::date, nullif(left(s.j->>'bidSubmissionDate', 10), '')::date, nullif(left(s.j->>'biddeadline', 10), '')::date, t.closing_date),
  bid_submission_date = coalesce(nullif(left(s.j->>'bidSubmissionDate', 10), '')::date, nullif(left(s.j->>'biddeadline', 10), '')::date, t.bid_submission_date),
  tender_value = coalesce(case when coalesce(s.j->>'tenderValue', s.j->>'estimatedValue', s.j->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(s.j->>'tenderValue', s.j->>'estimatedValue', s.j->>'value')::numeric end, t.tender_value),
  emd_amount = coalesce(case when coalesce(s.j->>'emdAmount', s.j->>'emd') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(s.j->>'emdAmount', s.j->>'emd')::numeric end, t.emd_amount),
  currency = coalesce(nullif(btrim(s.j->>'currency'), ''), t.currency),
  source_url = coalesce(nullif(btrim(s.j->>'sourceUrl'), ''), nullif(btrim(s.j->>'sourceurl'), ''), t.source_url),
  qualification_status = coalesce(t.qualification_status, 'VERIFY')
from source s
where t.id = s.id;

-- API rows whose historical metadata is malformed still need an explicit
-- initial workflow state. Existing non-null human/AI decisions are untouched.
update public.agenttender_tenders
set qualification_status = 'VERIFY'
where tender247_api_sync is true
  and qualification_status is null;

commit;
