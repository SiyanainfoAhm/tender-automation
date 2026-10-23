import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/adminClient", () => ({ createAdminSupabaseClient: vi.fn(), createTender247MirrorSupabaseClient: vi.fn() }));
import {
  directDocuments,
  isComplete,
  resolveCanonicalTenderCandidates,
  savedRawResponse,
  summarizeDocumentRecoveryCounts,
  resumeSavedTender247Run,
  recordManifestRecoveryWork,
  classifyTender247DocumentFailure,
  applyTender247Outcome,
  recordDocumentRecoveryOutcome,
} from "@/server/tender247/savedRunResume";
import { mapTender } from "@/server/tender247/sync";

describe("Tender247 saved-run recovery guards", () => {
  const rawResponse = {
    Success: true,
    Data: [{
      tenderid: 105068326,
      sourcetenderid: "source-only-reference",
      location: [{ city: "Thanjavur", state: "Tamil Nadu", country: "India" }],
      documents: [{ name: "notice.pdf", type: "OTHER", documentid: 214984969, downloadLink: "https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/ABC12345" }],
    }],
  };

  it("accepts only persisted successful rawResponse and never needs a feed result", () => {
    expect(savedRawResponse({ id: "run", company_id: "company", run_date: "2026-10-08", summary: { rawResponse } })).toBe(rawResponse);
    expect(() => savedRawResponse({ id: "run", company_id: "company", run_date: "2026-10-08", summary: {} })).toThrow("rawResponse");
  });

  it("uses saved direct document identities and considers both SharePoint fields required", () => {
    expect(directDocuments(rawResponse.Data[0])).toEqual([{ documentid: "214984969", filename: "notice.pdf", contentType: "application/octet-stream", token: "ABC12345", size: null }]);
    expect(isComplete({ storage_url: "https://sharepoint.example/item", sharepoint_drive_item_id: "drive-item" })).toBe(true);
    expect(isComplete({ storage_url: "https://sharepoint.example/item", sharepoint_drive_item_id: null })).toBe(false);
  });

  it("keeps the saved scraped date and Tender247 tenderid mapping semantics", () => {
    const mapped = mapTender(rawResponse.Data[0], "2026-10-08");
    expect(mapped).toMatchObject({ source_tender_id: "105068326", scraped_date: "2026-10-08", city: "Thanjavur", state: "Tamil Nadu" });
    expect(mapped?.source_tender_id).not.toBe("source-only-reference");
  });

  const candidate = (id: string, scrapedDate: string | null) => ({
    id, qualification_status: "VERIFY", source_portal: "TENDER247", source_region: "INDIAN",
    source_tender_id: "101074816", scraped_date: scrapedDate, raw_metadata: {},
  });

  it("resolves exactly one canonical match without any single-row query semantics", () => {
    const result = resolveCanonicalTenderCandidates([candidate("only", "2026-10-08")], "2026-10-08");
    expect(result).toMatchObject({ kind: "resolved", tender: { id: "only" }, duplicate: false });
  });

  it("reports zero canonical matches explicitly", () => {
    expect(resolveCanonicalTenderCandidates([], "2026-10-08")).toEqual({ kind: "missing" });
  });

  it("deterministically prefers the one exact saved-date match among duplicates", () => {
    const result = resolveCanonicalTenderCandidates([
      candidate("historical", "2026-10-07"), candidate("saved-date", "2026-10-08"),
    ], "2026-10-08");
    expect(result).toMatchObject({ kind: "resolved", tender: { id: "saved-date" }, duplicate: true });
  });

  it("keeps genuinely ambiguous canonical duplicates unresolved and lists every candidate", () => {
    expect(resolveCanonicalTenderCandidates([
      candidate("b", "2026-10-08"), candidate("a", "2026-10-08"),
    ], "2026-10-08")).toEqual({ kind: "ambiguous", candidateIds: ["a", "b"] });
  });

  it("discovers incomplete documents while skipping completed documents", () => {
    expect(summarizeDocumentRecoveryCounts([
      { storage_url: "https://sharepoint.example/complete", sharepoint_drive_item_id: "drive-item" },
      { storage_url: null, sharepoint_drive_item_id: "drive-item" },
      { storage_url: "https://sharepoint.example/missing-drive", sharepoint_drive_item_id: null },
      { storage_url: null, sharepoint_drive_item_id: null },
    ])).toEqual({
      totalCanonicalTender247Documents: 4, complete: 1, storageUrlNull: 2,
      sharepointDriveItemIdNull: 2, eitherIncomplete: 3, bothIncomplete: 1,
    });
  });

  it("persists a manifest failure as durable pending work independently of documents", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordManifestRecoveryWork({ rpc } as never, "run-id", "canonical-id", "105172859", "PENDING", "Tender247 manifest gateway failed (HTTP 502)");
    expect(rpc).toHaveBeenCalledWith("agenttender_record_tender247_manifest_recovery_work", {
      p_run_id: "run-id", p_canonical_tender_id: "canonical-id", p_tender247_tender_id: "105172859",
      p_status: "PENDING", p_last_error: "Tender247 manifest gateway failed (HTTP 502)",
    });
  });

  it("separates verified source blocks from Graph and transient application failures", () => {
    expect(classifyTender247DocumentFailure(new Error("DOCUMENT_STAGE_EMPTY"))).toBe("SOURCE_EMPTY");
    expect(classifyTender247DocumentFailure(new Error("DOCUMENT_PDF_EOF_INVALID"))).toBe("SOURCE_INVALID");
    expect(classifyTender247DocumentFailure(new Error("SharePoint chunk upload failed (HTTP 403)"))).toBe("UPLOAD_FAILED");
    expect(classifyTender247DocumentFailure(new Error("UPSTREAM_REQUEST_FAILED"))).toBe("RETRY_PENDING");
    const counts = { documentsSourceBlocked: 0, documentsRetryPending: 0, documentsUploadFailed: 0, documentsInternalFailed: 0 };
    applyTender247Outcome(counts, "SOURCE_EMPTY"); applyTender247Outcome(counts, "UPLOAD_FAILED");
    expect(counts).toEqual({ documentsSourceBlocked: 1, documentsRetryPending: 0, documentsUploadFailed: 1, documentsInternalFailed: 0 });
  });

  it("invokes the migrated document-outcome RPC for terminal recovery", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordDocumentRecoveryOutcome({ rpc } as never, "run-id", "canonical-id", "105172859", { documentid: "external-id", filename: "safe.pdf", token: "ABCDEFGH", contentType: "application/pdf", size: null }, "RECONCILED", null, { sharepoint_drive_item_id: "drive-item", storage_url: "https://sharepoint.example/safe" } as never);
    expect(rpc).toHaveBeenCalledWith("agenttender_record_tender247_document_recovery_outcome", expect.objectContaining({ p_run_id: "run-id", p_status: "RECONCILED", p_external_document_id: "external-id", p_sharepoint_drive_item_id: "drive-item" }));
  });

  it("selects only persisted incomplete canonical rows and keeps feed calls at zero", async () => {
    const savedRun = { id: "saved-run", company_id: "company", run_date: "2026-10-08", summary: { rawResponse } };
    const resolved = candidate("canonical-id", "2026-10-08");
    let documentSelects = 0;
    const db = {
      from: (table: string) => {
        if (table === "agenttender_pipeline_runs") {
          const query = { eq: () => query, maybeSingle: async () => ({ data: savedRun, error: null }) };
          return { select: () => query };
        }
        if (table === "agenttender_tenders") {
          const query = { eq: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: [resolved], error: null }) };
          return { select: () => query };
        }
        if (table === "agenttender_tender_documents") {
          return {
            select: (columns: string) => {
              documentSelects += 1;
              const data = columns.includes("file_size_bytes")
                ? []
                : columns.includes("agenttender_tenders!inner")
                ? [{ storage_url: null, sharepoint_drive_item_id: "existing-drive-item" }]
                : [{
                  id: "complete-document", tender_id: "canonical-id", external_document_id: "214984969",
                  file_name: "notice.pdf", mime_type: "application/pdf",
                  storage_url: "https://sharepoint.example/complete", sharepoint_drive_item_id: "drive-item",
                  storage_status: "COMPLETED", completed_at: "2026-10-08T00:00:00.000Z",
                }];
              const query = {
                eq: () => query, or: () => query, order: () => query, range: () => query,
                then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
              };
              return query;
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await resumeSavedTender247Run("saved-run", { canonicalDb: db as never });

    expect(result).toMatchObject({
      documentsSelectedForRecovery: 0, tender247FeedApiCalls: 0,
      existingCanonicalTender247Documents: 1, existingIncompleteDocumentsSelected: 0,
      newCanonicalDocumentRowsCreated: 0,
      documentRecoveryCounts: { eitherIncomplete: 1 }, remainingIncompleteCanonicalDocuments: 1,
    });
    // Three recovery/count scans plus one saved-manifest reconciliation scan;
    // no Tender247 feed endpoint is called.
    expect(documentSelects).toBe(4);
  });
});
