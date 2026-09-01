import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";

import {
  buildScreeningUploadSpecs,
  composerAttachmentMatchesExpected,
  isUnsafeGeneratedFileHref,
  screeningComposerCandidatesInclude,
  validateScreeningInputFiles,
  validateDownloadedScreeningXlsx,
} from "../runExcelScreeningAttachments.js";

test("composerAttachmentMatchesExpected handles duplicate suffixes", () => {
  assert.equal(
    composerAttachmentMatchesExpected(
      "Tender247_2026-08-31(5).xlsx",
      "Tender247_2026-08-31(5).xlsx",
    ),
    true,
  );
  assert.equal(
    composerAttachmentMatchesExpected(
      "Tender247_2026-08-31(5).xlsx",
      "Tender247_2026-08-31.xlsx",
    ),
    true,
  );
  assert.equal(
    composerAttachmentMatchesExpected(
      "siyana_tender_screening(2).md",
      "screening.md",
    ),
    false,
  );
});

test("screeningComposerCandidatesInclude finds both Excel and Markdown names", () => {
  const candidates = [
    "Tender247_2026-08-31(5).xlsx",
    "siyana_tender_screening(2).md",
  ];
  assert.equal(
    screeningComposerCandidatesInclude(
      candidates,
      "Tender247_2026-08-31(5).xlsx",
    ),
    true,
  );
  assert.equal(
    screeningComposerCandidatesInclude(
      candidates,
      "siyana_tender_screening(2).md",
    ),
    true,
  );
  assert.equal(
    screeningComposerCandidatesInclude(candidates, "missing.xlsx"),
    false,
  );
});

test("isUnsafeGeneratedFileHref rejects library and sandbox links", () => {
  assert.equal(
    isUnsafeGeneratedFileHref(
      "https://chatgpt.com/api/library/files/libfile_abc?file_id=file_123",
    ),
    true,
  );
  assert.equal(
    isUnsafeGeneratedFileHref("sandbox:/mnt/data/31-08-26_daily Tenders.xlsx"),
    true,
  );
  assert.equal(
    isUnsafeGeneratedFileHref("https://cdn.oaistatic.com/generated/file.xlsx"),
    false,
  );
});

test("validateScreeningInputFiles accepts valid xlsx and md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screening-upload-"));
  const xlsxPath = path.join(dir, "Tender247_2026-08-31(5).xlsx");
  const mdPath = path.join(dir, "siyana_tender_screening(2).md");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["T247 ID2"], ["1"]]),
    "Non-GeM Tenders",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["T247 ID2"], ["2"]]),
    "GeM Tenders",
  );
  XLSX.writeFile(wb, xlsxPath);
  fs.writeFileSync(mdPath, "# Screening rules\n", "utf8");

  const specs = buildScreeningUploadSpecs([xlsxPath, mdPath]);
  const logs: string[] = [];
  const logger = {
    info: (m: string) => logs.push(m),
    warn: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
  };
  validateScreeningInputFiles(specs, logger as never);
  assert.equal(specs.length, 2);
});

test("validateDownloadedScreeningXlsx rejects empty files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screening-dl-"));
  const bad = path.join(dir, "empty.xlsx");
  fs.writeFileSync(bad, "");
  assert.throws(
    () =>
      validateDownloadedScreeningXlsx(bad, {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as never),
    /empty|invalid|corrupted/i,
  );
});
