# VBDC V2 qualification repair — 28 October 2026

Project: `fvveqziyusjgqejowkfp`. Existing production: https://tender-automation-seven.vercel.app.

## Root causes verified against production

1. Global chat v15 silently retrieved evidence for only five PQ/conditional candidates, or three other candidates. The snapshot independently limited results to 30 without an actionable continuation cursor. PQ candidate selection was restricted to recorded GO; VERIFY selection ignored workflow VERIFY records carrying another qualification status.
2. Tender chat v56 removed original RFP filenames and inline references during presentation. It also refused a metadata-only report when the company had no stored document/chunk for a shared tender.
3. Short qualification questions drove company matching with generic terms. Reusing that generic semantic vector for every credential search repeatedly boosted general profiles over accounts, actual certificates and completion records.
4. BHU 104339554 had stored SharePoint documents but no active RFP chunks. Its technical specification required OCR. Navy 104337567 had 88 active document chunks and no local embeddings; four scanned PDF attachments had no usable text.
5. Index/OCR eligibility gates used qualification status and excluded records whose workflow was VERIFY but qualification status was NO_GO. The OCR worker also excluded CONDITIONAL_GO. These gates prevented evidence repair without changing the decision.
6. Native extraction emitted `[Page N]` markers, while the indexing parser recognized different markers. This lost page references for newly extracted PDFs.
7. The enabled EMD rule still had a INR 300,000 ceiling, conflicting with the user's explicit INR 500,000 policy. The existing rule was updated to version 9 with before/after snapshots retained in `agenttender_rule_versions`.

Company facts were rechecked: 563 facts comprise 16 VERIFIED, 546 CANDIDATE and one REJECTED. Those states do not describe the entire evidence library: 257 active source documents were marked verified and 56 pending. Candidate facts were not mass-rejected or promoted.

## Implementation and exact files

| Existing component | Files | Repair |
| --- | --- | --- |
| Tender chat | `supabase/functions/agenttender-orch-v2-chat/index.ts`, `analyst.ts`, `feedback.ts` | Route qualification and partnership questions into the shared advisory matrix; preserve identity, role checks and durable chat memory; scoped source reads; metadata-only reports when RFP is missing; original source cards. |
| Existing policy and presentation | `supabase/functions/agenttender-orch-v2-chat/policy.mjs`, `presentation.mjs` | Deterministic GO/CONDITIONAL_GO/NO_GO aggregation; preserve document names and page references. |
| Shared advisory report | `supabase/functions/agenttender-orch-v2-chat/qualification.mjs` | Mandatory/optional/unknown applicability, PASS/FAIL/UNKNOWN, exact source-quote validation, source verification/expiry checks, partner permission and proof requirements, explicit limitations and actions. No business-status writes. |
| Global chat | `supabase/functions/agenttender-orch-v2-global-chat/index.ts`, `analyst.ts` | Same evaluator and canonical retrieval implementation; exact source tender IDs; two deep assessments per response; explicit matching counts, company/user-scoped continuation memory and offset. |
| DB adapter | `supabase/functions/agenttender-db-chat/index.ts` | Preserve forwarding to V2; reject conflicting client-supplied identity; retain full evidence separately from mobile preview. |
| Rules evaluator | `supabase/functions/agenttender-rules-first-evaluator/index.ts` | Use the same canonical policy module; read-only qualification policy probe. Existing automated screening behavior retained. |
| Native indexing | `supabase/functions/agenttender-index-extractions/index.ts`, `structure.ts`, `common.ts` | Repair workflow/qualification gates, targeted existing-worker reprocessing and native page markers; preserve already valid OCR chunks on targeted repairs. `common.ts` records the existing deployed dependency in Git. |
| OCR | `supabase/functions/agenttender-tender-ocr-worker/index.ts`, `structure.ts`, `ocr-core.mjs` | Accept eligible workflow records and existing active chat preparation without changing decisions. Existing Azure OCR and byte-identical duplicate detection reused. The latter two files record existing deployed dependencies in Git. |
| Database | `supabase/migrations/20261028020712_repair_v2_qualification_retrieval.sql` | Existing snapshot pagination/source-ID lookup, workflow VERIFY support, existing indexing/embedding gates and identical-source commit preservation. No new tables. |
| Approved EMD policy | `supabase/migrations/20261028021645_align_approved_emd_ceiling.sql` | Existing EMD rule raised to INR 500,000 with version history preserved. |
| Automated regression coverage | `supabase/functions/agenttender-orch-v2-chat/qualification.test.mjs`, `supabase/functions/agenttender-orch-v2-global-chat/handler.test.mjs`, `tests/company-retrieval.test.mjs` | Decision/evidence validation, source names/pages, company authorization, pagination, request concurrency, financial/experience gaps, certifications, EMD and CERT delivery-firm interpretation. |

## Qualification behavior

Both existing chatbots retrieve original tender text and company evidence, extract the mandatory criteria, validate quoted evidence against the actual retrieved source, and aggregate a fresh advisory decision using the shared policy. Existing recorded statuses are shown separately. Business statuses never change as a result of this assessment.

GO requires positive software fit, complete reviewed RFP coverage, complete mandatory-criteria extraction and verified satisfaction of every mandatory condition. A confirmed source-backed mandatory failure or approved binding exclusion produces NO_GO. Missing proof remains UNKNOWN and produces CONDITIONAL_GO pending resolution. An unavailable RFP cannot be certified. Checklists do not prove or disprove eligibility.

