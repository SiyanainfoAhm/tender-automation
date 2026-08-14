import assert from "node:assert/strict";
import test from "node:test";
import type { CompleteTenderMetadata } from "../../tender247Batch/extractCompleteMetadata.js";
import {
  buildTender247SupabaseRow,
  hashMetadataContent,
  mapDownloadStatus,
  parsePortalDate,
} from "../tenderMetadataMap.js";

const sample = (): CompleteTenderMetadata => ({
  source: "tender247",
  t247Id: "102667034",
  detailUrl: "https://www.tender247.com/auth/tender/102667034/abc",
  raw: {
    Organisation: "Sample Org",
    EMD: "Rs. 7,50,000.00",
    "Tender Estimated Cost": "36868000",
  },
  normalized: {
    tenderName: "Sample tender title",
    organisation: "Sample Org",
    department: null,
    location: "Lucknow, Uttar Pradesh",
    closingDate: "17-08-2026",
    openingDate: "17-08-2026",
    tenderValue: 36868000,
    emdAmount: 750000,
    category: "IT",
    description: null,
    brief: null,
  },
  tenderOverview: {
    "Site Location -": "Lucknow, Uttar Pradesh",
  },
  aiSummary: {},
  downloads: {
    aiSummaryDownloaded: true,
    allDocumentsDownloaded: true,
    aiSummaryFile: "AI_Summary.pdf",
    allDocumentsFile: "documents/Tender_All_Documents.zip",
  },
  processedAt: "2026-08-05T05:38:51.915Z",
  metadataExtractionStatus: "complete",
  metadataExtractionError: null,
  securityCodeCaptured: true,
  status: "processing",
});

test("parsePortalDate accepts DMY and ISO formats", () => {
  assert.equal(parsePortalDate("17-08-2026"), "2026-08-17");
  assert.equal(parsePortalDate("17/08/2026"), "2026-08-17");
  assert.equal(parsePortalDate("2026-08-17"), "2026-08-17");
  assert.equal(parsePortalDate(""), null);
});

test("buildTender247SupabaseRow maps CompleteTenderMetadata fields", () => {
  const row = buildTender247SupabaseRow({
    metadata: sample(),
    localFolderPath: "downloads/2026-08-05/T247-102667034",
  });
  assert.equal(row.source_portal, "TENDER247");
  assert.equal(row.source_tender_id, "102667034");
  assert.equal(row.folder_id, "T247-102667034");
  assert.equal(row.title, "Sample tender title");
  assert.equal(row.category, "IT");
  assert.equal(row.project_category, "Other");
  assert.equal(row.organization, "Sample Org");
  assert.equal(row.city, "Lucknow");
  assert.equal(row.state, "Uttar Pradesh");
  assert.equal(row.closing_date, "2026-08-17");
  assert.equal(row.opening_date, "2026-08-17");
  assert.equal(row.tender_value, 36868000);
  assert.equal(row.emd_amount, 750000);
  assert.equal(row.download_status, "READY");
  assert.equal(row.ai_summary_available, true);
  assert.equal(row.document_archive_available, true);
  assert.equal((row.raw_metadata as CompleteTenderMetadata).t247Id, "102667034");
  assert.equal(row.content_hash.length, 64);
});

test("mapDownloadStatus marks sync failures", () => {
  assert.equal(
    mapDownloadStatus({ metadata: sample(), syncFailed: true }),
    "DB_SYNC_FAILED",
  );
});

test("hashMetadataContent is stable for the same payload", () => {
  const a = hashMetadataContent(sample());
  const b = hashMetadataContent(sample());
  assert.equal(a, b);
});
