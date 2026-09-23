import { describe, expect, it } from "vitest";

import { detectStorageProvider } from "@/lib/storage/detectStorageProvider";

describe("detectStorageProvider", () => {
  it("prefers explicit storage_provider", () => {
    expect(
      detectStorageProvider({
        storage_provider: "sharepoint",
        storage_url: "https://acct.blob.core.windows.net/c/x.pdf",
      }),
    ).toBe("sharepoint");
    expect(
      detectStorageProvider({
        storageProvider: "azure",
        storageUrl: "https://it1stop.sharepoint.com/sites/x/f.pdf",
      }),
    ).toBe("azure");
  });

  it("falls back to URL host", () => {
    expect(
      detectStorageProvider({
        storage_url:
          "https://it1stop.sharepoint.com/sites/SiyanaTenderDocumentRepository/TenderDocs/x.pdf",
      }),
    ).toBe("sharepoint");
    expect(
      detectStorageProvider({
        storageUrl: "https://acct.blob.core.windows.net/companydocuments/x.pdf",
      }),
    ).toBe("azure");
    expect(detectStorageProvider({})).toBe("unknown");
  });
});
