-- Only records created by the source extractor carry qualification.version.
-- Refresh its own structured fields while leaving owner-entered projects intact.
DO $migration$
DECLARE definition text;old_text text:=$old$SET qualification=p->'qualification',document_ids=$old$;
BEGIN
 SELECT pg_get_functiondef('public.agenttender_commit_company_credentials(uuid,uuid,text,jsonb,jsonb,jsonb)'::regprocedure) INTO definition;
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Unexpected credential commit implementation'; END IF;
 definition:=replace(definition,old_text,$new$SET qualification=p->'qualification',project_value_inr=(p->>'project_value_inr')::numeric,start_date=(p->>'start_date')::date,end_date=(p->>'end_date')::date,project_status=p->>'project_status',description=p->>'description',nature_of_work=p->'nature_of_work',project_type=p->>'project_type',document_ids=$new$);
 EXECUTE definition;
END $migration$;
