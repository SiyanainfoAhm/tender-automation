-- Reuse the five existing company evidence tables. No second evidence store.
DO $retire$
BEGIN
 IF to_regclass('public.agenttender_company_qualification_evidence') IS NOT NULL THEN
  LOCK TABLE public.agenttender_company_qualification_evidence IN ACCESS EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.agenttender_company_qualification_evidence) THEN
   RAISE EXCEPTION 'Refusing to retire a nonempty qualification evidence table';
  END IF;
  -- RESTRICT refuses external views/FKs; check string-bodied routines too.
  IF EXISTS(SELECT 1 FROM pg_proc WHERE prosrc ILIKE '%agenttender_company_qualification_evidence%') THEN
   RAISE EXCEPTION 'Qualification evidence table is referenced by a routine';
  END IF;
  DROP TABLE public.agenttender_company_qualification_evidence RESTRICT;
 END IF;
END $retire$;
ALTER TABLE public.agenttender_company_experience ADD COLUMN IF NOT EXISTS qualification jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.agenttender_company_experience.qualification IS 'Source-backed legal entity, contract identity, completion evidence, currency and verification metadata. Existing project records remain authoritative.';
CREATE UNIQUE INDEX IF NOT EXISTS agenttender_experience_extracted_project_key ON public.agenttender_company_experience(company_id,(qualification->>'project_key')) WHERE qualification ? 'project_key';
CREATE OR REPLACE FUNCTION public.agenttender_company_credential_sources(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
SELECT jsonb_build_object('company_name',(SELECT name FROM public.agenttender_companies WHERE id=p_company_id),
 'facts',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM public.agenttender_ai_company_facts f WHERE company_id=p_company_id AND fact_key LIKE 'financial.turnover:%'),'[]'::jsonb),
 'projects',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM public.agenttender_company_experience e WHERE company_id=p_company_id AND status='active'),'[]'::jsonb),
 'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'company_id',d.company_id,'name',d.name,'document_category',d.document_category,'financial_year',d.financial_year,'verification_status',d.verification_status,'expiry_date',d.expiry_date,'extracted_text',t.extracted_text,'extraction_status',t.extraction_status,'source_fingerprint',t.source_fingerprint,'qualification_extraction',CASE WHEN t.extraction_metadata->'qualification'->>'source_fingerprint'=t.source_fingerprint THEN t.extraction_metadata->'qualification' ELSE null END) ORDER BY d.name)
 FROM public.agenttender_company_documents d JOIN public.agenttender_company_document_texts t ON t.document_id=d.id AND t.company_id=d.company_id
 WHERE d.company_id=p_company_id AND d.status='active' AND d.ai_index_enabled IS NOT FALSE AND coalesce(d.verification_status,'pending') NOT IN ('rejected','invalid') AND coalesce(t.source_metadata->>'evidence_role','COMPANY_DOCUMENT')='COMPANY_DOCUMENT' AND t.source_fingerprint=public.agenttender_company_source_fingerprint(d)),'[]'::jsonb));
$fn$;
REVOKE ALL ON FUNCTION public.agenttender_company_credential_sources(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_company_credential_sources(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.agenttender_commit_company_credentials(p_company_id uuid,p_document_id uuid,p_fingerprint text,p_facts jsonb,p_projects jsonb,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE d public.agenttender_company_documents; t public.agenttender_company_document_texts; f jsonb;p jsonb;existing_id uuid; nf integer:=0;np integer:=0;
BEGIN
 SELECT * INTO d FROM public.agenttender_company_documents WHERE id=p_document_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR d.status<>'active' OR d.ai_index_enabled IS FALSE OR d.verification_status IN ('rejected','invalid') THEN RAISE EXCEPTION 'Company source ineligible'; END IF;
 SELECT * INTO t FROM public.agenttender_company_document_texts WHERE document_id=p_document_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR t.extraction_status<>'READY' OR t.source_fingerprint IS DISTINCT FROM p_fingerprint OR p_fingerprint IS DISTINCT FROM public.agenttender_company_source_fingerprint(d) OR coalesce(t.source_metadata->>'evidence_role','COMPANY_DOCUMENT')<>'COMPANY_DOCUMENT' THEN RAISE EXCEPTION 'Company source changed or incomplete'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
  IF f->>'fact_key' NOT LIKE 'financial.turnover:%' OR f->'fact'->>'source_document_id'<>d.id::text OR f->'fact'->>'source_fingerprint'<>p_fingerprint OR position(f->'fact'->>'quote' IN t.extracted_text)=0 THEN RAISE EXCEPTION 'Unbound financial fact'; END IF;
  INSERT INTO public.agenttender_ai_company_facts(company_id,fact_key,category,fact,evidence_document_ids,verification_state,reviewed_at)
  VALUES(p_company_id,f->>'fact_key','FINANCIAL',f->'fact',ARRAY[d.id],f->>'verification_state',(f->>'reviewed_at')::timestamptz)
  ON CONFLICT(company_id,fact_key) DO UPDATE SET fact=excluded.fact,evidence_document_ids=excluded.evidence_document_ids,verification_state=excluded.verification_state,reviewed_at=excluded.reviewed_at,updated_at=now()
  WHERE public.agenttender_ai_company_facts.fact->>'version' IS NOT NULL;
  nf:=nf+1;
 END LOOP;
 FOR p IN SELECT value FROM jsonb_array_elements(p_projects) LOOP
  IF coalesce(p->'qualification'->>'project_key','')='' OR p->>'company_id'<>p_company_id::text THEN RAISE EXCEPTION 'Unbound experience'; END IF;
  SELECT id INTO existing_id FROM public.agenttender_company_experience e WHERE company_id=p_company_id AND (e.qualification->>'project_key'=p->'qualification'->>'project_key' OR (lower(trim(e.client_name))=lower(trim(p->>'client_name')) AND lower(trim(e.project_name))=lower(trim(p->>'project_name')))) LIMIT 1;
  IF existing_id IS NULL THEN
   INSERT INTO public.agenttender_company_experience(company_id,project_name,client_name,project_value_inr,start_date,end_date,description,document_ids,nature_of_work,project_status,project_type,status,qualification)
   VALUES(p_company_id,p->>'project_name',p->>'client_name',(p->>'project_value_inr')::numeric,(p->>'start_date')::date,(p->>'end_date')::date,p->>'description',ARRAY[d.id],p->'nature_of_work',p->>'project_status',p->>'project_type','active',p->'qualification')
   ON CONFLICT DO NOTHING;
  ELSE
   -- Preserve owner-entered fields, original document links and archived records.
   UPDATE public.agenttender_company_experience SET qualification=p->'qualification',document_ids=ARRAY(SELECT DISTINCT unnest(coalesce(document_ids,'{}'::uuid[])||ARRAY[d.id])),updated_at=now() WHERE id=existing_id AND qualification ? 'version' AND status='active';
  END IF;
  np:=np+1;
 END LOOP;
 UPDATE public.agenttender_company_document_texts SET extraction_metadata=coalesce(extraction_metadata,'{}'::jsonb)||jsonb_build_object('qualification',p_metadata) WHERE document_id=d.id;
 RETURN jsonb_build_object('facts',nf,'projects',np);
END $fn$;
REVOKE ALL ON FUNCTION public.agenttender_commit_company_credentials(uuid,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenttender_commit_company_credentials(uuid,uuid,text,jsonb,jsonb,jsonb) TO service_role;
