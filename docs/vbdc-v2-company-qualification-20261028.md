# Existing VBDC V2 company qualification — 28 October 2026

Implemented in the existing company text worker, rules-first evaluator, tender chat and global chat. No additional chatbot, evidence table or qualification service was introduced.

## Source and persistence

- Reuses `agenttender_ai_company_facts`, `agenttender_company_experience`, `agenttender_company_documents`, `agenttender_company_document_texts`, and `agenttender_company_document_text_chunks`.
- The empty `agenttender_company_qualification_evidence` table was inspected for records, PostgreSQL dependencies and string-bodied routine references. A tracked migration retires it using a locked emptiness check and `DROP ... RESTRICT`.
- Existing source extraction was already READY for 157 documents. Native/OCR text and original page markers are reused; valid text is not sent through OCR again. Original files and metadata remain intact.
- The existing minute-based company-text worker incrementally extracts credentials after native extraction and on idle ticks. Version/fingerprint metadata prevents repeated successful extraction. Internal targeted rechecks are available for evidence corrections.
- Financial fact keys are stable per normalized entity, financial year and original document. Duplicate documents do not multiply annual values in arithmetic. Contradictory source values block certification.
- Projects are stored in the existing experience table with a normalized source contract key and attached qualification metadata. Retries are idempotent. Existing owner-created/archived projects are preserved. Extractor-owned fields can be refreshed when original evidence changes.
- Source reads and credential commits are invoker functions restricted to `service_role`; fresh fingerprint, company, status, extraction and source-role checks run before committing. Company chat permission remains mandatory.

## Calculations and qualification

The shared `company-qualification.mjs` module supplies annual average, each-year minimum, cumulative and explicitly requested highest-year turnover, and detects missing years. Only verified, audited turnover/revenue-from-operations facts in the correct legal entity can establish a value. Profit/assets/other income cannot substitute. Hundreds and Indian numerical groups are normalized; detailed copies take precedence over rounded copies in the same document.

The shared project matcher checks distinct projects, actual supported functionality, minimum INR value, required count, client category, completion evidence and date window. Payroll or contract-management systems do not qualify as websites simply because they use the acronym CMS. Foreign-currency values remain unresolved until a defensible conversion basis is supplied. An award, planned date or conditional-payment clause cannot establish completion.

Financial-year windows are calculated against the tender closing date, not selected from whatever accounts happen to be present. Rolling experience windows and completed Indian financial-year windows are distinct. Unsupported/ambiguous criteria remain UNKNOWN. Percentage-of-estimated-cost criteria remain UNKNOWN when the original estimated cost is absent.

Certification verification checks the actual credential identifier and legal entity on the original page. Each page in a bundled certificate file is assessed separately: one certificate cannot borrow another certificate's expiry. A recertification date does not extend a past certificate-expiry date. An incorporation CIN cannot stand in for PAN/GST. Audited accounts alone do not prove filed tax returns for all required years.

Both existing chatbots use the same arithmetic, source loader and qualification normalizer. Direct company-turnover questions can calculate explicit years without inventing an RFP. RFP qualification uses the existing original-clause extraction and deterministic PASS/FAIL/UNKNOWN normalization followed by the existing owner decision policy. Global streaming progress and saved-conversation behavior are retained. Tender chat retains its existing JSON transport. All qualification outputs are advisory and perform zero tender-status writes.

Related companies' turnover/experience is excluded from the bidder's calculations. Related-company credential aggregation is conservatively UNKNOWN; this release does not automatically pool related-company credentials even where a permission clause might warrant a separate legal review.

## Production evidence results

The detailed amounts and original evidence remain in the company system rather than being copied into this public repository.

| Result | Count |
| --- | ---: |
| Verified financial years | 5, FY 2020–21 through FY 2024–25 |
| New verified financial fact records | 10 |
| Candidate annual fact records | 3 |
| Distinct active identified projects | 12 |
| Projects with linked completion evidence | 5 |
| Projects without proven completion | 7 |
| Document-level unresolved extraction/evidence flags | 11 |

These are source fact records, not ten distinct annual turnover values. The five years are deduplicated during arithmetic. The evidence flags include redundant/ambiguous financial layouts, legal-entity uncertainty, a foreign vendor's work order and three unresolved USD-to-INR conversions. Separate business blockers include a disputed annual value and missing verified FY 2025–26 accounts. Missing completion evidence is reported per project rather than being silently promoted.

Two completed private website/CMS projects satisfy a source-backed sample requiring two projects of at least INR 1 million since April 2021. Actual tender eligibility still requires the RFP's category, functional scope, value and period. The live Shanghai example remains advisory CONDITIONAL_GO because its latest required financial-year set is incomplete/contradictory and other mandatory evidence is unresolved; its recorded manual GO is preserved.

## Validation

78 automated regression tests passed:

```sh
node --test tests/company-qualification.test.mjs tests/company-retrieval.test.mjs \
  supabase/functions/agenttender-orch-v2-chat/qualification.test.mjs \
  supabase/functions/agenttender-orch-v2-global-chat/*.test.mjs \
  supabase/functions/agenttender-orch-v2-worker/progressive.test.mjs
```

Coverage includes three-year averages, missing years, all aggregation methods, currency/units, duplicate facts/projects, contradictory values, different legal entities, multiple qualifying projects, misleading functional overlap, absent completion certificates, relative date windows, expired/bundled certificates, PAN/GST mismatch, missing original RFP, authorization, global/tender calculation consistency, streaming, pagination and existing V2 decision safeguards. Syntax checks and `git diff --check` passed.

Production HTTP checks confirmed both chatbots return the same verified average for the same explicit years and the same missing-year/conflict outcome for the latest required years. Both identify the Shanghai tender as advisory CONDITIONAL_GO while preserving its recorded GO. The same matcher was checked against the live project records and identified the two qualifying INR website projects.

The before/after digest over all 19,831 tender IDs, workflow statuses, qualification statuses and decision sources is unchanged: `f9fc2c879aa5fe59dd3bc7cbca8db02b`. No tender decision, checklist, workspace, historical evaluation, original document or AI memory was reset. Security-advisor comparison added no notices (156 existing notices before and after).

## Deployed components

- `agenttender-company-text-index`
- `agenttender-rules-first-evaluator`
- `agenttender-orch-v2-chat`
- `agenttender-orch-v2-global-chat`

Both tracked migrations are applied. No frontend source change or frontend redeployment is required: the existing Next.js routes call these functions. The production frontend responds at its existing URL. Authenticated browser rendering and a full frontend rebuild are not claimed as tested.

Production bundling and real executions passed. Transient Supabase BOOT_ERROR/deployment failures and one statement timeout during parallel backfill were retried through the existing idempotent path; the affected source processing subsequently succeeded. No credentials or raw company documents are included in this repository change.
