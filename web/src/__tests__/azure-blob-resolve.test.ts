import { describe, expect, it } from "vitest";

import {
  parseAzureBlobUrl,
  tryParseAzureBlobUrl,
  unwrapStoredDocumentReference,
} from "@/lib/storage/parseAzureBlobUrl";
import {
  buildTenderArtifactCandidateBlobNames,
  buildTenderArtifactPrefix,
  pickBlobNameFromPrefixList,
} from "@/lib/storage/resolveTenderArtifactPath";

describe("parseAzureBlobUrl", () => {
  it("splits container from blob name on full Azure URLs", () => {
    const parsed = parseAzureBlobUrl(
      "https://tenderautomationdocs.blob.core.windows.net/companydocuments/companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/cd255234-102791774.zip",
    );
    expect(parsed.containerName).toBe("companydocuments");
    expect(parsed.blobName).toBe(
      "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/cd255234-102791774.zip",
    );
  });

  it("decodes URL-encoded filenames and spaces", () => {
    const parsed = parseAzureBlobUrl(
      "https://acct.blob.core.windows.net/companydocuments/companies/siyana/tender-artifacts/manual/2026-09-03/MAN-X/IIM%20-%20Ahmedabad.pdf",
    );
    expect(parsed.blobName.endsWith("IIM - Ahmedabad.pdf")).toBe(true);
  });

  it("strips SAS query strings", () => {
    const parsed = parseAzureBlobUrl(
      "https://acct.blob.core.windows.net/companydocuments/companies/siyana/file.pdf?sv=2020-10-02&sig=abc",
    );
    expect(parsed.blobName).toBe("companies/siyana/file.pdf");
  });

  it("accepts relative blob paths with default container", () => {
    const parsed = parseAzureBlobUrl(
      "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/file.pdf",
      { defaultContainer: "companydocuments" },
    );
    expect(parsed.containerName).toBe("companydocuments");
    expect(parsed.blobName).toBe(
      "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/file.pdf",
    );
  });

  it("does not treat container as part of blobName when mistakenly prefixed", () => {
    const parsed = parseAzureBlobUrl(
      "companydocuments/companies/siyana/tender-artifacts/manual/x/y/file.pdf",
      { defaultContainer: "companydocuments" },
    );
    expect(parsed.containerName).toBe("companydocuments");
    expect(parsed.blobName).toBe(
      "companies/siyana/tender-artifacts/manual/x/y/file.pdf",
    );
  });

  it("unwraps legacy proxy URLs before parsing", () => {
    const azure =
      "https://tenderautomationdocs.blob.core.windows.net/companydocuments/companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/file.pdf";
    const proxy = `/api/storage/blob?url=${encodeURIComponent(azure)}&download=1`;
    expect(unwrapStoredDocumentReference(proxy)).toBe(azure);
    const parsed = parseAzureBlobUrl(proxy);
    expect(parsed.blobName).toContain("MAN-EB5B2C152D42/file.pdf");
  });

  it("returns null for malformed values via tryParse", () => {
    expect(tryParseAzureBlobUrl("not a url")).toBeNull();
    expect(tryParseAzureBlobUrl("")).toBeNull();
  });

  it("never treats SharePoint URLs as Azure blobs", () => {
    expect(
      tryParseAzureBlobUrl(
        "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/companies/x/file.zip",
      ),
    ).toBeNull();
  });
});

describe("manual vs tender247 artifact prefixes", () => {
  it("builds manual prefix under companies/{key}/tender-artifacts/manual", () => {
    expect(
      buildTenderArtifactPrefix({
        companyName: "Siyana Info Solutions Pvt. Ltd.",
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        sourcePortal: "MANUAL",
        sourceTenderId: "MAN-EB5B2C152D42",
        runDate: "2026-09-03",
        companyKey: "siyana",
      }),
    ).toBe(
      "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/",
    );
  });

  it("builds tender247 prefix under company root (not companies/siyana/manual)", () => {
    const prefix = buildTenderArtifactPrefix({
      companyName: "Siyana Info Solutions Pvt. Ltd.",
      companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      sourcePortal: "TENDER247",
      sourceTenderId: "103389190",
      runDate: "2026-08-18",
    });
    expect(prefix).toContain("/tender-artifacts/tender247/");
    expect(prefix).not.toContain("/tender-artifacts/manual/");
    expect(prefix.startsWith("companies/siyana/")).toBe(false);
  });

  it("never invents tender-all-documents.zip for manual candidates", () => {
    const candidates = buildTenderArtifactCandidateBlobNames({
      companyName: "Siyana",
      companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      sourcePortal: "MANUAL",
      sourceTenderId: "MAN-EB5B2C152D42",
      runDate: "2026-09-03",
      fileName: "102791774.zip",
      companyDocumentId: "cd255234-aaaa-bbbb-cccc-dddddddddddd",
      companyKey: "siyana",
    });
    expect(candidates.some((c) => c.endsWith("cd255234-102791774.zip"))).toBe(
      true,
    );
    expect(candidates.every((c) => !c.includes("tender-all-documents.zip"))).toBe(
      true,
    );
  });

  it("picks persisted-style id-prefixed blob from a prefix listing", () => {
    const picked = pickBlobNameFromPrefixList({
      fileNameHint: "102791774.zip",
      blobNames: [
        "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/cd255234-102791774.zip",
      ],
    });
    expect(picked).toBe(
      "companies/siyana/tender-artifacts/manual/2026-09-03/MAN-EB5B2C152D42/cd255234-102791774.zip",
    );
  });
});
