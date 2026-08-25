import { describe, expect, it } from "vitest";

import { resolveUploadedDocumentId } from "@/lib/uploads/resolveUploadedDocumentId";

describe("resolveUploadedDocumentId", () => {
  it("prefers top-level documentId", () => {
    expect(
      resolveUploadedDocumentId({
        documentId: "top-id",
        document: { id: "nested-id" },
      }),
    ).toBe("top-id");
  });

  it("falls back to nested document.id from older edge responses", () => {
    expect(
      resolveUploadedDocumentId({
        document: { id: "nested-id" },
      }),
    ).toBe("nested-id");
  });

  it("returns null when neither shape is present", () => {
    expect(resolveUploadedDocumentId({})).toBeNull();
    expect(resolveUploadedDocumentId({ document: { name: "x" } })).toBeNull();
  });
});
