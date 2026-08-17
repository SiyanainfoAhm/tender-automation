import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANONICAL_ARCHIVE_NAME,
  NO_TENDER_DOCUMENT_ARTIFACTS,
  ensureCanonicalTenderArchive,
  listZipEntryNames,
  zipContainsMeaningfulDocuments,
} from "../canonicalTenderArchive.js";

function makeTenderDir(id: string): { root: string; tenderDir: string; documentsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-archive-"));
  const tenderDir = path.join(root, `T247-${id}`);
  const documentsDir = path.join(tenderDir, "documents");
  fs.mkdirSync(documentsDir, { recursive: true });
  return { root, tenderDir, documentsDir };
}

test("single PDF is packaged into canonical Tender_All_Documents.zip", async () => {
  const { tenderDir, documentsDir } = makeTenderDir("123");
  fs.writeFileSync(
    path.join(documentsDir, "Tender_All_Documents.pdf"),
    "%PDF-1.4 fixture-pdf",
  );

  const result = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "123",
  });

  assert.equal(result.ready, true);
  assert.equal(result.created, true);
  assert.equal(result.reused, false);
  assert.ok(result.canonicalZipPath);
  assert.equal(path.basename(result.canonicalZipPath!), CANONICAL_ARCHIVE_NAME);
  assert.ok(zipContainsMeaningfulDocuments(result.canonicalZipPath!));
  const names = listZipEntryNames(result.canonicalZipPath!);
  assert.ok(names.includes("Tender_All_Documents.pdf"));
  assert.ok(
    fs.existsSync(path.join(documentsDir, "Tender_All_Documents.pdf")),
    "source PDF must remain; never renamed to .zip",
  );
});

test("multiple document files are all stored in the canonical ZIP", async () => {
  const { tenderDir, documentsDir } = makeTenderDir("456");
  fs.writeFileSync(path.join(documentsDir, "NIT.pdf"), "%PDF-1.4 nit");
  fs.writeFileSync(path.join(documentsDir, "BOQ.xlsx"), "xlsx-bytes");
  fs.writeFileSync(path.join(documentsDir, "Corrigendum.pdf"), "%PDF-1.4 corr");

  const result = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "456",
  });

  assert.equal(result.ready, true);
  const names = listZipEntryNames(result.canonicalZipPath!).sort();
  assert.deepEqual(names.sort(), ["BOQ.xlsx", "Corrigendum.pdf", "NIT.pdf"].sort());
});

test("PDF mis-saved as Tender_All_Documents.zip is wrapped in a real ZIP, not renamed", async () => {
  const { tenderDir, documentsDir } = makeTenderDir("pdfzip");
  fs.writeFileSync(
    path.join(documentsDir, "Tender_All_Documents.zip"),
    "%PDF-1.4 this-is-a-pdf-not-a-zip",
  );

  const result = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "pdfzip",
  });

  assert.equal(result.ready, true);
  assert.ok(result.canonicalZipPath);
  assert.ok(zipContainsMeaningfulDocuments(result.canonicalZipPath!));
  const names = listZipEntryNames(result.canonicalZipPath!);
  assert.ok(
    names.some((n) => /\.pdf$/i.test(n)),
    `expected a PDF entry, got ${names.join(",")}`,
  );
  const zipBytes = fs.readFileSync(result.canonicalZipPath!);
  assert.notEqual(zipBytes.subarray(0, 4).toString("ascii"), "%PDF");
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
});
test("empty documents directory does not create an empty ZIP", async () => {
  const { tenderDir, documentsDir } = makeTenderDir("789");
  const result = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "789",
  });
  assert.equal(result.ready, false);
  assert.equal(result.created, false);
  assert.equal(result.reason, NO_TENDER_DOCUMENT_ARTIFACTS);
  assert.equal(
    fs.existsSync(path.join(documentsDir, CANONICAL_ARCHIVE_NAME)),
    false,
  );
});

test("existing valid canonical ZIP is reused and not duplicated", async () => {
  const { tenderDir, documentsDir } = makeTenderDir("111");
  fs.writeFileSync(path.join(documentsDir, "NIT.pdf"), "%PDF-1.4 nit");
  const first = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "111",
  });
  const second = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: "111",
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reused, true);
  assert.equal(second.ready, true);
  const zips = fs
    .readdirSync(documentsDir)
    .filter((n) => /Tender_All_Documents.*\.zip$/i.test(n));
  assert.deepEqual(zips, [CANONICAL_ARCHIVE_NAME]);
});
