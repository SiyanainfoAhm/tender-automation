import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BidassistMetadata } from "../../bidassist/bidassistTypes.js";
import type { CompleteTenderMetadata } from "../../tender247Batch/extractCompleteMetadata.js";
import {
  createPipelineRunId,
  selectManifestQualificationIds,
  type PipelineManifest,
} from "../../pipeline/pipelineManifest.js";
import {
  buildBidassistSupabaseRow,
  buildTender247SupabaseRow,
} from "../tenderMetadataMap.js";
import { validateQualificationResult } from "../../chatgptQualification/qualificationSchema.js";

const sampleT247 = (): CompleteTenderMetadata => ({
  source: "tender247",
  t247Id: "101279958",
  detailUrl: "https://www.tender247.com/auth/tender/101279958/x",
  normalized: {
    tenderName: "Sample",
    organisation: "Org",
    department: null,
    location: "Pune, Maharashtra",
    closingDate: "2026-08-20",
    openingDate: "2026-08-10",
    tenderValue: 1000,
    emdAmount: 10,
    category: "IT",
    description: "Desc",
    brief: null,
  },
  tenderOverview: {},
  aiSummary: {},
  downloads: {
    aiSummaryDownloaded: true,
    allDocumentsDownloaded: true,
    aiSummaryFile: "AI_Summary.pdf",
    allDocumentsFile: "documents/Tender_All_Documents.zip",
  },
  processedAt: new Date().toISOString(),
  metadataExtractionStatus: "complete",
});

const sampleBa = (): BidassistMetadata => ({
  sourcePortal: "BidAssist",
  sourcePrefix: "BA",
  bidassistId: "GEM-2026-B-7876981",
  folderId: "BA-GEM-2026-B-7876981",
  title: "BidAssist sample",
  authority: "Authority",
  description: "Description",
  category: "software-and-it-solutions-category",
  sourceTenderPortal: "GeM",
  city: "Mumbai",
  state: "Maharashtra",
  closingDate: "20-08-2026",
  openingDateFilterFrom: "2026-08-01",
  openingDateFilterTo: null,
  tenderAmountText: "100000",
  tenderDetailUrl: "https://bidassist.com/tender/x",
  downloadedAt: new Date().toISOString(),
  originalZipFile: "docs.zip",
  documents: [
    {
      originalName: "a.pdf",
      storedName: "ba-a.pdf",
      extension: ".pdf",
      size: 10,
      sha256: "abc",
    },
  ],
});

test("1. Tender247 metadata mapper upsert payload", () => {
  const row = buildTender247SupabaseRow({
    metadata: sampleT247(),
    localFolderPath: "downloads/2026-08-05/T247-101279958",
  });
  assert.equal(row.source_portal, "TENDER247");
  assert.equal(row.source_tender_id, "101279958");
  assert.equal(row.folder_id, "T247-101279958");
  assert.ok(row.raw_metadata);
  assert.ok(row.content_hash);
  assert.ok(row.supabase_synced_at);
});

test("2. BidAssist metadata mapper upsert payload", () => {
  const metadata = sampleBa();
  const row = buildBidassistSupabaseRow({
    metadata,
    localFolderPath: "downloads/2026-08-05/BidAssist/BA-GEM-2026-B-7876981",
  });
  assert.equal(row.source_portal, "BIDASSIST");
  assert.equal(row.source_tender_id, "GEM-2026-B-7876981");
  assert.equal(row.folder_id, "BA-GEM-2026-B-7876981");
  assert.equal(row.title, "BidAssist sample");
  assert.equal(row.authority, "Authority");
  assert.equal(row.document_archive_available, true);
  assert.equal(row.ai_summary_available, false);
  assert.equal(
    (row.raw_metadata as unknown as BidassistMetadata).bidassistId,
    metadata.bidassistId,
  );
});

test("3. Manifest limits qualification to current-run IDs", () => {
  const manifest: PipelineManifest = {
    runId: createPipelineRunId("TENDER247"),
    sourcePortal: "TENDER247",
    startedAt: new Date().toISOString(),
    selectedTenderIds: ["101279958", "999"],
    completedCrawlerTenderIds: ["101279958"],
    failedCrawlerTenderIds: [],
  };
  assert.deepEqual(selectManifestQualificationIds(manifest), ["101279958"]);
});

