import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseIndianCurrencyAmount } from "../bidassist/parseIndianCurrencyAmount.js";
import type { Logger } from "../logger.js";
import { ensureDir } from "../fileUtils.js";

const TEMP_EXTS = [".crdownload", ".tmp", ".download", ".part"];

/** Lightweight operational marker — not the former metadata.json payload. */
export const METADATA_SYNC_MARKER = "agenttender-metadata-sync.json";

export interface MetadataSyncMarker {
  sourcePortal: "TENDER247";
  sourceTenderId: string;
  contentHash: string | null;
  extractionStatus: "processing" | "complete" | "partial" | null;
  syncedAt: string;
  ok: boolean;
  error?: string | null;
}

export interface TenderResumeState {
  t247Id: string;
  tenderFolder: string;
  zipPath: string;
  metadataPath: string;
  metadataSyncPath: string;
  aiSummaryPath: string | null;
  allDocumentsPath: string | null;
  metadataValid: boolean;
  aiSummaryValid: boolean;
  allDocumentsValid: boolean;
  finalZipValid: boolean;
  folderExists: boolean;
}

export function isValidArtifact(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const lower = filePath.toLowerCase();
  if (TEMP_EXTS.some((ext) => lower.endsWith(ext))) {
    return false;
  }
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** metadata counts as done when Supabase sync marker or legacy metadata.json is complete. */
function isMetadataExtractionDone(metadataPath: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      metadataExtractionStatus?: string;
    };
    const status = data.metadataExtractionStatus;
    if (status === "processing") {
      return false;
    }
    // Legacy files without status still count if non-empty
    return status === "complete" || status === "partial" || status == null;
  } catch {
    return false;
  }
}

export function readMetadataSyncMarker(
  tenderFolder: string,
): MetadataSyncMarker | null {
  const markerPath = path.join(tenderFolder, METADATA_SYNC_MARKER);
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  try {
    return JSON.parse(
      fs.readFileSync(markerPath, "utf8"),
    ) as MetadataSyncMarker;
  } catch {
    return null;
  }
}

export function writeMetadataSyncMarker(
  tenderFolder: string,
  marker: MetadataSyncMarker,
): void {
  ensureDir(tenderFolder);
  fs.writeFileSync(
    path.join(tenderFolder, METADATA_SYNC_MARKER),
    JSON.stringify(marker, null, 2),
    "utf8",
  );
}

export function isMetadataResumeReady(tenderFolder: string): boolean {
  const marker = readMetadataSyncMarker(tenderFolder);
  if (marker?.ok) {
    const status = marker.extractionStatus;
    return status === "complete" || status === "partial" || status == null;
  }
  const legacyPath = path.join(tenderFolder, "metadata.json");
  return isValidArtifact(legacyPath) && isMetadataExtractionDone(legacyPath);
}

export function inspectTenderResumeState(
  dateFolder: string,
  t247Id: string,
): TenderResumeState {
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  const zipPath = path.join(dateFolder, `T247-${t247Id}.zip`);
  const metadataPath = path.join(tenderFolder, "metadata.json");
  const metadataSyncPath = path.join(tenderFolder, METADATA_SYNC_MARKER);
  const aiCanonical = path.join(tenderFolder, "AI_Summary.pdf");
  const documentsDir = path.join(tenderFolder, "documents");

  const folderExists =
    fs.existsSync(tenderFolder) && fs.statSync(tenderFolder).isDirectory();

  const finalZipValid = isValidArtifact(zipPath);
  const metadataValid = isMetadataResumeReady(tenderFolder);
  const aiSummaryValid = isValidArtifact(aiCanonical);
  const allDocumentsPath = folderExists
    ? findExistingAllDocumentsFile(documentsDir)
    : null;
  const allDocumentsValid = isValidArtifact(allDocumentsPath);

  return {
    t247Id,
    tenderFolder,
    zipPath,
    metadataPath,
    metadataSyncPath,
    aiSummaryPath: aiSummaryValid ? aiCanonical : null,
    allDocumentsPath: allDocumentsValid ? allDocumentsPath : null,
    metadataValid,
    aiSummaryValid,
    allDocumentsValid,
    finalZipValid,
    folderExists,
  };
}

/**
 * Find a valid Download All Documents artifact under documents/.
 * Accepts Tender_All_Documents* or any non-empty archive/file that is not temp.
 */
