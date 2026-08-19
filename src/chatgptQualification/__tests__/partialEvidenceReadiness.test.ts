import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CANONICAL_ARCHIVE_NAME } from "../../tender247Batch/canonicalTenderArchive.js";
import { writeMetadataSyncMarker } from "../../tender247Batch/resumeArtifacts.js";
import {
  ensureTender247QualificationEvidence,
  findAiSummaryPdf,
} from "../ensureTender247QualificationEvidence.js";
import { resolvePartialQualificationFiles } from "../sourceDocumentResolver.js";
import { buildEvidenceAwareQualificationPrompt } from "../qualificationSchema.js";

function makeFixture(): {
  root: string;
  dateFolder: string;
  tenderFolder: string;
  t247Id: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "partial-evidence-"));
  const dateFolder = path.join(root, "2026-08-16");
  const t247Id = "103392781";
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  fs.mkdirSync(path.join(tenderFolder, "documents"), { recursive: true });
  return { root, dateFolder, tenderFolder, t247Id };
}

function writeMetaMarker(tenderFolder: string, t247Id: string): void {
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

test("TEST A: AI Summary only → PARTIAL, one attachment", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeFixture();
  fs.writeFileSync(
    path.join(tenderFolder, "AI_Summary.pdf"),
    "%PDF-1.4 ai summary",
  );

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, false);
  assert.equal(evidence.evidenceCount, 1);
  assert.equal(evidence.evidenceMode, "PARTIAL");
  assert.equal(evidence.aiSummary.available, true);
  assert.equal(evidence.metadata.available, false);
  assert.equal(evidence.documents.available, false);

  const bundle = await resolvePartialQualificationFiles(
    t247Id,
    tenderFolder,
    evidence,
  );
  assert.equal(bundle.expectedAttachmentCount, 1);
  assert.equal(bundle.files[0]?.kind, "AI_SUMMARY");

  const prompt = buildEvidenceAwareQualificationPrompt("TENDER247", t247Id, {
    metadataAvailable: false,
    documentsAvailable: false,
    aiSummaryAvailable: true,
    evidenceMode: "PARTIAL",
  });
  assert.match(prompt, /Available evidence for this run/i);
  assert.match(prompt, /Unavailable for this run/i);
  assert.match(prompt, /Do not claim an unavailable attachment was reviewed/i);
});

test("TEST B: PDF document only → canonical ZIP, one attachment", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeFixture();
  fs.writeFileSync(
    path.join(tenderFolder, "documents", "Tender_All_Documents.pdf"),
    "%PDF-1.4 tender doc",
  );

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, false);
  assert.equal(evidence.documents.available, true);
  assert.ok(
    fs.existsSync(path.join(tenderFolder, "documents", CANONICAL_ARCHIVE_NAME)),
  );

  const bundle = await resolvePartialQualificationFiles(
    t247Id,
    tenderFolder,
    evidence,
  );
  assert.equal(bundle.expectedAttachmentCount, 1);
  assert.equal(bundle.files[0]?.kind, "DOCUMENT_ARCHIVE");
});

test("TEST C: metadata only → PARTIAL evidence", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeFixture();
  writeMetaMarker(tenderFolder, t247Id);

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, false);
  assert.equal(evidence.metadata.available, true);
  assert.equal(evidence.evidenceMode, "PARTIAL");
  assert.equal(evidence.evidenceCount, 1);
  assert.deepEqual(evidence.availableFiles, ["metadata"]);
});

test("TEST D: metadata + ZIP → STRONG_PARTIAL evidence", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeFixture();
  writeMetaMarker(tenderFolder, t247Id);
  fs.writeFileSync(
    path.join(tenderFolder, "documents", "NIT.pdf"),
    "%PDF-1.4 nit",
  );

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, true);
  assert.equal(evidence.evidenceMode, "STRONG_PARTIAL");
  assert.equal(evidence.evidenceCount, 2);
  assert.ok(evidence.availableFiles.includes("metadata"));
  assert.ok(
    evidence.availableFiles.some((f) => /Tender_All_Documents/i.test(f)),
  );

  const prompt = buildEvidenceAwareQualificationPrompt("TENDER247", t247Id, {
    metadataAvailable: true,
    documentsAvailable: true,
    aiSummaryAvailable: false,
    evidenceMode: "STRONG_PARTIAL",
  });
  assert.match(prompt, /AI Summary unavailable for this run/i);
  assert.match(prompt, /Evaluate using available evidence only/i);
  assert.match(prompt, /Do not claim AI Summary was reviewed/i);
  assert.match(
    prompt,
    /If missing evidence prevents a mandatory-gate determination, return VERIFY/i,
  );
});

test("TEST E: all three artifacts → FULL evidence", async () => {
  const { dateFolder, tenderFolder, t247Id } = makeFixture();
  writeMetaMarker(tenderFolder, t247Id);
  fs.writeFileSync(
    path.join(tenderFolder, "documents", "BOQ.xlsx"),
    "excel-bytes",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "AI_Summary.pdf"),
    "%PDF-1.4 ai",
  );

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, true);
  assert.equal(evidence.evidenceMode, "FULL");
  assert.equal(evidence.evidenceCount, 3);
});

test("TEST F: zero evidence → NOT_READY", async () => {
  const { dateFolder, t247Id } = makeFixture();

  const evidence = await ensureTender247QualificationEvidence({
    dateFolder,
    t247Id,
    attemptDocumentDownload: false,
  });

  assert.equal(evidence.gptReady, false);
  assert.equal(evidence.evidenceMode, "NONE");
  assert.equal(evidence.notReadyReason, "MISSING_CORE_QUALIFICATION_ARTIFACTS");
});

test("findAiSummaryPdf accepts duplicate-suffix variants", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-summary-"));
  fs.writeFileSync(path.join(dir, "AI_Summary(2).pdf"), "%PDF-1.4");
  const found = findAiSummaryPdf(dir);
  assert.ok(found);
  assert.match(found!.fileName, /AI_Summary/i);
});
