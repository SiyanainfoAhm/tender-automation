begin;

-- Normalized IT project type. Raw portal/GEM text stays in category.
alter table public.agenttender_tenders
  add column if not exists project_category text;

create or replace function public.agenttender_classify_project_category(
  p_title text,
  p_description text,
  p_source_category text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  blob text;
begin
  blob := lower(trim(both from concat_ws(
    ' ',
    coalesce(p_title, ''),
    coalesce(p_description, ''),
    coalesce(p_source_category, '')
  )));
  blob := regexp_replace(blob, '\s+', ' ', 'g');

  if blob = '' then
    return 'Other';
  end if;

  if blob ~ 'website|web[[:space:]]*site|web[[:space:]]*portal|web-portal|e-?portal|[[:<:]]portals?[[:>:]]|web[[:space:]]*application|web[[:space:]]*app|[[:<:]]cms[[:>:]]|web[[:space:]]*development|web[[:space:]]*design|website[[:space:]]*re-?design|[[:<:]]dashboard[[:>:]]'
     and blob ~ 'android|[[:<:]]ios[[:>:]]|mobile[[:space:]]*app(lication)?s?' then
    return 'Web + Mobile App';
  end if;

  if blob ~ '[[:<:]]hiring of professionals?[[:>:]]|[[:<:]]manpower[[:>:]]|resource augmentation|resource hiring|developer hiring|procurement of resources' then
    return 'Manpower / Resource Hiring';
  end if;

  if blob ~ 'licen[cs]e renew|[[:<:]]subscription[[:>:]]|software licen[cs]e|database licen[cs]e|[[:<:]]licen[cs]es?[[:>:]]' then
    return 'Software License / Subscription';
  end if;

  if blob ~ 'cyber[[:space:]]*security|cybersecurity|[[:<:]]vapt[[:>:]]|penetration[[:space:]]*test|[[:<:]]pentest[[:>:]]|[[:<:]]soc[[:>:]]|security[[:space:]]*audit|red[[:space:]]*team|anti-?phish|anti-?pharm|darknet|threat[[:space:]]*intelligence|vulnerability([[:space:]]+and)?[[:space:]]+penetration|[[:<:]]edr[[:>:]]|endpoint[[:space:]]*detection' then
    return 'Cybersecurity';
  end if;

  if blob ~ '[[:<:]]gis[[:>:]]|geospatial|geo-spatial|[[:<:]]mapping[[:>:]]' then
    return 'GIS / Mapping';
  end if;

  if blob ~ '(^|[^a-z])ai([^a-z]|$)|chat[[:space:]]*bots?|machine[[:space:]]*learning|[[:<:]]ml[[:>:]]|generative[[:space:]]*ai|[[:<:]]rpa[[:>:]]|robotic[[:space:]]*process|process[[:space:]]*automation|workflow[[:space:]]*automation' then
    return 'AI / Automation';
  end if;

  if blob ~ '[[:<:]]erp[[:>:]]|[[:<:]]crm[[:>:]]|[[:<:]]hrms[[:>:]]|[[:<:]]payroll[[:>:]]|enterprise[[:space:]]*management' then
    return 'ERP / CRM / HRMS';
  end if;

  if blob ~ '[[:<:]]saas[[:>:]]|cloud[[:space:]]*platform|cloud-native|cloud[[:space:]]*native|hosted[[:space:]]*application|cloud-based|cloud[[:space:]]*based|cloud[[:space:]]*computing' then
    return 'Cloud System / SaaS';
  end if;

  if blob ~ 'system[[:space:]]*integration|api[[:space:]]*integration|third[ -]party[[:space:]]*integration|api[[:space:]]*development' then
    return 'API / System Integration';
  end if;

  if blob ~ '[[:<:]]amc[[:>:]]|[[:<:]]cmc[[:>:]]|amccmc|annual[[:space:]]*maintenance|application[[:space:]]*support|support[[:space:]]*services|maintenance[[:space:]]*services|software[[:space:]]*support|facility[[:space:]]*management|[[:<:]]fms[[:>:]]|technical[[:space:]]*(function[[:space:]]*)?support' then
    return 'Support / AMC / Maintenance';
  end if;

  if blob ~ 'data[[:space:]]*cent(er|re)|network(ing)?|[[:<:]]lan[[:>:]]|[[:<:]]wan[[:>:]]|ethernet|connectivity|hardware[[:space:]]*infra|[[:<:]]servers?[[:>:]]|structured[[:space:]]*cabling|internet[[:space:]]*sharing|air[[:space:]]*fib(re|er)' then
    return 'IT Infrastructure';
  end if;

  if blob ~ 'website|web[[:space:]]*portal|e-?portal|[[:<:]]portals?[[:>:]]|web[[:space:]]*application|web[[:space:]]*app|[[:<:]]cms[[:>:]]|web[[:space:]]*development|web[[:space:]]*design' then
    return 'Website / Web Portal';
  end if;

  if blob ~ 'android|[[:<:]]ios[[:>:]]|mobile[[:space:]]*app(lication)?s?' then
    return 'Mobile App';
  end if;

  if blob ~ 'custom[[:space:]]*software|custom[[:space:]]*application|software[[:space:]]*redevelopment|bespoke[[:space:]]*software|software[[:space:]]*development|application[[:space:]]*development' then
    return 'Custom Software';
  end if;

  return 'Other';
end;
$$;

create or replace function public.agenttender_set_project_category()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.project_category := public.agenttender_classify_project_category(
    new.title,
    new.description,
    new.category
  );
  return new;
end;
$$;

drop trigger if exists agenttender_tenders_project_category
  on public.agenttender_tenders;

create trigger agenttender_tenders_project_category
before insert or update of title, description, category
on public.agenttender_tenders
for each row
execute function public.agenttender_set_project_category();

update public.agenttender_tenders
set project_category = public.agenttender_classify_project_category(
  title,
  description,
  category
);

alter table public.agenttender_tenders
  alter column project_category set default 'Other';

update public.agenttender_tenders
set project_category = 'Other'
where project_category is null;

alter table public.agenttender_tenders
  alter column project_category set not null;

alter table public.agenttender_tenders
  drop constraint if exists agenttender_tenders_project_category_check;

alter table public.agenttender_tenders
  add constraint agenttender_tenders_project_category_check
  check (
    project_category in (
      'Website / Web Portal',
      'Mobile App',
      'Web + Mobile App',
      'ERP / CRM / HRMS',
      'Cloud System / SaaS',
      'Custom Software',
      'API / System Integration',
      'AI / Automation',
      'GIS / Mapping',
      'Cybersecurity',
      'IT Infrastructure',
      'Support / AMC / Maintenance',
      'Manpower / Resource Hiring',
      'Software License / Subscription',
      'Other'
    )
  );

create index if not exists agenttender_tenders_project_category_idx
  on public.agenttender_tenders(project_category);

drop view if exists public.agenttender_web_tender_list;

create view public.agenttender_web_tender_list
with (security_invoker = true)
as
select
  t.id,
  t.source_portal,
  t.source_tender_id,
  t.folder_id,
  t.title,
  t.organization,
  t.department,
  t.authority,
  t.category,
  t.project_category,
  t.tender_type,
  t.description,
  t.city,
  t.state,
  t.location_text,
  t.published_date,
  t.opening_date,
  t.closing_date,
  t.bid_submission_date,
  t.tender_value,
  t.tender_value_text,
  t.emd_amount,
  t.emd_text,
  t.currency,
  t.source_url,
  t.download_status,
  t.qualification_status,
  t.ai_summary_available,
  t.document_archive_available,
  t.first_seen_at,
  t.last_seen_at,
  t.crawled_at,
  t.supabase_synced_at,
  t.created_at,
  t.updated_at,

  q.id as qualification_id,
  q.decision_label,
  q.verdict,
  q.reason,
  q.required_action,
  q.confidence,
  q.manual_review_required,
  q.requires_detailed_tender_review,
  q.qualified_at,
  q.chat_url,
  coalesce(q.status, t.qualification_status) as effective_qualification_status,

  t.prescreen_status,
  t.prescreen_reason_code,
  t.prescreen_reason,
  t.chatgpt_eligible,
  t.decision_source,
  t.prescreened_at,
  t.prescreen_rules_version

from public.agenttender_tenders t
left join public.agenttender_qualification_results q
  on q.tender_id = t.id;

revoke all on public.agenttender_web_tender_list from anon, authenticated;
grant select on public.agenttender_web_tender_list to service_role;

commit;
