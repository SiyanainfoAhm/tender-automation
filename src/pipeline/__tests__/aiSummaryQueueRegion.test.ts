import assert from "node:assert/strict";
import test from "node:test";
import {
  pickPreferredQueueRow,
  resolveQueueOpenRegion,
  type AiSummaryQueueRow,
} from "../runAiSummaryFirstDocumentPipeline.js";

test("resolveQueueOpenRegion prefers globaltender detailUrl over INDIAN column", () => {
  assert.equal(
    resolveQueueOpenRegion({
      id: "1",
      source_tender_id: "104373910",
      source_region: "INDIAN",
      raw_metadata: {
        detailUrl:
          "https://www.tender247.com/auth/globaltender/104373910/4bb6c1b4-b751-4128-a7f0-8efd1b258b10",
      },
    }),
    "GLOBAL",
  );
});

test("pickPreferredQueueRow prefers artifact-complete GLOBAL sibling", () => {
  const indian: AiSummaryQueueRow = {
    id: "in",
    sourceTenderId: "104373910",
    qualificationStatus: "VERIFY",
    title: "x",
    documentsZipUrl: null,
    aiSummaryUrl: null,
    sourceRegion: "GLOBAL",
  };
  const global: AiSummaryQueueRow = {
    id: "gl",
    sourceTenderId: "104373910",
    qualificationStatus: "VERIFY",
    title: "x",
    documentsZipUrl: "https://it1stop.sharepoint.com/sites/x/a.zip",
    aiSummaryUrl: null,
    sourceRegion: "GLOBAL",
  };
  const picked = pickPreferredQueueRow([indian, global], "INDIAN");
  assert.equal(picked?.id, "gl");
  assert.ok(picked?.documentsZipUrl);
});

test("pickPreferredQueueRow prefers newer scraped_date when scores tie", () => {
  const older: AiSummaryQueueRow = {
    id: "old",
    sourceTenderId: "104373910",
    qualificationStatus: "VERIFY",
    title: "x",
    documentsZipUrl: null,
    aiSummaryUrl: null,
    sourceRegion: "INDIAN",
    scrapedDate: "2026-09-01",
  };
  const newer: AiSummaryQueueRow = {
    id: "new",
    sourceTenderId: "104373910",
    qualificationStatus: "VERIFY",
    title: "x",
    documentsZipUrl: null,
    aiSummaryUrl: null,
    sourceRegion: "INDIAN",
    scrapedDate: "2026-09-20",
  };
  const picked = pickPreferredQueueRow([older, newer], "INDIAN");
  assert.equal(picked?.id, "new");
});

test("buildIdsOnlySyntheticQueueRow invents VERIFY row for portal search", async () => {
  const mod = await import("../runAiSummaryFirstDocumentPipeline.js");
  const row = mod.buildIdsOnlySyntheticQueueRow("T247-104046893", "GLOBAL");
  assert.equal(row?.sourceTenderId, "104046893");
  assert.equal(row?.id, "ids-only-104046893");
  assert.equal(row?.qualificationStatus, "VERIFY");
  assert.equal(row?.sourceRegion, "GLOBAL");
  assert.equal(row?.documentsZipUrl, null);
});
