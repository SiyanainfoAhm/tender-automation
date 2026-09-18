import { describe, expect, it } from "vitest";

import { resolveTenderArtifactUrls } from "@/lib/tenders/resolve-document-urls";

describe("resolveTenderArtifactUrls", () => {
  it("prefers SharePoint entries from document_urls", () => {
    const resolved = resolveTenderArtifactUrls({
      document_urls: [
        {
          url: "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/tender-artifacts/tender247/2026-09-17/104380663/Tender_All_Documents.zip",
          type: "sharepoint",
          document_type: "documents_zip",
          updated_at: "2026-09-17 23:13:12.872+00",
        },
        {
          url: "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/AI_Summary.pdf",
          type: "sharepoint",
          document_type: "ai_summary",
        },
      ],
      documents_zip_url:
        "https://old.blob.core.windows.net/companydocuments/companies/x/file.zip",
      ai_summary_url: null,
    });

    expect(resolved.documentsZipUrl).toContain("sharepoint.com");
    expect(resolved.documentsZipUrl).toContain("Tender_All_Documents.zip");
    expect(resolved.aiSummaryUrl).toContain("AI_Summary.pdf");
  });

  it("falls back to scalar SharePoint columns when document_urls is empty", () => {
    const resolved = resolveTenderArtifactUrls({
      document_urls: [],
      documents_zip_url:
        "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/file.zip",
      ai_summary_url:
        "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/AI_Summary.pdf",
    });
    expect(resolved.documentsZipUrl).toContain("file.zip");
    expect(resolved.aiSummaryUrl).toContain("AI_Summary.pdf");
  });

  it("ignores Azure-only URLs", () => {
    const resolved = resolveTenderArtifactUrls({
      document_urls: [],
      documents_zip_url:
        "https://old.blob.core.windows.net/companydocuments/companies/x/file.zip",
      ai_summary_url:
        "https://old.blob.core.windows.net/companydocuments/companies/x/AI.pdf",
    });
    expect(resolved.documentsZipUrl).toBeNull();
    expect(resolved.aiSummaryUrl).toBeNull();
  });
});
