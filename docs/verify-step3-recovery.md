# VERIFY / Step 3 recovery — 28 October 2026

The live baseline was 30 tenders, all blocked at orchestration Step 3: 17 source-acquisition errors, seven targeted-source waits, five evidence-refresh loops and one resource-limit failure. Twenty-eight had no scheduled retry. These counts differed from the earlier supplied snapshot.

The processing repair reviews every available text span and amendment in bounded, checkpointed calls. It retains an exact-quote clause ledger, records coverage gaps, distinguishes present annexures from missing external documents, and reuses text-identical evidence. Document count and excerpt limits no longer silently define Step 3 coverage. Provider-truncated responses remain incomplete; synthesis does not repeat or truncate the persisted clause inventory.

Verified identity/document-name/company-ownership joins repaired 21 legacy extraction associations across four tenders. Successful extraction and existing indexes were reused. Tender 105631192 retains its 111 chunks and both original sources; Annexures I and II are present on pages 13–14. Its qualification still requires documentary verification.

Source content, extraction completeness and association changes invalidate assessment caches and resume waiting jobs. Unchanged-evidence failures park until a dependency changes. Coverage continuation preserves recorded failure history and does not consume the old five-attempt retry budget. Vector completion is handled separately from changes to source evidence.

PDF preparation now uses the existing ingestion service, four pages per invocation with each page checkpointed. The resource-limited 166-page PDF resumed from its saved 40 pages, completed native extraction, recovered six weak pages with the existing OCR provider, and published 1,422 chunks through resumable 100-chunk batches. Staged batches stay inactive until the complete index can be published atomically. Existing successful OCR and byte-verified duplicate content are reused. Image notices are supported by the same authorized OCR service.

Live validation exposed a separate final-commit defect that converted a validator's VERIFY into CONDITIONAL_GO. The commit path now retains VERIFY and requires verified mandatory company findings before a positive qualification. The automatic promotions made during verification were revalidated by the normal pipeline, using current source evidence and audit/record revision checks. No direct qualification/workflow status reset was used. Existing decision audits remain intact.

## Deployed components

- `agenttender-orch-v2-worker`: 61
- `agenttender-orch-document-worker`: 27
- `agenttender-graph-extract-verify`: 41
- `agenttender-index-extractions`: 51
- `agenttender-tender-ocr-worker`: 25
- Database migrations in this change provide dependency wake-up, revision-aware claims, source-bound duplicate recovery, final validation guards and atomic index batches.

The live tender-specific chat deployment advanced independently to version 81. Its files are not changed by this repair. The PR changes none of those files and merges cleanly with the latest inspected main tree, preserving concurrent Ask AI changes and draft PR #3.

## Validation and remaining dependencies

30 JavaScript regression tests cover coverage, late annexures, stale revisions, exact evidence, bounded extraction, interruption/replay, saved native text and indexing batches. Transactional database regressions verify wake-up/cache invalidation, failure-history preservation, final VERIFY handling, partial-index visibility and replay. The new indexing RPC is service-only. Live processing advanced beyond Step 3; evidence-backed exclusions were committed by the existing normal rules, while missing proof remained VERIFY.

Tender247 portal acquisition is not restored by pretending an archive exists. The deployed acquisition service verifies SharePoint and legacy Azure access, but has no portal/gateway execution path. No company Tender247 account is configured in this project. The existing web import service expects `TENDER247_SYNC_ENDPOINT` (the authorized Azure gateway `/api/tender247/tenders` route) and `TENDER247_SYNC_UPSTREAM_SECRET`; upstream gateway authorization remains required. An authorized operator must connect/run that existing importer for genuinely missing source attachments, or upload those originals. Gateway credential validity could not be established through the available interfaces. Authentication was not bypassed.

See the task's user-facing per-tender report and audit snapshot for the final observed processing states, recovered evidence, exact remaining questions and next actions. Passing source review is not a finding of company compliance.
