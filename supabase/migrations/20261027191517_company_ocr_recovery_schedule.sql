SELECT cron.alter_job(jobid,schedule:='* * * * *') FROM cron.job WHERE jobname='agenttender-company-ocr-every-5-min';
ALTER FUNCTION public.agenttender_company_source_fingerprint(public.agenttender_company_documents) SET search_path TO pg_catalog, public;
