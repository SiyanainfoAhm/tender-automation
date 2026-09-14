begin;

-- TF-44: mandatory project type + multi-select nature of work (jsonb array).

alter table public.agenttender_company_experience
  add column if not exists project_type text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenttender_company_experience'
      and column_name = 'nature_of_work'
      and udt_name = 'text'
  ) then
    alter table public.agenttender_company_experience
      alter column nature_of_work type jsonb
      using case
        when nature_of_work is null or btrim(nature_of_work) = '' then '[]'::jsonb
        when left(btrim(nature_of_work), 1) = '[' then nature_of_work::jsonb
        else jsonb_build_array(btrim(nature_of_work))
      end;
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenttender_company_experience'
      and column_name = 'nature_of_work'
  ) then
    alter table public.agenttender_company_experience
      add column nature_of_work jsonb;
  end if;
end $$;

alter table public.agenttender_company_experience
  drop constraint if exists agenttender_company_experience_project_type_check;
alter table public.agenttender_company_experience
  add constraint agenttender_company_experience_project_type_check
  check (
    project_type is null
    or project_type in (
      'Private',
      'Central Government',
      'State Government',
      'PSU',
      'Autonomous Body',
      'Public–Private Partnership (PPP)',
      'Co-operative Society',
      'NGO / Non-Profit Organisation',
      'Local Body / Municipal Body',
      'Educational Institution',
      'Other'
    )
  );

alter table public.agenttender_company_experience
  drop constraint if exists agenttender_company_experience_nature_of_work_array_check;
alter table public.agenttender_company_experience
  add constraint agenttender_company_experience_nature_of_work_array_check
  check (
    nature_of_work is null
    or jsonb_typeof(nature_of_work) = 'array'
  );

commit;