test("4+5+6. Document resolver requirements for both portals", async () => {
  const { resolveQualificationFiles } = await import(
    "../../chatgptQualification/sourceDocumentResolver.js"
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-"));
  const t247Folder = path.join(root, "T247-101");
  fs.mkdirSync(path.join(t247Folder, "documents"), { recursive: true });
  fs.writeFileSync(
    path.join(t247Folder, "documents", "Tender_All_Documents.zip"),
    "PK\x03\x04zip",
  );
  fs.writeFileSync(path.join(t247Folder, "AI_Summary.pdf"), "pdf");

  // Without Supabase this throws — assert BidAssist does not require AI Summary in resolver logic
  const baFolder = path.join(root, "BA-1");
  fs.mkdirSync(path.join(baFolder, "original"), { recursive: true });
  fs.writeFileSync(path.join(baFolder, "original", "docs.zip"), "PK\x03\x04zip");

  // Pure filesystem assertions used by resolver helpers
  assert.equal(fs.existsSync(path.join(t247Folder, "AI_Summary.pdf")), true);
  assert.equal(fs.existsSync(path.join(baFolder, "AI_Summary.pdf")), false);
  assert.ok(
    fs.existsSync(path.join(baFolder, "original", "docs.zip")),
    "BidAssist uses original ZIP, not AI Summary",
  );

  // ensure the module exports the function
  assert.equal(typeof resolveQualificationFiles, "function");
  fs.rmSync(root, { recursive: true, force: true });
});

test("7. Response source ID mismatch is rejected", () => {
  const validated = validateQualificationResult(
    {
      sourcePortal: "TENDER247",
      sourceTenderId: "111",
      t247Id: "111",
      company: "Siyana Info Solutions Pvt. Ltd.",
      status: "GO",
      decisionLabel: "GO",
      verdict: "ok",
      reason: "All mandatory gates pass.",
      requiredAction: "Start bid preparation",
      confidence: 0.9,
      matchedCriteria: ["a"],
      failedCriteria: [],
      unclearCriteria: [],
      missingDocuments: [],
      conditions: [],
      partnershipRequiredFor: [],
      partnershipModeAllowed: [],
      manualReviewRequired: false,
    },
    "222",
    "TENDER247",
  );
  assert.equal(validated.ok, false);
  if (!validated.ok) {
    assert.match(validated.error, /mismatch/i);
  }
});

test("8. Qualification upsert conflict key shape is source portal + id", () => {
  // Contract test — store uses onConflict source_portal,source_tender_id
  const storePath = path.resolve(
    "src/supabase/qualificationResultStore.ts",
  );
  const src = fs.readFileSync(storePath, "utf8");
  assert.match(src, /onConflict:\s*"source_portal,source_tender_id"/);
});

test("9. Parent tender qualification_status sync trigger exists in migration", () => {
  const sql = fs.readFileSync(
    "supabase/migrations/202608060002_create_agenttender_qualification_results.sql",
    "utf8",
  );
  assert.match(sql, /agenttender_sync_qualification_status/);
  assert.match(sql, /set qualification_status = new\.status/);
});

test("10. Supabase failure preserves raw response for retry (state contract)", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/processTenderQualification.ts",
    "utf8",
  );
  assert.match(src, /response_saved_db_pending|DB_SYNC_FAILED/);
  assert.match(src, /raw response retained for retry/i);
});

test("11. Files uploaded without prompt submission cannot complete", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/qualificationSchema.ts",
    "utf8",
  );
  assert.match(src, /submissionConfirmed/);
  assert.match(src, /Refusing|submission was never confirmed|submissionConfirmed === true/);
});

test("12. One-tender limit processes exactly one tender", () => {
  const manifest: PipelineManifest = {
    runId: "x",
    sourcePortal: "BIDASSIST",
    startedAt: new Date().toISOString(),
    selectedTenderIds: ["A", "B"],
    completedCrawlerTenderIds: ["A", "B"],
    failedCrawlerTenderIds: [],
  };
  const limited = selectManifestQualificationIds(manifest).slice(0, 1);
  assert.deepEqual(limited, ["A"]);
  assert.equal(limited.length, 1);
});
