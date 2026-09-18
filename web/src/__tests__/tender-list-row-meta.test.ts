import { describe, expect, it } from "vitest";

import {
  tenderListHasAiSummary,
  tenderListHasDocuments,
  tenderListPrescreenReason,
} from "@/lib/tenders/list-row-meta";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

function row(partial: Partial<WebTenderListRow>): WebTenderListRow {
  return {
    id: "1",
    source_portal: "TENDER247",
    source_tender_id: "100",
    folder_id: null,
    reference_no: null,
    title: "Test",
    organization: null,
    department: null,
    authority: null,
    category: null,
    project_category: null,
    city: null,
    state: null,
    location_text: null,
    published_date: null,
    opening_date: null,
    closing_date: null,
    bid_submission_date: null,
    tender_value: null,
    tender_value_text: null,
    emd_amount: null,
    emd_text: null,
    currency: "INR",
    source_url: null,
    download_status: "pending",
    qualification_status: "MAY_BID",
    prescreen_status: null,
    prescreen_reason_code: null,
    prescreen_reason: null,
    chatgpt_eligible: null,
    decision_source: null,
    prescreened_at: null,
    prescreen_rules_version: null,
    decision_label: null,
    verdict: null,
    reason: null,
    screening_reason: null,
    required_action: null,
    confidence: null,
    manual_review_required: null,
    qualified_at: null,
    crawled_at: null,
    created_at: new Date().toISOString(),
    scraped_date: null,
    first_seen_at: null,
    updated_at: new Date().toISOString(),
    effective_qualification_status: null,
    chat_url: null,
    msme_exemption: null,
    startup_exemption: null,
    ...partial,
  };
}

describe("tender list row meta", () => {
  it("shows ChatGPT prescreen_reason only (not screening/decision reason)", () => {
    expect(
      tenderListPrescreenReason(
        row({
          screening_reason: "Software AMC",
          reason: "From qualification",
          prescreen_reason:
            "Navigation camera, ESC, battery, cables and antenna assemblies are physical spares.",
        }),
      ),
    ).toBe(
      "Navigation camera, ESC, battery, cables and antenna assemblies are physical spares.",
    );
    expect(
      tenderListPrescreenReason(
        row({ screening_reason: "Software AMC", reason: "other" }),
      ),
    ).toBe("");
    expect(tenderListPrescreenReason(row({}))).toBe("");
  });

  it("detects documents only from a SharePoint zip URL (not stale flags)", () => {
    expect(tenderListHasDocuments(row({}))).toBe(false);
    expect(
      tenderListHasDocuments(row({ documents_zip_url: "https://blob/x.zip" })),
    ).toBe(false);
    expect(
      tenderListHasDocuments(row({ document_archive_available: true })),
    ).toBe(false);
    expect(
      tenderListHasDocuments(
        row({
          documents_zip_url:
            "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/file.zip",
        }),
      ),
    ).toBe(true);
  });

  it("detects AI summary only from a SharePoint URL (not stale flags)", () => {
    expect(tenderListHasAiSummary(row({}))).toBe(false);
    expect(
      tenderListHasAiSummary(row({ ai_summary_url: "https://blob/AI.pdf" })),
    ).toBe(false);
    expect(tenderListHasAiSummary(row({ ai_summary_available: true }))).toBe(
      false,
    );
    expect(
      tenderListHasAiSummary(
        row({
          ai_summary_url:
            "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/AI_Summary.pdf",
        }),
      ),
    ).toBe(true);
  });
});
