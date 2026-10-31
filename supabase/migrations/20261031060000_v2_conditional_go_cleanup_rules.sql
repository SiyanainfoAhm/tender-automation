-- 2026-10-31: teach V2 the owner's CONDITIONAL_GO clean-up so these tenders are decided automatically.
--   1. Owner rules: cloud VM hosting, proprietary/EDA/LabVIEW packages, API-management product supply,
--      smart classrooms and GIS road/drain databases are NO_GO (quick screen + chat use these rules).
--   2. Duplicate check at V2 step 2: a re-listed tender (same buyer, same title, same dates/values)
--      of one already in CONDITIONAL_GO/GO/bid is marked DUPLICATE without AI or document work.
-- Title-only NO_GO patterns live in agenttender-orch-v2-worker/title-screen.mjs (TITLE_SCREEN_20261031_1).

-- 1. Owner rules --------------------------------------------------------------------------------
insert into public.agenttender_eligibility_rules
  (code, title, match_patterns, decision, ai_allowed, priority, enabled, approval_source, version, parameters, evidence_conditions, exception_conditions)
values
  ('CLOUD_HOSTING_INFRA',
   'Primary deliverable is cloud infrastructure / hosting capacity (public cloud virtual machines, storage, managed cloud service provider), not software development.',
   array['virtual machine (compute)','public cloud virtual machines','managed cloud service provider','cloud hosting services','cloud infrastructure services','object storage','block storage','vCPU','GPU instance'],
   'NO_GO', false, 110, true, 'OWNER', 1, '{}'::jsonb,
   '{"primary_deliverable_only": true}'::jsonb,
   '{"incidental_hosting": "Hosting inside a new custom website/application build is NOT an exclusion."}'::jsonb)
on conflict do nothing;

update public.agenttender_eligibility_rules r
set match_patterns = (select array_agg(distinct p) from unnest(r.match_patterns || x.extra) p),
    version = r.version + 1
from (values
  ('SOFTWARE_RESALE', array['NI LabVIEW','LabVIEW software package','EDA tool','EDA tools','software licenses and development tools','API management (APIM) platform','application programming interface management platform','supply of API management platform']),
  ('HARDWARE',        array['smart classroom','smart class room','smart classrooms','interactive flat panel','supply, installation, commissioning, maintenance and demonstration of various equipment']),
  ('GIS_SURVEY_PROCESSING', array['GIS database for road network','GIS data base for road and storm water drain network','GIS mapping of road network','storm water drain network GIS'])
) as x(code, extra)
where r.code = x.code
  and not (x.extra <@ r.match_patterns);

-- 2. Duplicate check --------------------------------------------------------------------------
create or replace function public.agenttender_title_key(p_title text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p_title,'')),
    '^\s*(corrigendum[^:]*:\s*|tender\s+for\s+|request\s+for\s+proposals?\s*(\(rfp\))?\s*(for\s+)?|rfp\s*(-\s*)?(for\s+)?|expression\s+of\s+interest\s*(\(eoi\))?\s*(for\s+)?|eoi\s*(-\s*)?(for\s+)?)+',''),
    '[^a-z0-9]+',' ','g'),'\s+',' ','g'))
$$;

-- The tender this one re-lists, if any. Only originals still being pursued count, so two separate
-- lots that share a generic title are never collapsed into one.
create or replace function public.agenttender_orch_v2_find_duplicate(p_tender uuid)
returns uuid language sql stable security definer set search_path = pg_catalog, public as $$
  with a as (
    select t.*, public.agenttender_title_key(t.title) k, coalesce(t.bid_submission_date,t.closing_date) due
    from public.agenttender_tenders t where t.id = p_tender
  )
  select b.id
  from a join public.agenttender_tenders b
    on b.id <> a.id
   and lower(btrim(b.organization)) = lower(btrim(a.organization))
   and coalesce(b.source_region,'') = coalesce(a.source_region,'')
   and b.qualification_status in ('VERIFY','REVIEW','CONDITIONAL_GO','GO','SUBMITTED','UNDER_EVALUATION','WON','LOST')
   and (b.created_at < a.created_at or (b.created_at = a.created_at and b.id < a.id))
  cross join lateral (select public.agenttender_title_key(b.title) k, coalesce(b.bid_submission_date,b.closing_date) due) bk
  where least(length(a.k), length(bk.k)) >= 40
    and a.k !~ '^(hiring of agency for it projects|tender estimated cost|custom bid for services)'
    and (a.k like bk.k || '%' or bk.k like a.k || '%')
    and (a.due is null or bk.due is null or abs(a.due - bk.due) <= 3)
    and (nullif(a.tender_value,0) is null or nullif(b.tender_value,0) is null or a.tender_value = b.tender_value)
    and (nullif(a.emd_amount,0) is null or nullif(b.emd_amount,0) is null or a.emd_amount = b.emd_amount)
  order by (b.qualification_status in ('GO','SUBMITTED','UNDER_EVALUATION','WON','LOST')) desc, b.created_at, b.id
  limit 1
