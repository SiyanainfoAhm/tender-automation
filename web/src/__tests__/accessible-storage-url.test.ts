import { describe, expect, it } from "vitest";

import {
  toAccessibleStorageUrl,
  toProxiedStorageUrl,
} from "@/lib/storage/accessible-storage-url";

describe("toAccessibleStorageUrl", () => {
  it("returns the SharePoint column URL directly (no /api/storage/blob)", () => {
    const sharePoint =
      "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/tender-artifacts/tender247/2026-09-17/104380663/Tender_All_Documents.zip";
    expect(toAccessibleStorageUrl(sharePoint)).toBe(sharePoint);
  });

  it("unwraps legacy proxy links back to the SharePoint URL", () => {
    const sharePoint =
      "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/file.zip";
    const legacy = `/api/storage/blob?url=${encodeURIComponent(sharePoint)}&download=1&fileName=Tender_All_Documents.zip`;
    expect(toAccessibleStorageUrl(legacy)).toBe(sharePoint);
  });

  it("returns null for Azure blob URLs", () => {
    expect(
      toAccessibleStorageUrl(
        "https://acct.blob.core.windows.net/companydocuments/companies/x/file.zip",
      ),
    ).toBeNull();
  });
});

describe("toProxiedStorageUrl", () => {
  it("builds an authenticated SharePoint stream proxy for iframe preview", () => {
    const sharePoint =
      "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/AI_Summary.pdf";
    const proxied = toProxiedStorageUrl(sharePoint, {
      fileName: "AI_Tender_Summary.pdf",
    });
    expect(proxied).toMatch(/^\/api\/storage\/blob\?/);
    expect(proxied).toContain(encodeURIComponent(sharePoint));
    expect(proxied).toContain("fileName=AI_Tender_Summary.pdf");
  });

  it("returns null for non-SharePoint URLs", () => {
    expect(
      toProxiedStorageUrl(
        "https://acct.blob.core.windows.net/companydocuments/x.pdf",
      ),
    ).toBeNull();
  });
});
