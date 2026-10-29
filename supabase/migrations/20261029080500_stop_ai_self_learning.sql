-- User decision 2026-10-29: stop the AI learning by itself.
-- Already applied to production (VBDC); recorded here so the repo matches.
-- Turns off the continuous-learning jobs and the triggers that feed their queues.
-- Already-verified knowledge (103 records) stays and nothing is deleted.
-- Also: tender-category-review-scheduler switched off (its review batches were never processed).
-- Re-enable by setting active := true / ENABLE TRIGGER.
do $$
declare j text;
begin
  foreach j in array array[
    'agenttender-cl-knowledge-embedder',
    'agenttender-cl-candidate-classification',
    'agenttender-cl-evidence-validation',
    'agenttender-cl-evidence-ai-bounded',
    'agenttender-cl-health-monitor',
    'agenttender-cl-structural-source-review',
    'agenttender-learning-collection-hourly-minute-30',
    'agenttender-learning-validate-0100-ist',
    'agenttender-learning-rules-0200-ist',
    'agenttender-learning-suggestions-0215-ist',
    'agenttender-learning-responses-0300-ist',
    'tender-category-review-scheduler'
  ] loop
    perform cron.alter_job(job_id := (select jobid from cron.job where jobname = j), active := false);
  end loop;
end $$;

alter table public.agenttender_ai_company_facts disable trigger cl_capture_changes;
alter table public.agenttender_ai_review_examples disable trigger cl_capture_changes;
alter table public.agenttender_bid_checklist_items disable trigger cl_capture_changes;
alter table public.agenttender_company_documents disable trigger cl_capture_changes;
alter table public.agenttender_decision_learning disable trigger cl_capture_changes;
alter table public.agenttender_orch_decision_knowledge disable trigger cl_capture_changes;
alter table public.agenttender_rule_feedback disable trigger cl_capture_changes;
alter table public.agenttender_won_projects disable trigger cl_capture_changes;
alter table public.agenttender_bid_checklist_items disable trigger cl_capture_checklist_correction;
alter table public.agenttender_bid_checklist_items disable trigger agenttender_checklist_rule_learning;
alter table public.agenttender_company_documents disable trigger agenttender_company_rule_learning;
