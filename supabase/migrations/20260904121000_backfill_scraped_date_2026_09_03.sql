begin;

-- Data correction: Phase-1 upsert for 2026-09-03 stored 907 rows, but the
-- preserve_scraped_date trigger blocked refresh on existing tenders (local
-- skip-ChatGPT screeningSource). Align scraped_date with run metadata.
update public.agenttender_tenders t
set
  scraped_date = date '2026-09-03',
  raw_metadata = coalesce(t.raw_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'phase1Screening', true,
      'runDate', '2026-09-03',
      'scrapedDateBackfill', '2026-09-04'
    ),
  updated_at = now()
where t.source_portal = 'TENDER247'
  and (
    t.raw_metadata->>'runDate' = '2026-09-03'
    or t.content_hash like 'phase1-gpt:TENDER247:%:2026-09-03:%'
  )
  and t.scraped_date is distinct from date '2026-09-03';

commit;
