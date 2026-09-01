import assert from "node:assert/strict";
import test from "node:test";
import { parseDuplicateReferenceFromReason } from "../parseDuplicateReference.js";

test("parseDuplicateReferenceFromReason extracts reference match", () => {
  const parsed = parseDuplicateReferenceFromReason(
    "Duplicate Reference Number: 2026_ABC_1. Matches Tender247 ID 103544061.",
  );
  assert.equal(parsed.matchedSourceTenderId, "103544061");
  assert.equal(parsed.matchKind, "reference");
});

test("parseDuplicateReferenceFromReason extracts authority/brief/deadline match", () => {
  const parsed = parseDuplicateReferenceFromReason(
    "Duplicate tender: same Authority, Tender Brief, and Deadline as Tender247 ID 103544062.",
  );
  assert.equal(parsed.matchedSourceTenderId, "103544062");
  assert.equal(parsed.matchKind, "authority_brief_deadline");
});

test("parseDuplicateReferenceFromReason extracts historical match", () => {
  const parsed = parseDuplicateReferenceFromReason(
    "Already reviewed tender: matches existing Tender247 ID 103544063 from 2026-08-25.",
  );
  assert.equal(parsed.matchedSourceTenderId, "103544063");
  assert.equal(parsed.matchKind, "historical");
});

test("parseDuplicateReferenceFromReason extracts internal Tender247 ID duplicate", () => {
  const parsed = parseDuplicateReferenceFromReason(
    "Duplicate Tender247 ID: 1001. Existing tender record retained for review.",
  );
  assert.equal(parsed.matchedSourceTenderId, "1001");
  assert.equal(parsed.matchKind, "tender247_id");
});