Credential comparisons require current verified source-document proof. Pending documents remain leads. Cross-company, inactive, disabled-for-evidence, expired and rejected sources cannot establish compliance. Financial documents must prove the actual values and years; document inventory is not financial proof. A partner can establish compliance only with an explicit original permission clause and verified evidence.

Existing semantic retrieval and lexical fallback remain in use. Deep RFP review is bounded at 400 chunks / 180,000 characters; company evidence at 100,000 characters. Limits and remaining unknowns are disclosed. Company credential searches use targeted lexical queries instead of repeatedly applying a general qualification vector. Company search limits are distinguished from original RFP extraction completeness.

## Document repair results

| Tender | Final original RFP chunks | Local embeddings | Repair |
| --- | ---: | ---: | --- |
| BHU 104339554 | 76 | 76 | Downloaded/extracted stored main PDFs and corrigenda; OCR recovered the four-page technical specification; duplicate specification reused without another OCR charge; repaired native page references. |
| Navy 104337567 | 79 | 79 | OCR recovered four scanned attachments (seven pages); duplicate attachments reused the completed OCR; indexed all stored originals and generated missing vectors through the existing local embedding worker. |

These counts exclude listing HTML marked as metadata. The active shared index also contains two such metadata chunks per example. XLSX source references retain an unavailable-page indicator; no page numbers are fabricated. Historical chunks remain stored when reprocessing supersedes them.

## Tests and production verification

56 automated tests passed using:

```sh
node --test tests/company-retrieval.test.mjs \
  supabase/functions/agenttender-orch-v2-chat/qualification.test.mjs \
  supabase/functions/agenttender-orch-v2-global-chat/*.test.mjs \
  supabase/functions/agenttender-orch-v2-worker/progressive.test.mjs
```

Syntax checks and `git diff --check` passed. Full Deno dependency/type checking could not finish because this environment could not fetch registry dependencies; successful Supabase bundle deployment and actual production executions were checked separately.

| Production case | Observed result |
| --- | --- |
| BHU, both chatbots | NO_GO based on the recovered equipment/hardware supply specification, not its medical industry label. The specification also requires CE/US-FDA/BIS certification at quotation. Missing product/company certifications remain UNKNOWN. Conflicting stored and recorded deadlines remain UNKNOWN. |
| Navy, both chatbots | NO_GO under the active standalone software AMC exclusion, with expired stored deadlines also identified. The recovered requirement is quarterly assessment by a CERT-empanelled firm; that clause alone does not require bidder-level empanelment. Partner permission and qualifying proof remain unverified. |
| Suitable custom website 105592468 | Software fit PASS; advisory CONDITIONAL_GO because mandatory experience and other company proof remain unresolved. |
| Manually approved GO 105600761 | Fresh advisory CONDITIONAL_GO; recorded GO retained. Turnover, relevant completed experience and MeitY-empanelled hosting arrangement are compared separately. |
| Hardware-dominant 105360693 | NO_GO based on desktop hardware procurement with a bundled productivity suite. |
| Mandatory OEM/MeitY CSP / high turnover 105570914 | UNKNOWN evidence gaps and CONDITIONAL_GO; large-document limits are disclosed. Missing CSP/OEM evidence is not invented or treated as an automatic company failure. |
| Missing RFP, BIDPRIME:a31cdbf6-3892-4103-9ef1-a16cea75c7b3 | Explicitly limited report, all 13 applicability categories UNKNOWN, no invented RFP clauses. Recorded NO_GO/NO_BID retained. |
| Multiple workflow VERIFY examples | Both examples assessed in one global response; two matching, two assessed, zero failed. |
| Pagination / concurrency | Automated handler test traverses all 12 candidates across six explicit batches; no duplicate/omitted candidate and maximum two concurrent assessments. Live snapshot returns 85 matching VERIFY records and accepts offsets. |
| No authentication | Production HTTP 401. |
| Cross-company document/qualification request | Production HTTP 403. |

Two initial parallel smoke requests received transient BOOT_ERROR responses; subsequent read-only retries succeeded. No persistent code startup failure was reproduced.

Before and after implementation, all 19,831 tender records had the same digest over ID, workflow status, qualification status and decision source: `be039a771baeafc189995dc2a27a6f1f`. No manually approved decision changed. No company documents, conversations, checklists, workspaces, history tables or permissions were deleted or reset.

## Deployment

| Function | Verified active version |
| --- | ---: |
| `agenttender-orch-v2-chat` | 61 |
| `agenttender-orch-v2-global-chat` | 20 |
| `agenttender-db-chat` | 36 |
| `agenttender-rules-first-evaluator` | 40 |
| `agenttender-index-extractions` | 50 |
| `agenttender-tender-ocr-worker` | 20 |

Deployed file contents were compared with the repository bundle. Both SQL migrations were applied. The local embedding worker was reused without a code deployment.

No Next.js source change was required. The existing frontend routes forward global chat to `agenttender-orch-v2-global-chat` and tender chat through `agenttender-db-chat` to V2. Production frontend loads and its unauthenticated chat route correctly returns HTTP 401. A signed-in browser session was unavailable, so authenticated browser rendering is not claimed as tested.

## Remaining evidence limitations

- Latest official GeM deadline/amendment verification is still required where stored documents conflict with recorded dates. Stored Navy corrigenda establish 19 October while the database records 27 October; stored BHU dates differ from recorded 29 October. No later official amendment was invented or inserted.
- Some required company evidence remains unresolved, including tender-specific product/OEM qualifications and fiscal-year/project comparisons. Reports identify the missing proof and next action.
- Large RFPs and company search results remain bounded with explicit disclosures and UNKNOWN findings where coverage is insufficient. The global continuation workflow must be used to assess additional matching tenders.
