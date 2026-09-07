-- Daily snapshot identity for agenttender_tenders.
--
-- BEFORE: UNIQUE (source_portal, source_tender_id)
--   Same Tender247 ID across days updated one global row and moved scraped_date.
--
-- AFTER: UNIQUE (source_portal, source_tender_id, scraped_date)
--   Each (portal, tender id, scrape day) is its own immutable snapshot row.
--
-- DO NOT apply until explicitly authorized.
-- Does NOT repair/dedupe historical production data.

begin;

-- ---------------------------------------------------------------------------
-- 1) scraped_date must be non-null for uniqueness (daily snapshots always dated)
-- ---------------------------------------------------------------------------
-- Existing null scraped_date rows: leave null; composite unique uses a partial
-- index for dated rows + keep a separate unique for legacy nulls if needed.
-- Prefer backfill-nulls separately; for constraint we require scraped_date NOT NULL
-- on new writes. Fill remaining nulls from first_seen_at::date as a safe default
-- so the unique constraint can be created without dropping rows.

update public.agenttender_tenders
set scraped_date = coalesce(
  scraped_date,
  (first_seen_at at time zone 'Asia/Kolkata')::date,
  (created_at at time zone 'Asia/Kolkata')::date,
  current_date
)
where scraped_date is null;

alter table public.agenttender_tenders
  alter column scraped_date set not null;

-- ---------------------------------------------------------------------------
-- 2) Replace global portal+id uniqueness with daily snapshot uniqueness
-- ---------------------------------------------------------------------------
alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_source_unique;

-- If duplicate (portal, id, date) rows somehow exist, keep the earliest id.
-- (Expected empty after global-unique era; included for safety.)
delete from public.agenttender_tenders t
using public.agenttender_tenders d
where t.source_portal = d.source_portal
  and t.source_tender_id = d.source_tender_id
  and t.scraped_date = d.scraped_date
  and t.id > d.id;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_source_date_unique
  unique (source_portal, source_tender_id, scraped_date);

create index if not exists agenttender_tenders_portal_id_date_idx
  on public.agenttender_tenders (source_portal, source_tender_id, scraped_date);

create index if not exists agenttender_tenders_portal_id_idx
  on public.agenttender_tenders (source_portal, source_tender_id);

-- ---------------------------------------------------------------------------
-- 3) scraped_date is immutable after insert (no Phase-1 move-to-today exception)
-- ---------------------------------------------------------------------------
create or replace function public.agenttender_preserve_scraped_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.scraped_date is not null then
    -- Historical batch membership is immutable.
    new.scraped_date := old.scraped_date;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Qualification results: one row per tender UUID, not per global tender id
-- ---------------------------------------------------------------------------
-- Parent tender rows may now repeat source_tender_id across scraped_date values.
-- Keep UNIQUE(tender_id); drop UNIQUE(source_portal, source_tender_id).

alter table public.agenttender_qualification_results
  drop constraint if exists agenttender_qualification_source_unique;

create index if not exists agenttender_qualification_source_idx
  on public.agenttender_qualification_results (source_portal, source_tender_id);

comment on constraint agenttender_tenders_source_date_unique
  on public.agenttender_tenders is
  'Daily scrape snapshot identity: same portal tender id may exist on multiple scraped_date values.';

commit;