$$;

create or replace function public.agenttender_orch_v2_duplicate_commit(p_tender uuid, p_lease uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare q public.agenttender_orch_v2_tasks%rowtype; t public.agenttender_tenders%rowtype; o public.agenttender_tenders%rowtype;
        orig uuid; reason text; actual text;
begin
 if session_user not in ('postgres','supabase_admin') and coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
 select * into q from public.agenttender_orch_v2_tasks where tender_id=p_tender and lease_token=p_lease and state='RUNNING' and step in (2,3) for update;
 if not found or q.leased_until<now() then return jsonb_build_object('applied',false,'reason','STALE_OR_WRONG_STAGE'); end if;
 select * into t from public.agenttender_tenders where id=p_tender for update;
 if t.qualification_status not in ('VERIFY','REVIEW') or coalesce(t.status,'') in ('GO','WILL_BID','will-bid','SUBMITTED','WON','UNDER_EVALUATION')
  or coalesce(lower(t.decision_source),'') like '%manual%'
  or exists(select 1 from public.agenttender_bid_workspaces w where w.tender_id=p_tender) then
  return jsonb_build_object('applied',false,'reason','PROTECTED_OR_NOT_ELIGIBLE');
 end if;
 orig := public.agenttender_orch_v2_find_duplicate(p_tender);
 if orig is null then return jsonb_build_object('applied',false,'reason','NO_DUPLICATE'); end if;
 select * into o from public.agenttender_tenders where id=orig;
 reason := left(format('DUPLICATE — V2 duplicate check: same buyer and tender as %s (%s, %s).', coalesce(o.source_tender_id,o.id::text), o.qualification_status, left(o.title,200)),1000);
 update public.agenttender_orch_v2_tasks set state='DONE',ready_at=now(),last_error=null,lease_token=null,leased_until=null,
  checkpoint=checkpoint||jsonb_build_object('duplicate_of',orig),updated_at=now() where tender_id=p_tender;
 update public.agenttender_tenders set qualification_status='DUPLICATE', status='duplicate', prescreen_status='REJECTED',
  decision_source='ORCHESTRATOR_V2', duplicate_of_tender_id=orig, duplicate_of_source_tender_id=o.source_tender_id,
  duplicate_match_kind='V2_TITLE_ORG', prescreen_reason=reason, prescreened_at=now(), updated_at=now()
 where id=p_tender and qualification_status=t.qualification_status returning qualification_status into actual;
 if actual is distinct from 'DUPLICATE' then raise exception 'DECISION_TRIGGER_CONFLICT: expected DUPLICATE, actual %',actual; end if;
 insert into public.agenttender_v2_decision_audit(tender_id,final_decision,matched_rule_codes,rule_versions,evidence,worker_version,model,decision_source,reason,assessment)
 values(p_tender,'DUPLICATE','["V2_DUPLICATE_CHECK"]'::jsonb,'{}'::jsonb,
  jsonb_build_array(jsonb_build_object('ref','L','quote',t.title),jsonb_build_object('ref','ORIGINAL','tender_id',orig,'quote',o.title)),
  'V2_DUPLICATE_20261031_1',null,'ORCHESTRATOR_V2',reason,jsonb_build_object('duplicate_of',orig,'original_status',o.qualification_status));
 insert into public.agenttender_orch_v2_events(tender_id,step,event_type,details)
 values(p_tender,q.step,'DUPLICATE_DECISION_COMMITTED',jsonb_build_object('duplicate_of',orig,'reason',reason));
 return jsonb_build_object('applied',true,'status','DUPLICATE','duplicate_of',orig,'reason',reason);
end $$;

revoke all on function public.agenttender_orch_v2_find_duplicate(uuid) from public, anon, authenticated;
revoke all on function public.agenttender_orch_v2_duplicate_commit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.agenttender_orch_v2_find_duplicate(uuid) to service_role;
grant execute on function public.agenttender_orch_v2_duplicate_commit(uuid,uuid) to service_role;
