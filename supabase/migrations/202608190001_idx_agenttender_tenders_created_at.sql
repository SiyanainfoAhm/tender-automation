begin;

create index if not exists idx_agenttender_tenders_created_at
  on public.agenttender_tenders (created_at desc);

commit;
