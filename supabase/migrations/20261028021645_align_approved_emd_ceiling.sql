-- Explicitly approved in the VBDC V2 repair request, 28 October 2026.
-- Preserve the previous approved policy and its new version in the existing history.
insert into public.agenttender_rule_versions(rule_id,version,snapshot,changed_by)
select r.id,r.version,to_jsonb(r),'VBDC_V2_REPAIR_USER_APPROVAL_20261028:before'
from public.agenttender_eligibility_rules r where r.code='EMD_LIMIT'
and (r.parameters->>'max_payable_emd')::numeric is distinct from 500000
and not exists(select 1 from public.agenttender_rule_versions v where v.rule_id=r.id and v.version=r.version);
update public.agenttender_eligibility_rules
set title='EMD above INR 500000 is NO_GO only after checking actual payable EMD and approved documented exemptions. EMD exactly INR 500000 is permitted.',
parameters=parameters||'{"currency":"INR","comparison":">","max_payable_emd":500000,"requires_exemption_review":true}'::jsonb,
version=version+1,approval_source='USER_APPROVED_VBDC_V2_REPAIR_20261028',updated_at=now()
where code='EMD_LIMIT' and (parameters->>'max_payable_emd')::numeric is distinct from 500000;
insert into public.agenttender_rule_versions(rule_id,version,snapshot,changed_by)
select r.id,r.version,to_jsonb(r),'VBDC_V2_REPAIR_USER_APPROVAL_20261028:approved'
from public.agenttender_eligibility_rules r where r.code='EMD_LIMIT'
and not exists(select 1 from public.agenttender_rule_versions v where v.rule_id=r.id and v.version=r.version);
