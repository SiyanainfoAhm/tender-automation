import { describe, expect, it } from "vitest";
import {
  canEditBidPreferences,
  canEditCompanyProfile,
  canManageCompanyDocuments,
  canViewUsers,
  generateFinancialYears,
  getDocumentExpiryState,
  SIYANA_COMPANY_ID,
} from "@/lib/company/types";
import {
  UnconfiguredDocumentStorageProvider,
  StorageNotConfiguredError,
  buildCompanyBlobPath,
} from "@/lib/storage/documentStorageProvider";
import {
  sanitizeBlobFileName,
  slugifyBlobSegment,
} from "@/lib/storage/blobPath";

describe("company role permissions", () => {
  it("gates profile and preferences by permission", () => {
    expect(canEditCompanyProfile("ADMIN")).toBe(true);
    expect(canEditCompanyProfile("BID_MANAGER")).toBe(false);
    expect(canEditBidPreferences("BID_MANAGER")).toBe(true);
    expect(canEditBidPreferences("BID_COORDINATOR")).toBe(false);
    expect(canManageCompanyDocuments("DOCUMENT_SPECIALIST")).toBe(true);
    expect(canManageCompanyDocuments("BID_COORDINATOR")).toBe(false);
    expect(canViewUsers("ADMIN")).toBe(true);
    expect(canViewUsers("BID_MANAGER")).toBe(true);
    expect(canViewUsers("BID_COORDINATOR")).toBe(false);
  });

  it("keeps Siyana company id stable", () => {
    expect(SIYANA_COMPANY_ID).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });
});

describe("document expiry states", () => {
  it("classifies expiry states", () => {
    expect(getDocumentExpiryState(null)).toBe("NO_EXPIRY");
    expect(getDocumentExpiryState("2000-01-01")).toBe("EXPIRED");
  });
});

describe("financial year generator", () => {
  it("returns dynamic FY labels", () => {
    const years = generateFinancialYears(3, new Date("2026-08-13"));
    expect(years[0]).toBe("FY 2026-27");
    expect(years).toHaveLength(3);
  });
});

describe("certificate types", () => {
  it("does not treat GST or PAN as certificates", async () => {
    const { CERTIFICATE_TYPES } = await import("@/lib/company/types");
    expect(CERTIFICATE_TYPES).not.toContain("GST");
    expect(CERTIFICATE_TYPES).not.toContain("PAN");
  });
});

describe("document storage provider", () => {
  it("throws when Azure is not configured", async () => {
    const provider = new UnconfiguredDocumentStorageProvider();
    await expect(
      provider.upload({
        companyId: SIYANA_COMPANY_ID,
        companyName: "Siyana Info Solutions Pvt. Ltd.",
        documentId: "doc-1",
        documentName: "ISO 27001 Certificate",
        category: "Certificate",
        fileName: "x.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
    await expect(
      provider.createUploadSession({
        documentName: "ISO 27001 Certificate",
        fileName: "x.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        category: "Certificate",
      }),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("builds tenant-scoped blob paths with category folders", () => {
    const path = buildCompanyBlobPath({
      companyId: SIYANA_COMPANY_ID,
      companyName: "Siyana Info Solutions Pvt. Ltd.",
      documentId: "26b4f7fa-xxxx",
      documentName: "ISO 27001 Certificate",
      category: "Certificate",
      fileName: "ISO-27001-Certificate.pdf",
    });
    expect(path).toBe(
      `siyana-info-solutions-pvt-ltd_${SIYANA_COMPANY_ID}/iso-27001-certificate_26b4f7fa-xxxx/Certificate/iso-27001-certificate.pdf`,
    );
  });

  it("slugifies and sanitizes path segments", () => {
    expect(slugifyBlobSegment("Siyana Info Solutions Pvt. Ltd.")).toBe(
      "siyana-info-solutions-pvt-ltd",
    );
    expect(sanitizeBlobFileName("FY 2025-26 Balance Sheet (Final).pdf")).toBe(
      "fy-2025-26-balance-sheet-final.pdf",
    );
    expect(sanitizeBlobFileName("../evil/name.pdf")).toBe("evilname.pdf");
    expect(sanitizeBlobFileName("a\\b\\c.pdf")).toBe("abc.pdf");
  });
});
