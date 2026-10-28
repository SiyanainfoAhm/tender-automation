-- Owner request (28 Oct 2026): the V2 decision must use Siyana's verified company documents.
-- A mandatory pre-qualification condition that the company documents prove is NOT met
-- (e.g. average turnover below the RFP minimum per the CA certificate, or a bidder-type
-- clause limited to Government organisations / PSUs) makes the tender NO_GO.
insert into public.agenttender_eligibility_rules
  (code, title, match_patterns, decision, ai_allowed, priority, enabled, approval_source, version, parameters, evidence_conditions, exception_conditions)
values
  ('COMPANY_MANDATORY_PQ_FAILURE',
   'Mandatory pre-qualification condition proven NOT met by Siyana''s verified company documents (for example average annual turnover below the RFP minimum per the CA turnover certificate / audited accounts, years in business below the minimum per the incorporation certificate, or bidder eligibility limited to Government organisations / PSUs). Unproven or missing company evidence is never a failure under this rule.',
   array['average annual turnover of not less than','minimum average annual turnover','state/central government organisation','public sector undertaking (psu)','minimum period of','years of existence'],
   'NO_GO', true, 40, true, 'OWNER', 1,
   '{"source":"deterministic company check (agenttender-orch-v2-chat/company-check.mjs)"}'::jsonb,
   '{"missing_evidence_is_failure": false, "keywords_are_candidates_only": true, "requires_current_tender_evidence": true, "requires_verified_company_document": true}'::jsonb,
   '{"partner_or_consortium_permitted": "If the RFP permits a consortium/partner that meets the condition, record CONDITIONAL review instead of NO_GO."}'::jsonb)
on conflict do nothing;