export function findExistingAllDocumentsFile(
  documentsDir: string,
): string | null {
  if (!fs.existsSync(documentsDir) || !fs.statSync(documentsDir).isDirectory()) {
    return null;
  }

  const entries = fs
    .readdirSync(documentsDir)
    .map((name) => path.join(documentsDir, name))
    .filter((p) => isValidArtifact(p));

  if (entries.length === 0) {
    return null;
  }

  // Prefer canonical Tender_All_Documents.*
  const canonical = entries.find((p) =>
    /^Tender_All_Documents(\.|$)/i.test(path.basename(p)),
  );
  if (canonical) {
    return canonical;
  }

  // Prefer Tender_All_Documents_* variants (will be cleaned later)
  const variants = entries
    .filter((p) => /^Tender_All_Documents/i.test(path.basename(p)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (variants[0]) {
    return variants[0];
  }

  // Fallback: largest non-temp file in documents/
  entries.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return entries[0] ?? null;
}

/**
 * Collapse Tender_All_Documents / _2 / _3 duplicates into one canonical file.
 */
export function consolidateAllDocumentsDuplicates(
  documentsDir: string,
  keepDebugFiles: boolean,
  logger: Logger,
): string | null {
  if (!fs.existsSync(documentsDir)) {
    return null;
  }

  const variants = fs
    .readdirSync(documentsDir)
    .filter((name) => /^Tender_All_Documents/i.test(name))
    .map((name) => path.join(documentsDir, name))
    .filter((p) => isValidArtifact(p));

  if (variants.length === 0) {
    // Remove invalid zero-byte / temp leftovers
    removeInvalidAllDocumentsArtifacts(documentsDir);
    return findExistingAllDocumentsFile(documentsDir);
  }

  // Prefer exact canonical name; if content differs across files, prefer newest
  const exactCanonical = variants.find((p) =>
    /^Tender_All_Documents\.[^.]+$/i.test(path.basename(p)),
  );

  let keeper = exactCanonical ?? variants[0]!;
  if (variants.length > 1) {
    const newest = [...variants].sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
    )[0]!;
    const keeperHash = fileSha256(keeper);
    const newestHash = fileSha256(newest);
    const same =
      fs.statSync(keeper).size === fs.statSync(newest).size &&
      keeperHash != null &&
      newestHash === keeperHash;
    if (!same) {
      keeper = newest;
    }
  }

  const ext = path.extname(keeper) || ".zip";
  const canonical = path.join(documentsDir, `Tender_All_Documents${ext}`);

  if (path.resolve(keeper) !== path.resolve(canonical)) {
    if (
      fs.existsSync(canonical) &&
      isValidArtifact(canonical) &&
      path.resolve(keeper) !== path.resolve(canonical)
    ) {
      // Replace canonical with keeper (newest / preferred)
      fs.unlinkSync(canonical);
    }
    if (fs.existsSync(canonical) && !isValidArtifact(canonical)) {
      fs.unlinkSync(canonical);
    }
    if (!fs.existsSync(canonical)) {
      fs.renameSync(keeper, canonical);
    }
  }

  const keeperHash = fileSha256(canonical);
  const keeperSize = isValidArtifact(canonical)
    ? fs.statSync(canonical).size
    : 0;

  for (const variant of variants) {
    if (!fs.existsSync(variant)) {
      continue;
    }
    if (path.resolve(variant) === path.resolve(canonical)) {
      continue;
    }
    const size = fs.statSync(variant).size;
    const same =
      size === keeperSize &&
      (keeperHash == null || fileSha256(variant) === keeperHash);

    if (same || !keepDebugFiles) {
      fs.unlinkSync(variant);
      logger.info(`Removed duplicate all-docs file=${path.basename(variant)}`);
    } else {
      const debugDir = path.join(documentsDir, "..", "debug", "duplicates");
      ensureDir(debugDir);
      const dest = path.join(debugDir, path.basename(variant));
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      fs.renameSync(variant, dest);
      logger.info(`Moved duplicate all-docs to debug=${dest}`);
    }
  }

  removeInvalidAllDocumentsArtifacts(documentsDir);
  return isValidArtifact(canonical) ? canonical : null;
}

export function removeInvalidAllDocumentsArtifacts(documentsDir: string): void {
  if (!fs.existsSync(documentsDir)) {
    return;
  }
  for (const name of fs.readdirSync(documentsDir)) {
    if (!/^Tender_All_Documents/i.test(name)) {
      continue;
    }
    const p = path.join(documentsDir, name);
    try {
      const st = fs.statSync(p);
      const lower = name.toLowerCase();
      const isTemp = TEMP_EXTS.some((ext) => lower.endsWith(ext));
      if (!st.isFile() || st.size <= 0 || isTemp) {
        fs.unlinkSync(p);
      }
    } catch {
      // ignore
    }
  }
}

function fileSha256(filePath: string): string | null {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * Parse monetary/amount fields safely. Never throws.
 * "Refer Document", N/A, etc. → null.
 * Delegates to the shared Indian-currency parser so Lac/Cr units are preserved.
 */
export function parseOptionalMoney(
  value: string | number | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }
  const parsed = parseIndianCurrencyAmount(value);
  return parsed.valid ? parsed.amount : null;
}
