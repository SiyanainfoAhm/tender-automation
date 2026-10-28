# Tender-specific Ask AI qualification repair — 28 October 2026

Tender: 105631192, Sri Padmavati Mahila Visvavidyalayam website revamp.
Project: `fvveqziyusjgqejowkfp`.

## Verified defects

- Both stored source extractions are SUCCESS but have null `tender_id` and `document_id`. The PDF has 17 readable text-layer pages (33,441 characters); the spreadsheet has 406 characters. The existing index contains 111 active chunks. The original report's no-text observation is historical: chunks were created by the existing pipeline before this repair. No OCR recovery is claimed here.
- The coverage query required both missing foreign keys and therefore mislabeled successful native extraction as missing/failed OCR.
- Unresolved evidence was mapped to CONDITIONAL_GO, with 13 automatically inserted category placeholders.
- The first long company documents could exhaust the 100,000-character budget and exclude later sources.
- A percentage EMD could receive PASS without a known quote price/payment. Generic government-project matching could lose an educational-institution or multiple-purchase-order restriction.
- The model could omit tax and digital-signature conditions outside the main eligibility table. The internal `read_only` flag did not bypass durable-chat writes.

## Changes

The existing retrieval adapter resolves legacy extractions only through the canonical source tender ID and exact filenames containing a company-owned document UUID. No filename-only fuzzy match or cross-company search is used. Partial/missing pages still prevent complete coverage; short scans and retrieval errors remain explicit.

The shared advisory policy returns GO, NO_GO or NOT_VERIFIED. No recorded business status is written. Source-free placeholder rows are removed, while source-backed missing evidence remains UNKNOWN. The score is a disclosed evidence-completion measure (verified mandatory checks divided by identified mandatory checks), not a calibrated probability of winning. Incomplete coverage is capped at 49, unresolved assessments at 99; GO is 100 and confirmed NO_GO is 0.

Every retrieved company candidate receives a bounded excerpt. Existing verified full-document financial/project/certificate calculations remain separate. Excerpts are not claimed to be an exhaustive library review. Original incorporation certificates can be checked by legal entity, statutory wording and CIN. Percentage EMD requires verified company payment/base evidence. Unsupported educational-client and aggregate-purchase-order comparisons remain UNKNOWN instead of being weakened to generic project matching. Explicit tax receipts, digital authentication, portal registration and transaction-fee instructions have a source-backed omission guard.

The internal diagnostic path skips conversation persistence only for an authenticated service-role request and retains downstream user, membership, company and document-permission checks.

## Verification and deployment

99 automated tests passed across qualification normalization, financial/project evidence, company retrieval, global chat, orchestration safeguards and the tender-specific regression suite. `git diff --check` passed.

Production function `agenttender-orch-v2-chat` is deployed as version 72. Version 70's live authenticated read-only check returned HTTP 200 with both sources and all 111 chunks reviewed; no false extraction/OCR warning remained. Final version verification is recorded in the task's output report.

Initial deployment attempts timed out fetching the existing JSR type-only runtime declaration. Removing that runtime import allowed Supabase bundling to succeed; runtime globals and existing authentication were retained.

No schema migration, new table, OCR run, status change, company-fact promotion, new service or frontend deployment was performed. Only the tender-chat function was deployed. Global chat and rules-evaluator deployments remain unchanged; they import these shared source modules on a future deployment.

## Evidence limitations

The RFP requires at least INR 1 million in **each** FY 2023–24, 2024–25 and 2025–26. The required latest year is unverified and another required year's original figures conflict. Experience must preserve government **educational** clients, the stated fiscal years and single/multiple purchase-order wording. The existing structured project model cannot certify those exact restrictions. Missing proof is not a confirmed failure.

The underlying source parser reports text-layer completeness, not visual completeness; no new visual OCR certification is claimed. The assessment remains bounded and advisory. Authenticated browser rendering and a full frontend build are not claimed as tested.

