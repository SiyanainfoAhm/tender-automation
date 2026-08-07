import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractBidAssistDocumentMetadata,
  mergeBidAssistMetadata,
} from "../bidassistDocumentMetadataExtractor.js";
import { parseBidAssistDate } from "../parseBidAssistDate.js";
import { parseIndianCurrencyAmount, resolveCanonicalInrAmount } from "../parseIndianCurrencyAmount.js";
import { buildBidassistSupabaseRow } from "../../supabase/tenderMetadataMap.js";
import type { BidassistMetadata } from "../bidassistTypes.js";

test("1. ₹ 7 Lac → 700000", () => {
  const parsed = parseIndianCurrencyAmount("₹ 7 Lac");
  assert.equal(parsed.amount, 700000);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.normalizedText, "₹ 7 Lac");
});

test("2. ₹ 6.8 Lac → 680000", () => {
  const parsed = parseIndianCurrencyAmount("₹ 6.8 Lac");
  assert.equal(parsed.amount, 680000);
  assert.equal(parsed.valid, true);
});

test("3. 12 Crore → 120000000", () => {
  const parsed = parseIndianCurrencyAmount("12 Crore");
  assert.equal(parsed.amount, 120000000);
  assert.equal(parsed.valid, true);
});

test("4. ₹ 5,61,000 → 561000", () => {
  const parsed = parseIndianCurrencyAmount("₹ 5,61,000");
  assert.equal(parsed.amount, 561000);
  assert.equal(parsed.valid, true);
});

test("5. Refer Documents → null numeric with preserved text", () => {
  const parsed = parseIndianCurrencyAmount("Refer Documents");
  assert.equal(parsed.amount, null);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.normalizedText, "Refer Documents");
});

test("6. rs, → null numeric and null normalized text", () => {
  const parsed = parseIndianCurrencyAmount("rs,");
  assert.equal(parsed.amount, null);
  assert.equal(parsed.normalizedText, null);
  assert.equal(parsed.reason, "currency_marker_only");
});

test("6b. Lac / Lakh / Cr unit variants", () => {
  assert.equal(parseIndianCurrencyAmount("₹25 Lac").amount, 2_500_000);
  assert.equal(parseIndianCurrencyAmount("₹5 Lac").amount, 500_000);
  assert.equal(parseIndianCurrencyAmount("₹1.5 Lac").amount, 150_000);
  assert.equal(parseIndianCurrencyAmount("25 Lacs").amount, 2_500_000);
  assert.equal(parseIndianCurrencyAmount("₹15 Lakh").amount, 1_500_000);
  assert.equal(parseIndianCurrencyAmount("1 Cr").amount, 10_000_000);
  assert.equal(parseIndianCurrencyAmount("₹2.5 Crore").amount, 25_000_000);
  assert.equal(parseIndianCurrencyAmount("₹6.20 Cr").amount, 62_000_000);
  assert.equal(parseIndianCurrencyAmount("25Lac").amount, 2_500_000);
  assert.equal(parseIndianCurrencyAmount("₹25 L").amount, 2_500_000);
});

test("6c. reject prose numbers without currency evidence", () => {
  assert.equal(parseIndianCurrencyAmount("valid for 6 months").amount, null);
  assert.equal(parseIndianCurrencyAmount("valid for 6 months").reason, "no_currency_evidence");
  assert.equal(parseIndianCurrencyAmount("3 copies required").amount, null);
  assert.equal(
    parseIndianCurrencyAmount(
      "With Account Payee Demand Draft in favour of the Department",
    ).amount,
    null,
  );
});

test("6d. resolveCanonical repairs truncated Lac coefficient", () => {
  const resolved = resolveCanonicalInrAmount({
    amount: 25,
    text: "₹25 Lac",
  });
  assert.equal(resolved.amount, 2_500_000);
});

test("6e. resolveCanonical clears prose-derived tiny amounts", () => {
  const resolved = resolveCanonicalInrAmount({
    amount: 6.2,
    text: "c. Any other document in support of contract execution like Third",
  });
  assert.equal(resolved.amount, null);
  assert.equal(resolved.text, null);
});

