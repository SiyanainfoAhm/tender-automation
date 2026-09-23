import { describe, expect, it } from "vitest";

import { deriveCompletionSource } from "@/lib/bid-checklist";

describe("checklist company document linking", () => {
  it("derives COMPANY_DOCUMENT completion when company match is set", () => {
    expect(
      deriveCompletionSource({
        matchedDocumentSource: "COMPANY",
        matchedBy: "USER",
        hasCompanyDocument: true,
      }),
    ).toBe("COMPANY_DOCUMENT");
  });

  it("does not treat company link as uploaded tender document", () => {
    expect(
      deriveCompletionSource({
        matchedDocumentSource: "COMPANY",
        matchedBy: "USER",
      }),
    ).not.toBe("UPLOADED");
  });
});
