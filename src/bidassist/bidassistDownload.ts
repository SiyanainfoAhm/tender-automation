import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Download, Locator, Page } from "playwright";
import { ensureDir, relocateFile } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { extractZipArchive, listFilesRecursive } from "../chatgptQualification/extractZip.js";
import type { BidassistConfig } from "./bidassistConfig.js";
import type {
  BidassistCardInfo,
  BidassistDocumentMeta,
  BidassistDownloadState,
  BidassistMetadata,
} from "./bidassistTypes.js";

const WINDOWS_INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeWindowsFileName(name: string): string {
  return name.replace(WINDOWS_INVALID, "_").replace(/\s+/g, " ").trim();
}

export function prefixBaFileName(originalName: string): string {
  const base = path.basename(originalName);
  if (/^ba-/i.test(base)) {
    return sanitizeWindowsFileName(base);
  }
  return sanitizeWindowsFileName(`ba-${base}`);
}

export function isSafeZipEntryName(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, "/");
  if (normalized.includes("..")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
    return false;
  }
  return true;
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Derive a stable tender id and BA- folder id.
 */
export function deriveBidassistIds(options: {
  detailUrl?: string;
  zipFileName?: string;
  title?: string;
  authority?: string;
  closingDate?: string;
}): { bidassistId: string; folderId: string } {
  const { detailUrl, zipFileName, title, authority, closingDate } = options;

  const candidates: string[] = [];

  if (detailUrl) {
    const gemInUrl = detailUrl.match(
      /(GEM[-_]?\d{4}[-_]?[A-Z]?[-_]?\d+)/i,
    );
    if (gemInUrl?.[1]) {
      candidates.push(gemInUrl[1]);
    }
    const idQuery = detailUrl.match(/[?&](?:id|tenderId|tender_id)=([^&]+)/i);
    if (idQuery?.[1]) {
      candidates.push(decodeURIComponent(idQuery[1]));
    }
    const pathId = detailUrl.match(/\/(?:tender|detail|view)\/([^/?#]+)/i);
    if (pathId?.[1] && pathId[1].length >= 6) {
      candidates.push(pathId[1]);
    }
  }

  if (zipFileName) {
    const fromZip = zipFileName.replace(/\.zip$/i, "");
    if (fromZip) {
      candidates.push(fromZip);
    }
  }

  let raw =
    candidates.find((c) => /GEM/i.test(c)) ||
    candidates.find((c) => c.length >= 6) ||
    "";

  if (!raw) {
    const seed = `${title || ""}|${authority || ""}|${closingDate || ""}`;
    const digest = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
    raw = `BAHASH-${digest}`;
  }

  const bidassistId = raw
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const folderId = bidassistId.toUpperCase().startsWith("BA-")
    ? bidassistId.toUpperCase().replace(/_/g, "-")
    : `BA-${bidassistId.toUpperCase().replace(/_/g, "-")}`;

  return { bidassistId, folderId };
}

export function tenderFolderPath(dayRoot: string, folderId: string): string {
  return path.join(dayRoot, folderId);
}

export function loadDownloadState(
  tenderFolder: string,
): BidassistDownloadState | null {
  const p = path.join(tenderFolder, "download-state.json");
  if (!fs.existsSync(p)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as BidassistDownloadState;
  } catch {
    return null;
  }
}

export function saveDownloadState(
  tenderFolder: string,
  state: BidassistDownloadState,
): void {
  ensureDir(tenderFolder);
  fs.writeFileSync(
    path.join(tenderFolder, "download-state.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

export function isBidassistTenderComplete(tenderFolder: string): boolean {
  const state = loadDownloadState(tenderFolder);
  if (state?.status !== "completed") {
    return false;
  }
  const originalDir = path.join(tenderFolder, "original");
  const documentsDir = path.join(tenderFolder, "documents");
  const metaPath = path.join(tenderFolder, "metadata.json");
  const syncMarker = path.join(tenderFolder, "agenttender-metadata-sync.json");

  const hasMetadataArtifact =
    (fs.existsSync(metaPath) && fs.statSync(metaPath).size > 0) ||
    (fs.existsSync(syncMarker) && fs.statSync(syncMarker).size > 0);
  if (!hasMetadataArtifact || !fs.existsSync(originalDir)) {
    return false;
  }
  const zips = fs
    .readdirSync(originalDir)
    .filter((n) => n.toLowerCase().endsWith(".zip"));
  if (zips.length === 0) {
    return false;
  }
  const zipPath = path.join(originalDir, zips[0]!);
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
    return false;
  }
  if (!fs.existsSync(documentsDir)) {
    return false;
  }
  const docs = fs.readdirSync(documentsDir).filter((n) => {
    const full = path.join(documentsDir, n);
    return fs.statSync(full).isFile();
  });
  if (docs.length === 0) {
    return false;
  }
  if (!docs.every((n) => /^ba-/i.test(n))) {
    return false;
  }
  if (fs.existsSync(metaPath)) {
    try {
      JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      return false;
    }
  }
  return true;
}

/** How long a click gets to produce a download, popup or navigation. */
const DOWNLOAD_TRIGGER_TIMEOUT_MS = 15_000;

/** Locate the final download control on a tender detail page or popup. */
async function downloadFromDetailPage(options: {
  page: Page;
  config: BidassistConfig;
}): Promise<Download | null> {
  const { page, config } = options;
  const control = page
    .getByRole("button", { name: /download/i })
    .or(page.getByRole("link", { name: /download/i }))
    .or(page.locator('button:has-text("Download"), a:has-text("Download")'))
    .last();

  if (!(await control.isVisible().catch(() => false))) {
    return null;
  }
  const downloadPromise = page
    .waitForEvent("download", { timeout: config.downloadTimeoutMs })
    .catch(() => null);
  await control.click({ timeout: 15_000 }).catch(() => undefined);
  return downloadPromise;
}

async function triggerCardDownload(options: {
  page: Page;
  downloadButton: Locator;
  config: BidassistConfig;
  logger: Logger;
  tenderId: string;
  force: boolean;
}): Promise<Download | null> {
  const { page, downloadButton, config, logger, tenderId, force } = options;
  const startUrl = page.url();

  // Both listeners must be armed before the click
  const downloadPromise = page
    .waitForEvent("download", { timeout: DOWNLOAD_TRIGGER_TIMEOUT_MS })
    .catch(() => null);
  const popupPromise = page
    .waitForEvent("popup", { timeout: DOWNLOAD_TRIGGER_TIMEOUT_MS })
    .catch(() => null);

  await downloadButton.click({ timeout: 15_000, force });
  logger.info(`BIDASSIST_DOWNLOAD_CLICKED=${tenderId}`);

  const direct = await downloadPromise;
  if (direct) {
    void popupPromise;
    return direct;
  }

  const popup = await popupPromise;
  if (popup) {
    logger.info("BIDASSIST_DOWNLOAD_POPUP_OPENED");
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    const popupDownload = await downloadFromDetailPage({ page: popup, config });
    await popup.close().catch(() => undefined);
    return popupDownload;
  }

  if (page.url() !== startUrl) {
    logger.info("BIDASSIST_DOWNLOAD_DETAIL_PAGE_OPENED");
    const detailDownload = await downloadFromDetailPage({ page, config });
    await page
      .goBack({ waitUntil: "domcontentloaded" })
      .catch(() => undefined);
    await page.waitForTimeout(1500);
    return detailDownload;
  }

  return null;
}

export async function downloadZipForCard(options: {
  page: Page;
  downloadButton: Locator;
  config: BidassistConfig;
  logger: Logger;
  tempDownloadDir: string;
  tenderId: string;
}): Promise<{ zipPath: string; suggestedFilename: string }> {
  const { page, downloadButton, config, logger, tempDownloadDir, tenderId } =
    options;
  ensureDir(tempDownloadDir);

  let download: Download | null = null;
  for (let attempt = 1; attempt <= 2 && !download; attempt += 1) {
    if (attempt === 2) {
      logger.warn(`BIDASSIST_DOWNLOAD_RETRY_FORCED=${tenderId}`);
      await downloadButton.scrollIntoViewIfNeeded().catch(() => undefined);
    }
    download = await triggerCardDownload({
      page,
      downloadButton,
      config,
      logger,
      tenderId,
      force: attempt === 2,
    });
  }

  if (!download) {
    throw new Error(
      `Download click produced no download, popup or navigation for ${tenderId}`,
    );
  }

  const suggested = download.suggestedFilename() || `bidassist-${Date.now()}.zip`;
  logger.info(`BIDASSIST_DOWNLOAD_EVENT_RECEIVED=${suggested}`);

  const tempPath = path.join(tempDownloadDir, sanitizeWindowsFileName(suggested));
  await download.saveAs(tempPath);

  if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
    throw new Error(`Downloaded file missing or empty: ${tempPath}`);
  }
  if (!/\.zip$/i.test(suggested) && !isZipMagic(tempPath)) {
    throw new Error(`Downloaded file is not a ZIP: ${suggested}`);
  }
  logger.info(`BIDASSIST_DOWNLOAD_SAVED=${suggested}`);

  return { zipPath: tempPath, suggestedFilename: suggested };
}

function isZipMagic(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      return buf.readUInt32LE(0) === 0x04034b50 || buf.readUInt32LE(0) === 0x06054b50;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export async function extractAndPrefixDocuments(options: {
  zipPath: string;
  tenderFolder: string;
  logger: Logger;
}): Promise<BidassistDocumentMeta[]> {
  const { zipPath, tenderFolder, logger } = options;
  const documentsDir = path.join(tenderFolder, "documents");
  const tempExtract = path.join(tenderFolder, ".extract-tmp");
  ensureDir(documentsDir);

  if (fs.existsSync(tempExtract)) {
    fs.rmSync(tempExtract, { recursive: true, force: true });
  }
  ensureDir(tempExtract);

  await extractZipArchive(zipPath, tempExtract);

  const extracted = listFilesRecursive(tempExtract);
  const safeFiles = extracted.filter((p) => {
    const rel = path.relative(tempExtract, p);
    return isSafeZipEntryName(rel);
  });

  if (safeFiles.length === 0) {
    throw new Error("ZIP contained zero safe extractable files");
  }

  logger.info(`BIDASSIST_EXTRACTED_FILE_COUNT=${safeFiles.length}`);

  const documents: BidassistDocumentMeta[] = [];
  let pdfCount = 0;
  let htmlCount = 0;

  for (const filePath of safeFiles) {
    const originalName = path.basename(filePath);
    const ext = path.extname(originalName).toLowerCase();
    if (ext === ".pdf") pdfCount += 1;
    if (ext === ".html" || ext === ".htm") htmlCount += 1;

    const storedName = prefixBaFileName(originalName);
    const dest = path.join(documentsDir, storedName);
    relocateFile(filePath, dest);
    logger.info(`BIDASSIST_DOCUMENT_RENAMED=${storedName}`);

    documents.push({
      originalName,
      storedName,
      extension: ext || path.extname(storedName),
      size: fs.statSync(dest).size,
      sha256: sha256File(dest),
    });
  }

  logger.info(`BIDASSIST_PDF_COUNT=${pdfCount}`);
  logger.info(`BIDASSIST_HTML_COUNT=${htmlCount}`);
  if (pdfCount === 1 && htmlCount === 1) {
    logger.info("BIDASSIST_DOCUMENTS_VALID");
  } else if (safeFiles.length > 2) {
    logger.warn(
      `BIDASSIST_UNEXPECTED_FILE_COUNT=${safeFiles.length} — all safe files retained`,
    );
  }

  // Cleanup temp extract
  try {
    fs.rmSync(tempExtract, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return documents;
}

export function writeBidassistMetadata(options: {
  tenderFolder: string;
  card: BidassistCardInfo;
  bidassistId: string;
  folderId: string;
  originalZipFile: string;
  documents: BidassistDocumentMeta[];
  openingDateFilterFrom: string;
  openingDateFilterTo: string | null;
  category: string;
  logger: Logger;
}): BidassistMetadata {
  const {
    tenderFolder,
    card,
    bidassistId,
    folderId,
    originalZipFile,
    documents,
    openingDateFilterFrom,
    openingDateFilterTo,
    category,
    logger,
  } = options;

  const metadata: BidassistMetadata = {
    sourcePortal: "BidAssist",
    sourcePrefix: "BA",
    bidassistId,
    folderId,
    title: card.title,
    authority: card.authority,
    description: card.description,
    category,
    sourceTenderPortal: card.sourceTenderPortal,
    city: card.city,
    state: card.state,
    closingDate: card.closingDate,
    openingDateFilterFrom,
    openingDateFilterTo,
    tenderAmountText: card.tenderAmountText,
    tenderDetailUrl: card.tenderDetailUrl,
    downloadedAt: new Date().toISOString(),
    originalZipFile,
    documents,
  };

  const keepLocal =
    process.env.KEEP_LOCAL_METADATA_JSON?.trim().toLowerCase() === "true" ||
    process.env.KEEP_LOCAL_METADATA_JSON?.trim() === "1";

  if (keepLocal) {
    fs.writeFileSync(
      path.join(tenderFolder, "metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );
    logger.info("BIDASSIST_METADATA_SAVED");
  } else {
    const legacy = path.join(tenderFolder, "metadata.json");
    if (fs.existsSync(legacy)) {
      try {
        fs.rmSync(legacy, { force: true });
      } catch {
        // ignore
      }
    }
    logger.info("BIDASSIST_METADATA_LOCAL_SKIPPED");
  }
  return metadata;
}

export function storeOriginalZip(options: {
  tempZipPath: string;
  tenderFolder: string;
  suggestedFilename: string;
}): string {
  const originalDir = path.join(options.tenderFolder, "original");
  ensureDir(originalDir);
  const destName = sanitizeWindowsFileName(
    options.suggestedFilename.toLowerCase().endsWith(".zip")
      ? options.suggestedFilename
      : `${options.suggestedFilename}.zip`,
  );
  const dest = path.join(originalDir, destName);
  relocateFile(options.tempZipPath, dest);
  return destName;
}
