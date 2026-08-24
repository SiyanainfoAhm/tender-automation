import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import XLSX from "xlsx";
import { parseDocumentTextTestTenderIds } from "../../../config.js";
import { buildDocumentTextQualificationPrompt } from "../buildDocumentTextPrompt.js";
import {
  cleanExtractedDocumentText,
  compressDocumentTextForPrompt,
} from "../compressDocumentText.js";
import { extractDocumentTextForTender } from "../extractDocumentText.js";
import { resolveDocumentTextTenderTargets } from "../qualifyDocumentTextMode.js";
import type { CompanyPreferenceSnapshot } from "../../../runScreening/companyPreferences.js";

test("parseDocumentTextTestTenderIds accepts JSON and CSV (no hard max of 2)", () => {
  assert.deepEqual(
    parseDocumentTextTestTenderIds('["T247-111","T247-222","T247-333"]'),
    ["111", "222", "333"],
  );
  assert.deepEqual(parseDocumentTextTestTenderIds("T247-111, 222"), ["111", "222"]);
  assert.deepEqual(parseDocumentTextTestTenderIds(""), []);
});

test("extractDocumentTextForTender writes document-text.json from zip", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-text-mode-"));
  const tenderFolder = path.join(root, "T247-999001");
  const docs = path.join(tenderFolder, "documents");
  const staging = path.join(root, "staging");
  fs.mkdirSync(docs, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });

  fs.writeFileSync(path.join(staging, "notes.txt"), "Hello tender text mode", "utf8");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Item", "Qty"],
    ["Software", "1"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "BOQ");
  XLSX.writeFile(wb, path.join(staging, "boq.xlsx"));

  const zipPath = path.join(docs, "Tender_All_Documents.zip");
  execFileSync(
    "tar",
    ["-a", "-cf", zipPath, "-C", staging, "notes.txt", "boq.xlsx"],
    { windowsHide: true },
  );

  const bundle = await extractDocumentTextForTender({
    tenderFolder,
    tenderId: "999001",
  });

  assert.equal(bundle.tenderId, "T247-999001");
  assert.ok(bundle.filesExtracted >= 2);
  assert.ok(fs.existsSync(path.join(tenderFolder, "document-text.json")));
  const saved = JSON.parse(
    fs.readFileSync(path.join(tenderFolder, "document-text.json"), "utf8"),
  ) as { documents: Array<{ filename: string; text: string }> };
  assert.ok(saved.documents.some((d) => /Hello tender text mode/.test(d.text)));
  assert.ok(saved.documents.some((d) => /Software/.test(d.text)));
  // Originals preserved
  assert.ok(fs.existsSync(zipPath));
});

test("cleanExtractedDocumentText removes page numbers and duplicate headers", () => {
  const raw = [
    "Scope of Work: CMS website",
    "Page 1 of 40",
    "www.tender247.com",
    "Scope of Work: CMS website",
    "Scope of Work: CMS website",
    "",
    "",
    "EMD: Rs 50,000",
    "Page 2",
  ].join("\n");
  const cleaned = cleanExtractedDocumentText(raw);
  assert.match(cleaned, /CMS website/);
  assert.match(cleaned, /EMD/);
  assert.doesNotMatch(cleaned, /Page 1 of 40/i);
  assert.doesNotMatch(cleaned, /www\.tender247\.com/i);
  assert.equal((cleaned.match(/CMS website/g) || []).length, 1);
});

test("compressDocumentTextForPrompt caps context under max and writes summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-text-compress-"));
  const tenderFolder = path.join(root, "T247-999002");
  fs.mkdirSync(tenderFolder, { recursive: true });
  const huge = `${"Eligibility criteria for bidders. ".repeat(5_000)}EMD amount Rs 1 lakh. Scope of work software development.`;
  assert.ok(huge.length > 80_000);

  const compressed = compressDocumentTextForPrompt({
    tenderId: "999002",
    tenderFolder,
    documents: [{ filename: "NIT.pdf", text: huge }],
    maxContextCharacters: 50_000,
  });

  assert.equal(compressed.compressionApplied, true);
  assert.ok(compressed.finalContextLength <= 50_000);
  assert.ok(fs.existsSync(path.join(tenderFolder, "document-text-summary.json")));
  const summary = JSON.parse(
    fs.readFileSync(path.join(tenderFolder, "document-text-summary.json"), "utf8"),
  ) as { documents: Array<{ filename: string; eligibility: string }> };
  assert.equal(summary.documents[0]?.filename, "NIT.pdf");
  assert.match(summary.documents[0]?.eligibility || "", /Eligibility/i);
});

test("buildDocumentTextQualificationPrompt embeds prefs and compressed context", () => {
  const snapshot: CompanyPreferenceSnapshot = {
    company: {
      id: "x",
      name: "Siyana Info Solutions Pvt. Ltd.",
      industryType: "IT",
      businessLocation: "Chennai",
      website: null,
      yearEstablished: 2014,
      description: "Software",
      slug: "siyana",
    },
    preferences: {
      companyId: "x",
      maxEmdInr: 1_500_000,
      minTenderValueInr: null,
      maxTenderValueInr: 50_000_000,
      serviceScope: ["Software Development"],
      excludedScope: ["Hardware Only"],
      extras: {},
      updatedAt: null,
    },
    loadedAt: new Date().toISOString(),
  };
  const prompt = buildDocumentTextQualificationPrompt({
    tenderId: "123",
    companySnapshot: snapshot,
    metadataJson: '{"title":"CMS website"}',
    compressedDocumentContext:
      "DOCUMENT: NIT.pdf\n\nScope:\n- website development\n\nFinancial details:\n- EMD 50000",
  });
  assert.match(prompt, /DOCUMENT TEXT MODE QUALIFICATION/);
  assert.match(prompt, /Siyana Info Solutions/);
  assert.match(prompt, /Software Development/);
  assert.match(prompt, /Hardware Only/);
  assert.match(prompt, /Compressed document context/);
  assert.match(prompt, /DOCUMENT: NIT\.pdf/);
  assert.match(prompt, /website development/);
  assert.match(prompt, /Return JSON only/);
  assert.ok(prompt.length < 20_000);
});

test("resolveDocumentTextTenderTargets processes all date downloads when filter empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-text-all-"));
  for (const id of ["T247-1001", "T247-1002"]) {
    const docs = path.join(root, id, "documents");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(
      path.join(docs, "Tender_All_Documents.zip"),
      Buffer.from("PK\u0005\u0006"),
    );
  }
  // No ZIP → skipped
  fs.mkdirSync(path.join(root, "T247-1003"), { recursive: true });

  const all = resolveDocumentTextTenderTargets({
    dateFolder: root,
    configuredIds: [],
    maxTenders: 0,
  });
  assert.equal(all.length, 2);
  assert.deepEqual(
    all.map((t) => t.tenderId),
    ["1001", "1002"],
  );
  assert.ok(all.every((t) => t.source === "date_download"));

  const filtered = resolveDocumentTextTenderTargets({
    dateFolder: root,
    configuredIds: ["T247-1002"],
    maxTenders: 0,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.tenderId, "1002");
  assert.equal(filtered[0]!.source, "configured");
});
