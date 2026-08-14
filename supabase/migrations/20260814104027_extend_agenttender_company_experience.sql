begin;

-- Extend existing company past-experience table. Do not create a duplicate.

alter table public.agenttender_company_experience
  add column if not exists location text,
  add column if not exists nature_of_work text,
  add column if not exists project_status text,
  add column if not exists expected_completion_date date,
  add column if not exists duration_months integer,
  add column if not exists contact_person_name text,
  add column if not exists contact_mobile text,
  add column if not exists contact_email text,
  add column if not exists work_order_url text,
  add column if not exists work_order_blob_name text,
  add column if not exists work_order_file_name text,
  add column if not exists completion_certificate_url text,
  add column if not exists completion_certificate_blob_name text,
  add column if not exists completion_certificate_file_name text,
  add column if not exists status text not null default 'active',
  add column if not exists updated_by uuid
    references public.agenttender_users(id)
    on delete set null;

alter table public.agenttender_company_experience
  drop constraint if exists agenttender_company_experience_status_check;
alter table public.agenttender_company_experience
  add constraint agenttender_company_experience_status_check
  check (status in ('active', 'archived'));

alter table public.agenttender_company_experience
  drop constraint if exists agenttender_company_experience_project_status_check;
alter table public.agenttender_company_experience
  add constraint agenttender_company_experience_project_status_check
  check (
    project_status is null
    or project_status in ('ongoing', 'completed')
  );

alter table public.agenttender_company_experience
  drop constraint if exists agenttender_company_experience_duration_check;
alter table public.agenttender_company_experience
  add constraint agenttender_company_experience_duration_check
  check (duration_months is null or duration_months >= 0);

create index if not exists agenttender_company_experience_company_status_idx
  on public.agenttender_company_experience (company_id, status);

commit;
