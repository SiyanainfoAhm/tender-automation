import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePhase1TenderReadiness } from "../readiness.js";
import { ensureGptMetadataReady } from "../ensureGptMetadataReady.js";
import { loadChatGptTenderState } from "../chatgptState.js";
import { writeMetadataSyncMarker } from "../../tender247Batch/resumeArtifacts.js";
import { CANONICAL_ARCHIVE_NAME } from "../../tender247Batch/canonicalTenderArchive.js";
import type { CompleteTenderMetadata } from "../../tender247Batch/extractCompleteMetadata.js";

function makeDateFolder(): { dateFolder: string; tenderFolder: string; t247Id: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-ready-"));
  const dateFolder = path.join(parent, "2026-08-16");
  const t247Id = "103392680";
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  fs.mkdirSync(path.join(tenderFolder, "documents"), { recursive: true });
  return { dateFolder, tenderFolder, t247Id };
}

function writeSyncMarker(tenderFolder: string, t247Id: string): void {
  writeMetadataSyncMarker(tenderFolder, {
    sourcePortal: "TENDER247",
    sourceTenderId: t247Id,
    contentHash: "abc",
    extractionStatus: "complete",
    syncedAt: new Date().toISOString(),
    ok: true,
    error: null,
  });
}

test("resume revalidates stale not_ready when a local PDF exists", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeDateFolder();
  fs.writeFileSync(
    path.join(tenderFolder, "documents", "Tender_All_Documents.pdf"),
    "%PDF-1.4 local-doc",
  );
  writeSyncMarker(tenderFolder, t247Id);
  fs.writeFileSync(
    path.join(tenderFolder, "chatgpt-state.json"),
    JSON.stringify({
      t247Id,
      chatUrl: null,
      status: "not_ready",
      missingFiles: ["Tender_All_Documents.zip"],
      error: "Missing: Tender_All_Documents.zip",
      updatedAt: new Date().toISOString(),
    }),
    "utf8",
  );

  const prepared = await preparePhase1TenderReadiness({
    dateFolder,
    t247Id,
  });

  assert.equal(prepared.gptReady, true);
  assert.equal(prepared.canonicalZipCreated, true);
  assert.ok(
    fs.existsSync(path.join(tenderFolder, "documents", CANONICAL_ARCHIVE_NAME)),
  );
  assert.equal(loadChatGptTenderState(tenderFolder), null);
});

test("metadata repair upserts local metadata when Supabase row is absent", async () => {
  const { tenderFolder, t247Id } = makeDateFolder();
  const metadata: CompleteTenderMetadata = {
    source: "tender247",
    t247Id,
    detailUrl: `https://www.tender247.com/auth/tender/${t247Id}/x`,
    raw: {},
    normalized: { tenderName: "Repair fixture" },
    tenderOverview: {},
    aiSummary: {},
    downloads: {
      aiSummaryDownloaded: false,
      allDocumentsDownloaded: true,
      aiSummaryFile: null,
      allDocumentsFile: "documents/Tender_All_Documents.pdf",
    },
    processedAt: new Date().toISOString(),
    metadataExtractionStatus: "complete",
  };
  fs.writeFileSync(
    path.join(tenderFolder, "metadata.json"),
    JSON.stringify(metadata),
    "utf8",
  );

  let upserted = false;
  const result = await ensureGptMetadataReady({
    tenderFolder,
    t247Id,
    deps: {
      getTenderMetadata: async () => null,
      upsertTender247Metadata: async () => {
        upserted = true;
        return { ok: true, id: "row-1", contentHash: "hash", error: null };
      },
      verifyTender247MetadataRow: async () => ({
        ok: true,
        row: {
          id: "row-1",
          source_portal: "TENDER247",
          source_tender_id: t247Id,
          folder_id: null,
          raw_metadata: metadata as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        error: null,
      }),
    },
  });

  assert.equal(upserted, true);
  assert.equal(result.ready, true);
  assert.equal(result.repaired, true);
  assert.equal(result.supabaseFound, true);
});
