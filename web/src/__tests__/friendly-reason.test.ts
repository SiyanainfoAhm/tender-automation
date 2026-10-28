import { describe, expect, it } from "vitest";
import { friendlyTenderReason } from "@/lib/tenders/friendly-reason";

describe("friendlyTenderReason", () => {
  it("replaces pipeline codes", () => {
    expect(friendlyTenderReason("EVIDENCE_PENDING — Error: Error: DEPENDENCY_PENDING:TARGETED_SOURCE_ACQUISITION")).toBe(
      "Evaluation pending: some tender documents are still being collected.",
    );
    expect(
      friendlyTenderReason(
        "EVIDENCE_PENDING — Error: Error: DEPENDENCY_PENDING:SOURCE_ACQUISITION_BLOCKED:TENDER247_ACQUISITION_REQUIRED; no persisted archive URL; connect the authorized importer/portal worker",
      ),
    ).toMatch(/not been downloaded/);
  });
  it("keeps the human-written part", () => {
    expect(
      friendlyTenderReason(
        "EVIDENCE_PENDING — Error: Error: DEPENDENCY_PENDING:MISSING_SOURCE_EVIDENCE:Full RFP | Removed from VERIFY 2026-10-27 by user: scope is India only (US/GLOBAL tender)",
      ),
    ).toBe("Marked by user on 2026-10-27: scope is India only (US/GLOBAL tender)");
  });
  it("leaves normal reasons unchanged", () => {
    expect(friendlyTenderReason("NO_GO — EMD of ₹2 crore exceeds the limit")).toBe("NO_GO — EMD of ₹2 crore exceeds the limit");
  });
});