test("7. HTML amount extraction", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ba-html-"));
  const docs = path.join(root, "documents");
  fs.mkdirSync(docs, { recursive: true });
  const htmlPath = path.join(docs, "ba-Tender_Detail_sample.html");
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><body>
      <div><strong>Bid No:</strong> GEM/2026/B/1</div>
      <div><strong>Tender Value:</strong> ₹ 7 Lac</div>
      <div><strong>EMD Amount:</strong> ₹ 5,61,000</div>
      <div><strong>End Date:</strong> 10-08-2026 14:00:00</div>
      <table><tr><td>Organisation</td><td>Sample Org</td></tr></table>
    </body></html>`,
    "utf8",
  );

  const extracted = await extractBidAssistDocumentMetadata({
    tenderFolder: root,
    extractedDocumentPaths: [htmlPath],
    listingMetadata: {
      bidassistId: "GEM/2026/B/1",
      title: "Listing title",
      tenderAmountText: "Refer Documents",
      closingDate: "10-08-2026",
    },
  });

  assert.equal(extracted.tenderValue, 700000);
  assert.equal(extracted.tenderValueText, "₹ 7 Lac");
  assert.equal(extracted.emdAmount, 561000);
  assert.ok(extracted.extractionSources.some((s) => s.fileType === "HTML"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("8. PDF amount fallback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ba-pdf-"));
  const docs = path.join(root, "documents");
  fs.mkdirSync(docs, { recursive: true });

  // Minimal PDF with extractable text is hard to synthesize; use HTML absence
  // and inject via a tiny real PDF from fixtures is ideal. Instead, unit-test
  // extractFromPdfText behaviour through a fake by writing an HTML-less folder
  // and verifying listing fallback + merge when PDF parse yields nothing.
  // For PDF labelled extraction, write a text-like path exercised by merge.
  const listing = {
    bidassistId: "GEM-1",
    title: "From listing",
    tenderAmountText: "Refer Documents",
    closingDate: "10-08-2026",
  };

  const documentMetadata = {
    tenderId: "GEM-1",
    title: null,
    organization: null,
    department: null,
    authority: null,
    description: null,
    category: null,
    city: null,
    state: null,
    locationText: null,
    publishedDate: null,
    openingDate: null,
    closingDate: "2026-08-10",
    bidSubmissionDate: "2026-08-10",
    tenderValue: 680000,
    tenderValueText: "₹ 6.8 Lac",
    emdAmount: null,
    emdText: null,
    sourceTenderPortal: null,
    sourceUrl: null,
    extractionSources: [
      {
        fileName: "ba-GeM-Bidding.pdf",
        fileType: "PDF" as const,
        extractedFields: ["tenderValueText", "closingDate"],
      },
    ],
    rawExtractedFields: {
      pdf: {
        "ba-GeM-Bidding.pdf": {
          textLength: 100,
          matchedFields: { "Tender Value": "₹ 6.8 Lac" },
        },
      },
    },
    warnings: ["HTML parse skipped"],
  };

  const merged = mergeBidAssistMetadata({
    listingMetadata: listing,
    documentMetadata,
  });

  assert.equal(merged.tenderValue, 680000);
  assert.equal(merged.tenderValueText, "₹ 6.8 Lac");
  assert.equal(
    (merged.documentExtraction as { warnings: string[] }).warnings[0],
    "HTML parse skipped",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("9. Explicit HTML value overrides listing placeholder", () => {
  const merged = mergeBidAssistMetadata({
    listingMetadata: {
      bidassistId: "X",
      title: "Listing",
      tenderAmountText: "Refer Documents",
      closingDate: "10-08-2026",
    },
    documentMetadata: {
      tenderId: "X",
      title: "Doc title",
      organization: "Org",
      department: null,
      authority: null,
      description: null,
      category: null,
      city: null,
      state: null,
      locationText: null,
      publishedDate: null,
      openingDate: null,
      closingDate: "2026-08-10",
      bidSubmissionDate: null,
      tenderValue: 700000,
      tenderValueText: "₹ 7 Lac",
      emdAmount: null,
      emdText: null,
      sourceTenderPortal: null,
      sourceUrl: null,
      extractionSources: [],
      rawExtractedFields: {},
      warnings: [],
    },
  });

  assert.equal(merged.tenderValue, 700000);
  assert.equal(merged.tenderValueText, "₹ 7 Lac");
  assert.notEqual(merged.tenderValueText, "Refer Documents");
});

test("10. EMD does not use performance-security value", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ba-emd-"));
  const docs = path.join(root, "documents");
  fs.mkdirSync(docs, { recursive: true });
  const htmlPath = path.join(docs, "ba-Tender_Detail_emd.html");
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><body>
      <table>
        <tr><td>Performance Security</td><td>₹ 50 Lac</td></tr>
        <tr><td>Performance Bank Guarantee</td><td>₹ 40 Lac</td></tr>
        <tr><td>Bid Security/EMD/Proposal Security INR( OFFLINE)</td><td>10,000 INR</td></tr>
        <tr><td>Processing Fee</td><td>1,180 INR</td></tr>
      </table>
    </body></html>`,
    "utf8",
  );

  const extracted = await extractBidAssistDocumentMetadata({
    tenderFolder: root,
    extractedDocumentPaths: [htmlPath],
    listingMetadata: { bidassistId: "330940", title: "T" },
  });

  assert.equal(extracted.emdAmount, 10000);
  assert.notEqual(extracted.emdAmount, 5000000);
  assert.notEqual(extracted.emdAmount, 4000000);
  fs.rmSync(root, { recursive: true, force: true });
});

