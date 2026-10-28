CREATE OR REPLACE FUNCTION public.agenttender_orch_v2_claim(p_limit integer DEFAULT 12)
 RETURNS TABLE(tender_id uuid, step integer, lease_token uuid, checkpoint jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
 if current_user not in ('postgres','supabase_admin','service_role') then
   raise exception 'service role required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('agenttender_orch_v2_claim',0)); perform public.agenttender_orch_v2_recover_expired();

 return query
 with caps(cap_step, cap) as (
   values (1,20),(2,20),(3,4),(4,10),(5,2),(6,8)
 ),
 running as (
   select r.step as run_step, count(*) as n
   from public.agenttender_orch_v2_tasks r
   where r.state = 'RUNNING' and r.leased_until > now()
   group by r.step
 ),
 eligible as (
   select q.tender_id as e_tender, q.step as e_step,
          row_number() over (
            partition by q.step
            order by case when q.step=3 then 0 when q.priority <= -1000000 then 1 else 0 end,
                     case when q.step=3 then 0 else q.priority end desc, q.ready_at, q.created_at
          ) as rn
   from public.agenttender_orch_v2_tasks q
   join public.agenttender_tenders t on t.id = q.tender_id
   join public.agenttender_tender_route_assignments a
     on a.tender_id = q.tender_id and a.route = 'ORCHESTRATOR'
   where (t.qualification_status in ('VERIFY','REVIEW') OR (q.step=6 AND t.qualification_status='CONDITIONAL_GO' AND t.decision_source='ORCHESTRATOR_V2' AND q.checkpoint ? 'revalidate_unsupported_auto_decision'))
     and (q.failures < 5 OR (q.step=3 AND q.checkpoint ? 'dependency_change'))
     and q.state in ('WAITING','RETRY')
     and q.ready_at <= now()
 ),
 candidates as (
   select e.e_tender, e.rn as c_rn
   from eligible e
   join caps c on c.cap_step = e.e_step
   left join running r on r.run_step = e.e_step
   where e.rn <= greatest(c.cap - coalesce(r.n, 0), 0)
 ),
 picked as (
   select q.tender_id as p_tender
   from public.agenttender_orch_v2_tasks q
   join candidates c on c.e_tender = q.tender_id
   where q.state in ('WAITING','RETRY')
   -- round-robin across steps (each step's 1st, then each step's 2nd, ...),
   -- later steps first within each round
   order by c.c_rn, q.step desc
   for update of q skip locked
   limit least(greatest(coalesce(p_limit, 12), 1), 25)
 ),
 updated as (
   update public.agenttender_orch_v2_tasks q
      set state = 'RUNNING',
          lease_token = gen_random_uuid(),
          leased_until = now() + case q.step
                                   when 3 then interval '6 minutes'
                                   when 5 then interval '4 minutes'
                                   when 6 then interval '10 minutes'
                                   else interval '2 minutes' end,
          updated_at = now()
     from picked p
    where p.p_tender = q.tender_id
   returning q.tender_id, q.step, q.lease_token, q.checkpoint
 )
 select u.tender_id, u.step, u.lease_token, u.checkpoint from updated u;
end
$function$;
