-- Tender row status is the single source of truth for every screen.
-- Previously effective_qualification_status = COALESCE(q.status, t.qualification_status),
-- so a stale AI result (e.g. VERIFY) overrode the tender's real status (e.g. NO_GO)
-- on Dashboard, Analytics, Reports and Bid Fees. The AI result is now only a fallback.
create or replace view public.agenttender_web_tender_list with (security_invoker = true) as
SELECT t.id, t.source_portal, t.source_region, t.source_tender_id, t.folder_id, t.reference_no, t.title,
    t.organization, t.department, t.authority, t.category, t.project_category, t.tender_type, t.description,
    t.city, t.state, t.location_text, t.published_date, t.opening_date, t.closing_date, t.bid_submission_date,
    t.tender_value, t.tender_value_text, t.emd_amount, t.emd_text, t.currency, t.source_url, t.download_status,
    t.qualification_status, t.ai_summary_available, t.document_archive_available, t.documents_zip_url,
    t.ai_summary_url, t.first_seen_at, t.last_seen_at, t.crawled_at, t.supabase_synced_at, t.created_at,
    t.updated_at, t.scraped_date, t.duplicate_of_source_tender_id, t.duplicate_of_tender_id, t.duplicate_match_kind,
    t.raw_metadata ->> 'screeningReason'::text AS screening_reason,
    CASE lower(COALESCE(t.raw_metadata ->> 'msmeExemption'::text, ''::text))
        WHEN 'true'::text THEN true WHEN 'false'::text THEN false ELSE NULL::boolean END AS msme_exemption,
    CASE lower(COALESCE(t.raw_metadata ->> 'startupExemption'::text, ''::text))
        WHEN 'true'::text THEN true WHEN 'false'::text THEN false ELSE NULL::boolean END AS startup_exemption,
    q.id AS qualification_id, q.decision_label, q.verdict,
    COALESCE(q.reason, t.raw_metadata ->> 'screeningReason'::text) AS reason,
    q.required_action, q.confidence, q.manual_review_required, q.requires_detailed_tender_review,
    q.qualified_at, q.chat_url,
    COALESCE(t.qualification_status, q.status) AS effective_qualification_status,
    t.prescreen_status, t.prescreen_reason_code, t.prescreen_reason, t.chatgpt_eligible, t.decision_source,
    t.prescreened_at, t.prescreen_rules_version, t.rfp_estimated_cost
FROM agenttender_tenders t
LEFT JOIN agenttender_qualification_results q ON q.tender_id = t.id;