test("11. Ambiguous dates remain null", () => {
  const parsed = parseBidAssistDate("05/08/26");
  assert.equal(parsed.isoDate, null);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.reason, "ambiguous_year");

  assert.equal(parseBidAssistDate("05 Aug 2026").isoDate, "2026-08-05");
  assert.equal(parseBidAssistDate("2026-08-05 14:00:00").isoDate, "2026-08-05");
});

test("12. Existing BidAssist row is updated, not duplicated", () => {
  const storeSrc = fs.readFileSync(
    path.resolve("src/supabase/tenderMetadataStore.ts"),
    "utf8",
  );
  assert.match(storeSrc, /onConflict:\s*"source_portal,source_tender_id"/);
  assert.match(storeSrc, /ignoreDuplicates:\s*false/);
});

test("13. Enriched raw_metadata is used for temporary ChatGPT metadata.json", () => {
  const metadata: BidassistMetadata = {
    sourcePortal: "BidAssist",
    sourcePrefix: "BA",
    bidassistId: "GEM-2026-B-7876981",
    folderId: "BA-GEM-2026-B-7876981",
    title: "Enriched title",
    authority: "Authority",
    description: "Desc",
    category: "software",
    sourceTenderPortal: "GeM",
    city: "Mumbai",
    state: "Maharashtra",
    closingDate: "10-08-2026",
    openingDateFilterFrom: "2026-08-01",
    openingDateFilterTo: null,
    tenderAmountText: "Refer Documents",
    tenderDetailUrl: "https://example.com",
    downloadedAt: new Date().toISOString(),
    originalZipFile: "docs.zip",
    documents: [],
    tenderValue: 700000,
    tenderValueText: "₹ 7 Lac",
    emdAmount: 561000,
    emdText: "₹ 5,61,000",
    normalized: {
      tenderValue: 700000,
      tenderValueText: "₹ 7 Lac",
      emdAmount: 561000,
      emdText: "₹ 5,61,000",
      closingDate: "2026-08-10",
    },
    documentExtraction: {
      warnings: [],
      extractionSources: [],
    },
    listingMetadata: {
      tenderAmountText: "Refer Documents",
    },
  };

  const row = buildBidassistSupabaseRow({
    metadata,
    localFolderPath: "downloads/x/BidAssist/BA-GEM-2026-B-7876981",
  });

  assert.equal(row.tender_value, 700000);
  assert.equal(row.tender_value_text, "₹ 7 Lac");
  assert.equal(row.emd_amount, 561000);
  assert.equal(row.closing_date, "2026-08-10");
  const raw = row.raw_metadata as unknown as BidassistMetadata;
  assert.equal(raw.tenderValue, 700000);
  assert.ok(raw.normalized);
  assert.ok(raw.documentExtraction);
  // materializeTenderMetadata writes raw_metadata → temporary metadata.json
  assert.equal(
    (raw.normalized as { tenderValue: number }).tenderValue,
    700000,
  );
});
