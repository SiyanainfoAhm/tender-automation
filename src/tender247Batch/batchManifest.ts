import fs from "node:fs";
import path from "node:path";
import type { CrawlManifest, ManifestTenderEntry, TenderBatchStatus } from "./types.js";

export function createEmptyManifest(
  dateIso: string,
  expectedCount = 0,
  discoveredCount = 0,
): CrawlManifest {
  return {
    date: dateIso,
    expectedCount,
    discoveredCount,
    processedCount: 0,
    successCount: 0,
    partialCount: 0,
    failedCount: 0,
    tenders: {},
  };
}

export function loadManifest(manifestPath: string): CrawlManifest | null {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CrawlManifest;
  } catch {
    return null;
  }
}

export function saveManifest(manifestPath: string, manifest: CrawlManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  recalculateCounts(manifest);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export function upsertTenderEntry(
  manifest: CrawlManifest,
  t247Id: string,
  entry: ManifestTenderEntry,
): void {
  manifest.tenders[t247Id] = entry;
  recalculateCounts(manifest);
}

function recalculateCounts(manifest: CrawlManifest): void {
  const values = Object.values(manifest.tenders);
  manifest.processedCount = values.filter((t) =>
    [
      "completed",
      "partial",
      "pending",
      "failed",
      "dropped_non_it",
      "ambiguous_manual_review",
    ].includes(t.status),
  ).length;
  manifest.successCount = values.filter((t) => t.status === "completed").length;
  manifest.partialCount = values.filter((t) => t.status === "partial").length;
  manifest.failedCount = values.filter((t) => t.status === "failed").length;
}

/**
 * Skip re-processing when a non-empty T247-{ID}.zip already exists.
 * Prefers entry.zipPath when present; otherwise the standard date-folder zip path.
 * Does not require manifest status === "completed" — a valid ZIP is enough to avoid duplicates.
 */
export function isSkippableCompleted(
  entry: ManifestTenderEntry | undefined,
  zipPath: string,
): boolean {
  const candidates = [
    entry?.zipPath,
    zipPath,
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
      return true;
    }
  }
  return false;
}

export function ensurePendingEntries(
  manifest: CrawlManifest,
  t247Ids: string[],
): void {
  const now = new Date().toISOString();
  for (const id of t247Ids) {
    if (!manifest.tenders[id]) {
      manifest.tenders[id] = {
        status: "pending",
        zipPath: null,
        documentsDownloaded: 0,
        corrigendaDownloaded: 0,
        securityCodeCaptured: false,
        error: null,
        updatedAt: now,
      };
    }
  }
}

export function statusFromResult(
  allDocumentsDownloaded: boolean,
  zipOk: boolean,
  hardError: string | null,
): TenderBatchStatus {
  if (allDocumentsDownloaded && zipOk) {
    return "completed";
  }
  if (zipOk && !allDocumentsDownloaded) {
    return "partial";
  }
  if (hardError || !zipOk) {
    return "failed";
  }
  return "failed";
}
