import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  duplicateMatchKindLabel,
  formatDuplicateReference,
} from "@/lib/duplicate-reference";

describe("duplicate-reference", () => {
  it("formats portal id and tender link", () => {
    const ref = formatDuplicateReference({
      duplicateOfSourceTenderId: "103544061",
      duplicateOfTenderId: "abc-123",
      sourcePortal: "TENDER247",
    });
    assert.ok(ref);
    assert.equal(ref.label, "T247-103544061");
    assert.equal(ref.href, "/tenders/abc-123");
  });

  it("parses matched id from screening reason when db columns missing", () => {
    const ref = formatDuplicateReference({
      screeningReason:
        "Duplicate Reference Number: REF-1. Matches Tender247 ID 103544061.",
      sourcePortal: "TENDER247",
    });
    assert.ok(ref);
    assert.equal(ref?.portalId, "103544061");
    assert.equal(ref?.matchKind, "reference");
  });

  it("labels duplicate match kinds", () => {
    assert.equal(duplicateMatchKindLabel("reference"), "Same reference number");
    assert.equal(
      duplicateMatchKindLabel("historical"),
      "Already reviewed in history",
    );
  });
});
