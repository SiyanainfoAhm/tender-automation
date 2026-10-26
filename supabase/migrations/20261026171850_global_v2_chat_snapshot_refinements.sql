-- Global conversations reuse the existing history; tender chats remain scoped.
alter table public.agenttender_ai_chat_sessions alter column tender_id drop not null;
alter table public.agenttender_ai_chat_messages alter column tender_id drop not null;

create or replace function public.agenttender_global_chat_snapshot(p_company uuid,p_user uuid,p_plan jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; intent text:=coalesce(p_plan->>'intent','search'); today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 if not exists(select 1 from agenttender_company_memberships m join agenttender_users u on u.id=m.user_id where m.company_id=p_company and m.user_id=p_user and m.status='active' and u.is_active and u.company_id=p_company) then raise exception 'Company access denied'; end if;
 with base as materialized (
 select t.id,t.title,t.organization,t.source_region,t.location_text,t.currency,t.tender_value,t.tender_value_text,t.closing_date,t.scraped_date,t.project_category,t.description,t.qualification_status,t.status as recorded_status,t.prescreen_reason,t.download_status,t.ai_bid_confidence,
 coalesce(t.qualification_status,'NOT_EVALUATED') bucket
 from agenttender_tenders t
 ), filtered as materialized (
 select b.* from base b where
 (not (p_plan ? 'ids') or jsonb_array_length(p_plan->'ids')=0 or b.id::text in (select jsonb_array_elements_text(p_plan->'ids')))
 and (not (p_plan ? 'status') or p_plan->>'status'='' or b.bucket=p_plan->>'status' or upper(coalesce(b.recorded_status,''))=p_plan->>'status')
 and (coalesce(p_plan->>'region','')='' or b.source_region=p_plan->>'region')
 and (coalesce(p_plan->>'country','')<>'USA' or coalesce(b.location_text,'') ~* '(United States|\mUSA\M|\mU\.S\.A\.\M)')
 and (coalesce(p_plan->>'search','')='' or to_tsvector('english',coalesce(b.title,'')||' '||coalesce(b.description,'')||' '||coalesce(b.organization,'')||' '||coalesce(b.project_category,'')) @@ websearch_to_tsquery('english',left(p_plan->>'search',200)))
 and (intent<>'today' or b.scraped_date=today)
 and (intent<>'closing' or (b.closing_date>=today and b.closing_date<today+7))
 and (intent not in ('priorities','ranking','usa_ai') or (b.closing_date is null or b.closing_date>=today) and b.bucket not in ('NO_GO','DUPLICATE','DELETE','LOST','DISQUALIFIED','WON','CANCELLED','SUBMITTED'))
 and (intent<>'conditional' or b.bucket='CONDITIONAL_GO')
 and (intent<>'verify' or b.bucket='VERIFY')
 and (intent<>'pq' or b.bucket='GO')
 and (intent<>'missing' or b.bucket='GO')
 ), chosen as (
 select * from filtered order by case bucket when 'GO' then 0 when 'CONDITIONAL_GO' then 1 when 'VERIFY' then 2 else 3 end,ai_bid_confidence desc nulls last,closing_date asc nulls last,id limit 30
 )
 select jsonb_build_object('as_of',now(),'today_india',today,'total',(select count(*) from base),
 'status_counts',(select coalesce(jsonb_object_agg(bucket,n),'{}') from (select bucket,count(*) n from base group by bucket) c),
 'recorded_status_counts',(select coalesce(jsonb_object_agg(s,n),'{}') from (select coalesce(recorded_status,'UNSET') s,count(*) n from base group by 1) c),
 'matching_total',(select count(*) from filtered),'candidate_limit',30,
 'tenders',coalesce((select jsonb_agg(to_jsonb(c)-'description'||jsonb_build_object('description',left(c.description,2200))) from chosen c),'[]'),
 'workspace_checklists',case when coalesce(p_plan->>'bids_allowed','false')='true' then
 coalesce((select jsonb_agg(x) from (select w.tender_id,w.workspace_status,w.submission_status,w.checklist_preparation_status,count(i.id) total_items,count(i.id) filter(where i.completion_status<>'COMPLETED' and not i.manual_completed) pending_items from agenttender_bid_workspaces w left join agenttender_bid_checklist_items i on i.workspace_id=w.id and i.company_id=p_company and not i.is_archived where w.company_id=p_company and w.tender_id in(select id from chosen) group by w.id) x),'[]') else '[]'::jsonb end,
 'pending_requirements',case when coalesce(p_plan->>'bids_allowed','false')='true' then coalesce((select jsonb_agg(x) from (select tender_id,requirement_name,category,processing_type,completion_status,manual_completed from agenttender_bid_checklist_items where company_id=p_company and not is_archived and tender_id in(select id from chosen) and completion_status<>'COMPLETED' and not manual_completed order by mandatory desc,display_order limit 80) x),'[]') else '[]'::jsonb end,
 'queue_counts',coalesce((select jsonb_agg(x) from (select step,state,count(*) total,sum(failures) failures,min(updated_at) oldest_update from agenttender_orch_v2_tasks where tender_id in(select id from filtered) group by step,state) x),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.agenttender_global_chat_snapshot(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agenttender_global_chat_snapshot(uuid,uuid,jsonb) to service_role;

