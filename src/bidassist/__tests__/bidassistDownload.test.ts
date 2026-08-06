import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBidassistIds,
  isSafeZipEntryName,
  prefixBaFileName,
  sanitizeWindowsFileName,
} from "../bidassistDownload.js";

test("prefixBaFileName adds ba- once", () => {
  assert.equal(prefixBaFileName("GeM-Bidding-9709623.pdf"), "ba-GeM-Bidding-9709623.pdf");
  assert.equal(
    prefixBaFileName("ba-GeM-Bidding-9709623.pdf"),
    "ba-GeM-Bidding-9709623.pdf",
  );
});

test("deriveBidassistIds prefers GEM id from ZIP name", () => {
  const ids = deriveBidassistIds({
    zipFileName: "GEM_2026_B_7876981.zip",
    title: "Some tender",
  });
  assert.equal(ids.folderId.startsWith("BA-"), true);
  assert.match(ids.folderId, /GEM-2026-B-7876981/i);
});

test("deriveBidassistIds falls back to hash", () => {
  const ids = deriveBidassistIds({
    title: "Unique title XYZ",
    authority: "Dept",
    closingDate: "05 Aug 2026",
  });
  assert.equal(ids.folderId.startsWith("BA-"), true);
  assert.match(ids.bidassistId, /BAHASH-/i);
});

test("ZIP path traversal entries are rejected", () => {
  assert.equal(isSafeZipEntryName("../etc/passwd"), false);
  assert.equal(isSafeZipEntryName("..\\windows\\system32"), false);
  assert.equal(isSafeZipEntryName("C:/abs/file.pdf"), false);
  assert.equal(isSafeZipEntryName("docs/file.pdf"), true);
});

test("sanitizeWindowsFileName strips invalid characters", () => {
  assert.equal(sanitizeWindowsFileName('a<b>c:d.pdf'), "a_b_c_d.pdf");
});
