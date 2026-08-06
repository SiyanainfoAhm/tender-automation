import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";
import { writeMetadataSyncMarker } from "../tender247Batch/resumeArtifacts.js";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import { upsertTender247Metadata } from "../supabase/tenderMetadataStore.js";
import type { TenderMetadata } from "./types.js";

/** Adapt the older detail-crawl metadata shape into the batch CompleteTenderMetadata form. */
export function toCompleteTenderMetadata(
  metadata: TenderMetadata,
): CompleteTenderMetadata {
  return {
    source: "tender247",
    t247Id: metadata.t247Id,
    detailUrl: metadata.sourceUrl,
    raw: {
      Organisation: metadata.extracted.organisation,
      Department: metadata.extracted.department,
      Location: metadata.extracted.location,
      EMD: metadata.extracted.emd,
      "Tender Estimated Cost": metadata.extracted.estimatedCost,
    },
    normalized: {
      tenderName: metadata.extracted.tenderName || metadata.listTitle,
      organisation: metadata.extracted.organisation,
      department: metadata.extracted.department,
      location: metadata.extracted.location,
      closingDate: metadata.listClosingDate || metadata.extracted.submissionDate,
      openingDate: metadata.extracted.openingDate,
      tenderValue: null,
      emdAmount: null,
      category: metadata.extracted.category,
      description: metadata.extracted.description,
      brief: metadata.extracted.brief,
    },
    tenderOverview: {},
    aiSummary: metadata.aiSummary.extraFields || {},
    downloads: {
      aiSummaryDownloaded: metadata.aiSummaryPdf?.status === "success",
      allDocumentsDownloaded: metadata.documents.some((d) => d.status === "success"),
      aiSummaryFile:
        metadata.aiSummaryPdf?.status === "success"
          ? metadata.aiSummaryPdf.finalFilename
          : null,
      allDocumentsFile: null,
    },
    processedAt: metadata.crawlCompletedAt || new Date().toISOString(),
    metadataExtractionStatus:
      metadata.extractionStatus === "success"
        ? "complete"
        : metadata.extractionStatus === "partial"
          ? "partial"
          : "processing",
    metadataExtractionError: metadata.error || null,
    status: metadata.downloadStatus,
  };
}

/**
 * Persist Tender247 metadata to Supabase only.
 * Does not write a permanent metadata.json under the tender folder.
 */
export async function writeTenderMetadata(
  metadataPath: string,
  metadata: TenderMetadata,
  logger: Logger,
): Promise<void> {
  const tenderFolder = path.dirname(metadataPath);
  const complete = toCompleteTenderMetadata(metadata);
  const result = await upsertTender247Metadata({
    metadata: complete,
    localFolderPath: tenderFolder,
    logger,
  });
  writeMetadataSyncMarker(tenderFolder, {
    sourcePortal: "TENDER247",
    sourceTenderId: metadata.t247Id,
    contentHash: result.contentHash,
    extractionStatus: complete.metadataExtractionStatus ?? null,
    syncedAt: new Date().toISOString(),
    ok: result.ok,
    error: result.error,
  });

  // Remove any leftover permanent metadata.json from earlier crawls
  if (result.ok && fs.existsSync(metadataPath)) {
    try {
      fs.rmSync(metadataPath, { force: true });
    } catch {
      // ignore
    }
  }

  logger.info(
    result.ok
      ? `metadata upserted to Supabase: T247-${metadata.t247Id}`
      : `metadata Supabase sync failed: T247-${metadata.t247Id}`,
  );
}
