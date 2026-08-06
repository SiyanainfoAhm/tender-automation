begin;

create table if not exists public.agenttender_saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.agenttender_users(id)
    on delete cascade,
  name text not null,
  is_default boolean not null default false,
  filters jsonb not null default '{}'::jsonb,
  sort_config jsonb not null default '{}'::jsonb,
  visible_columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenttender_saved_views_name_not_blank
    check (length(trim(name)) > 0)
);

create index if not exists agenttender_saved_views_user_id_idx
  on public.agenttender_saved_views(user_id);

drop trigger if exists agenttender_saved_views_updated_at
  on public.agenttender_saved_views;
create trigger agenttender_saved_views_updated_at
before update on public.agenttender_saved_views
for each row
execute function public.agenttender_set_updated_at();

alter table public.agenttender_saved_views enable row level security;
revoke all on public.agenttender_saved_views from anon, authenticated;
grant all on public.agenttender_saved_views to service_role;

commit;
