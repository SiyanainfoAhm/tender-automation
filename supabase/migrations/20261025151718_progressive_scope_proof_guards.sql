-- Production-source baseline backed up before this migration. No business status backfill.
CREATE OR REPLACE FUNCTION public.agenttender_v2_evidence_valid(p_tender uuid, p_evidence jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
SELECT (p_evidence->>'rule_code'<>'MANPOWER' OR coalesce(p_evidence->>'excerpt','') ~* 'manpower|staffing|staff augmentation|resource.based|person.month|personnel deployment|deployment of.{0,30}(staff|personnel)') AND (p_evidence->>'rule_code' NOT IN ('SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL','SOFTWARE_RESALE','READY_MADE_SOFTWARE') OR coalesce(p_evidence->>'excerpt','') ~* 'software|licen[cs]e|SaaS|Microsoft|MS Office|Office 20') AND (p_evidence->>'rule_code'<>'KIOSK' OR coalesce(p_evidence->>'excerpt','') ~* 'kiosk|self[ -]?service') AND (p_evidence->>'rule_code' NOT IN ('PROPRIETARY_ONLY','PAC_PROPRIETARY_PRODUCT') OR coalesce(p_evidence->>'excerpt','') ~* 'proprietary|\mPAC\M|exclusiv|OEM.only|only.authori[sz]ed') AND (length(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')))>=25 OR (
 p_evidence->>'chunk_id'='LISTING' AND length(btrim(coalesce(p_evidence->>'excerpt','')))>=8
 AND EXISTS(SELECT 1 FROM public.agenttender_tenders t WHERE t.id=p_tender
 AND lower(btrim(t.title))=lower(btrim(p_evidence->>'excerpt'))
 AND lower(btrim(t.description))=lower(btrim(t.title)))
 )) AND (
 EXISTS(SELECT 1 FROM public.agenttender_ai_document_chunks c WHERE c.tender_id=p_tender AND c.is_active AND c.source_type='TENDER_DOCUMENT'
 AND c.id::text=p_evidence->>'chunk_id'
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(c.content,'[[:space:]]+',' ','g')))>0)
 OR (p_evidence->>'chunk_id' LIKE 'EXTRACTED:%' AND EXISTS(
 SELECT 1 FROM public.agenttender_document_extractions x WHERE x.document_id::text=substring(p_evidence->>'chunk_id' FROM 11)
 AND (x.tender_id=p_tender OR EXISTS(SELECT 1 FROM public.agenttender_tender_documents d WHERE d.id=x.document_id AND d.tender_id=p_tender))
 AND x.extraction_status='SUCCESS' AND coalesce(x.document_kind,'')<>'AI_SUMMARY' AND x.file_name !~* 'ai[ _-]*summary'
 AND coalesce(x.extraction_metadata->>'unsupported_type','false')<>'true'
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(x.extracted_text,'[[:space:]]+',' ','g')))>0))
 OR (p_evidence->>'chunk_id'='LISTING' AND EXISTS(
 SELECT 1 FROM public.agenttender_tenders t CROSS JOIN public.agenttender_eligibility_rules r
 WHERE t.id=p_tender AND r.code=p_evidence->>'rule_code' AND r.enabled AND nullif(r.approval_source,'') IS NOT NULL AND r.approval_source<>'PENDING_APPROVAL'
 AND ((p_evidence->>'establishes'='SOFTWARE_SCOPE' AND r.code LIKE 'FIT_%' AND r.decision<>'NO_GO')
 OR (p_evidence->>'establishes'='EXCLUSION' AND r.decision='NO_GO'
 AND r.code IN ('HARDWARE','MANPOWER','NON_IT_SERVICES','TRAINING_ONLY','SOFTWARE_RESALE','STANDALONE_SOFTWARE_AMC','KIOSK','PROPRIETARY_ONLY','PAC_PROPRIETARY_PRODUCT','CCTV_GPS_CONTROL_ROOM','GIS_SURVEY_PROCESSING','TELECOM_NETWORK_INFRASTRUCTURE','SPEECH_DATA_COLLECTION_TRANSCRIPTION','CYBER_SECURITY','SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL','INDUSTRIAL_MONITORING_DATA_TRANSMISSION_AMC','ICCC_EXISTING_O_AND_M','READY_MADE_SOFTWARE')))
 AND position(lower(regexp_replace(btrim(coalesce(p_evidence->>'excerpt',p_evidence->>'quote','')),'[[:space:]]+',' ','g'))
 IN lower(regexp_replace(concat_ws(' ',t.title,t.description),'[[:space:]]+',' ','g')))>0))
);
$function$

;
