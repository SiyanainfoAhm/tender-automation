create table if not exists public.agenttender_chat_company_checks (
  tender_id uuid not null references public.agenttender_tenders(id) on delete cascade,
  company_id uuid not null,
  version text not null,
  stamp text not null,
  report jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tender_id, company_id)
);
comment on table public.agenttender_chat_company_checks is 'Cache of the tender chatbot requirement check (RFP vs verified company documents). Advisory; never a business status.';
alter table public.agenttender_chat_company_checks enable row level security;
revoke all on public.agenttender_chat_company_checks from anon, authenticated;

create or replace function public.agenttender_company_check_stamp(p_tender_id uuid, p_company_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select concat_ws('|',
    (select count(*)::text || ':' || coalesce(max(updated_at)::text,'') from agenttender_company_documents where company_id = p_company_id),
    (select count(*)::text || ':' || coalesce(max(updated_at)::text,'') from agenttender_tender_documents where tender_id = p_tender_id and company_id = p_company_id),
    (select count(*)::text || ':' || coalesce(max(updated_at)::text,'') from agenttender_eligibility_rules)
  );
$$;
revoke all on function public.agenttender_company_check_stamp(uuid,uuid) from public, anon, authenticated;
