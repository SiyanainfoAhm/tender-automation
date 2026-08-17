import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import type { Logger } from "../logger.js";
import { ensureDir } from "../fileUtils.js";
import { dismissTender247Interruptions } from "./dismissTender247Interruptions.js";
import { AutomationError } from "../browserUtils.js";
import {
  assertInside,
  extensionFromFilename,
  guessExtensionFromUrl,
  sanitizeFileName,
} from "./tenderFolder.js";
import type { DownloadedFileRecord } from "./types.js";
import { correctArtifactFileExtension } from "../tender247Batch/detectDownloadedKind.js";

export interface DownloadClickOptions {
  page: Page;
  context: BrowserContext;
  clickTarget: () => Promise<void>;
  destinationDir: string;
  preferredBaseName: string;
  preferredExtension?: string;
  /** When set, always save to this exact path (no _2/_3). */
  canonicalFileName?: string;
  timeoutMs: number;
  logger: Logger;
  kind: DownloadedFileRecord["kind"];
  linkText: string;
  publishedDate?: string | null;
  corrigendumType?: string | null;
  t247Id?: string;
}

const activeDownloadPromises = new Set<Promise<unknown>>();

/** Track in-flight download saves so ZIP/tab-close can wait. */
export function trackDownloadPromise<T>(promise: Promise<T>): Promise<T> {
  activeDownloadPromises.add(promise);
  void promise.finally(() => {
    activeDownloadPromises.delete(promise);
  });
  return promise;
}

export async function waitForAllActiveDownloads(): Promise<void> {
  const pending = [...activeDownloadPromises];
  if (pending.length === 0) {
    return;
  }
  await Promise.all(pending);
}

/**
 * Click a download control and save the resulting file.
 * Completion is the Playwright `download` event + saveAs, never click+sleep
 * and never "a popup opened".
 */
export async function clickAndSaveDownload(
  options: DownloadClickOptions,
): Promise<DownloadedFileRecord> {
  const {
    page,
    context,
    clickTarget,
    destinationDir,
    preferredBaseName,
    preferredExtension,
    timeoutMs,
    logger,
    kind,
    linkText,
  } = options;

  ensureDir(destinationDir);
  const urlBefore = page.url();
  const saveOpts = {
    destinationDir,
    preferredBaseName,
    preferredExtension,
    canonicalFileName: options.canonicalFileName,
    logger,
    kind,
    linkText,
    publishedDate: options.publishedDate,
    corrigendumType: options.corrigendumType,
    t247Id: options.t247Id,
  };

  await dismissInterruptionsBeforeClick(page, logger);

  const download = await clickAndWaitForPlaywrightDownload({
    page,
    context,
    timeoutMs,
    clickTarget: async () => {
      await clickTarget();
      if (/download\s+all\s+documents/i.test(linkText)) {
        logDownload(logger, options.t247Id, "DOWNLOAD_ALL_CLICKED");
      }
    },
  });

  if (download) {
    logDownload(logger, options.t247Id, "DOWNLOAD_EVENT_RECEIVED");
    logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_START");
    const saved = await trackDownloadPromise(
      savePlaywrightDownload(download, saveOpts),
    );
    const failure = await download.failure();
    if (failure) {
      return failedRecord(
        kind,
        linkText,
        `Tender247 Download All failed: ${failure}`,
        options,
      );
    }
    logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_DONE");
    return saved;
  }

  await dismissInterruptionsBeforeClick(page, logger);
  const urlAfter = page.url();
  if (urlAfter !== urlBefore && looksLikeDocumentUrl(urlAfter)) {
    logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_START");
    const saved = await saveUrlResponse(page, urlAfter, {
      ...saveOpts,
      preferredExtension:
        preferredExtension || guessExtensionFromUrl(urlAfter) || "pdf",
    });
    logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_DONE");
    return saved;
  }

  return failedRecord(
    kind,
    linkText,
    "No download event, popup, or file response detected after click",
    options,
  );
}

/**
 * Arm Playwright's download listener, then click. A popup/new tab is only
 * another source of a `download` event — never completion by itself.
 */
export async function clickAndWaitForPlaywrightDownload(options: {
  page: Page;
  context: BrowserContext;
  timeoutMs: number;
  clickTarget: () => Promise<void>;
}): Promise<Download | null> {
  const { page, context, timeoutMs, clickTarget } = options;
  let popupDownload: Download | null = null;
  const onPage = (popup: Page): void => {
    void popup
      .waitForEvent("download", { timeout: timeoutMs })
      .then((download) => {
        popupDownload = download;
      })
      .catch(() => undefined);
  };
  context.on("page", onPage);
  try {
    const pageDownloadPromise = page
      .waitForEvent("download", { timeout: timeoutMs })
      .catch(() => null);
    await clickTarget();
    const download = (await pageDownloadPromise) || popupDownload;
    if (download) return download;
    const deadline = Date.now() + 2_000;
    while (!popupDownload && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return popupDownload;
  } finally {
    context.off("page", onPage);
  }
}

/**
 * Register download listeners BEFORE click. A new tab is only used as
 * another source of the `download` event — never as completion by itself.
 */
export function waitForDownloadOnPageOrPopup(
  page: Page,
  context: BrowserContext,
  timeoutMs: number,
): Promise<Download | null> {
  return clickAndWaitForPlaywrightDownload({
    page,
    context,
    timeoutMs,
    clickTarget: async () => undefined,
  });
}

function logDownload(
  logger: Logger,
  t247Id: string | undefined,
  event: string,
): void {
  if (t247Id) {
    logger.info(`[T247 ${t247Id}] ${event}`);
  } else {
    logger.info(event);
  }
}

function looksLikeDocumentUrl(url: string): boolean {
  if (!url || url === "about:blank") return false;
  if (url.startsWith("blob:")) return true;
  return (
    /\.(pdf|zip|docx?|xlsx?)(\?|$)/i.test(url) || /\/download\b/i.test(url)
  );
}

/**
 * Save a Playwright download atomically. Content type (magic bytes) wins
 * over a preferred .zip extension so PDFs are never renamed into fake ZIPs.
 */
export async function savePlaywrightDownload(
  download: Download,
  opts: {
    destinationDir: string;
    preferredBaseName: string;
    preferredExtension?: string;
    canonicalFileName?: string;
    logger: Logger;
    kind: DownloadedFileRecord["kind"];
    linkText: string;
    publishedDate?: string | null;
    corrigendumType?: string | null;
  },
): Promise<DownloadedFileRecord> {
  const suggested = download.suggestedFilename() || "";
  const suggestedExt = extensionFromFilename(suggested);
  const fallbackExt =
    suggestedExt ||
    opts.preferredExtension ||
    guessExtensionFromUrl(download.url()) ||
    "bin";

  ensureDir(opts.destinationDir);
  const tmpDir = path.join(opts.destinationDir, "_tmp");
  ensureDir(tmpDir);
  const temporaryPath = path.join(
    tmpDir,
    `${sanitizeFileName(opts.preferredBaseName)}.download`,
  );
  assertInside(tmpDir, temporaryPath);
  if (fs.existsSync(temporaryPath)) {
    fs.unlinkSync(temporaryPath);
  }

  try {
    await download.saveAs(temporaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedRecord(
      opts.kind,
      opts.linkText,
      `DOWNLOAD_SAVE_FAILED:${message}`,
      opts,
    );
  }

  const tempStat = await fs.promises.stat(temporaryPath).catch(() => null);
  if (!tempStat || !tempStat.isFile() || tempStat.size <= 0) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    return failedRecord(
      opts.kind,
      opts.linkText,
      "DOWNLOADED_FILE_EMPTY",
      opts,
    );
  }

  persistSourceDownload(
    opts.destinationDir,
    suggested || path.basename(temporaryPath),
    temporaryPath,
    opts.kind,
  );

  const correctedTemp = correctArtifactFileExtension(temporaryPath);
  const detectedExt = (
    extensionFromFilename(correctedTemp) || fallbackExt
  ).replace(/^\./, "");
  const ext =
    detectedExt.toLowerCase() === "download"
      ? fallbackExt.replace(/^\./, "")
      : detectedExt;

  const canonicalName = resolveSavedFileName(opts, ext);
  const canonicalPath = path.join(opts.destinationDir, canonicalName);
  assertInside(opts.destinationDir, canonicalPath);

  if (
    fs.existsSync(canonicalPath) &&
    path.resolve(canonicalPath) !== path.resolve(correctedTemp)
  ) {
    const existing = await fs.promises.stat(canonicalPath);
    if (existing.size > 0) {
      await fs.promises.unlink(correctedTemp).catch(() => undefined);
      opts.logger.info(
        `Download skipped — canonical already valid: ${canonicalName}`,
      );
      return {
        kind: opts.kind,
        linkText: opts.linkText,
        originalFilename: suggested || null,
        finalFilename: canonicalName,
        relativePath: path
          .relative(process.cwd(), canonicalPath)
          .replace(/\\/g, "/"),
        sizeBytes: existing.size,
        status: "success",
        publishedDate: opts.publishedDate ?? null,
        corrigendumType: opts.corrigendumType ?? null,
      };
    }
    await fs.promises.unlink(canonicalPath);
  }

  if (path.resolve(correctedTemp) !== path.resolve(canonicalPath)) {
    await fs.promises.rename(correctedTemp, canonicalPath);
  }
  const sizeBytes = (await fs.promises.stat(canonicalPath)).size;
  if (sizeBytes <= 0) {
    return failedRecord(
      opts.kind,
      opts.linkText,
      "DOWNLOADED_FILE_EMPTY",
      opts,
    );
  }

  opts.logger.info(
    `Downloaded ${opts.kind}: ${canonicalName} (${sizeBytes} bytes) from "${opts.linkText}"`,
  );

  return {
    kind: opts.kind,
    linkText: opts.linkText,
    originalFilename: suggested || null,
    finalFilename: canonicalName,
    relativePath: path
      .relative(process.cwd(), canonicalPath)
      .replace(/\\/g, "/"),
    sizeBytes,
    status: "success",
    publishedDate: opts.publishedDate ?? null,
    corrigendumType: opts.corrigendumType ?? null,
  };
}

async function saveUrlResponse(
  page: Page,
  url: string,
  opts: {
    destinationDir: string;
    preferredBaseName: string;
    preferredExtension: string;
    canonicalFileName?: string;
    logger: Logger;
    kind: DownloadedFileRecord["kind"];
    linkText: string;
    publishedDate?: string | null;
    corrigendumType?: string | null;
  },
): Promise<DownloadedFileRecord> {
  if (!url || url === "about:blank") {
    return failedRecord(opts.kind, opts.linkText, "Empty popup URL", opts);
  }

  const response = await page.context().request.get(url);
  if (!response.ok()) {
    return failedRecord(
      opts.kind,
      opts.linkText,
      `HTTP ${response.status()} fetching ${url}`,
      opts,
    );
  }
  const body = await response.body();
  if (body.byteLength <= 0) {
    return failedRecord(opts.kind, opts.linkText, "Empty HTTP body", opts);
  }

  const disposition = response.headers()["content-disposition"] ?? "";
  const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  const originalFilename = nameMatch?.[1]
    ? decodeURIComponent(nameMatch[1].replace(/"/g, ""))
    : null;
  const ext =
    (originalFilename && extensionFromFilename(originalFilename)) ||
    opts.preferredExtension ||
    "bin";

  ensureDir(opts.destinationDir);
  const temporaryPath = path.join(
    opts.destinationDir,
    `${sanitizeFileName(opts.preferredBaseName)}.download`,
  );
  assertInside(opts.destinationDir, temporaryPath);
  if (fs.existsSync(temporaryPath)) {
    fs.unlinkSync(temporaryPath);
  }
  fs.writeFileSync(temporaryPath, body);

  const tempStat = fs.statSync(temporaryPath);
  if (tempStat.size <= 0) {
    fs.unlinkSync(temporaryPath);
    return failedRecord(opts.kind, opts.linkText, "DOWNLOADED_FILE_EMPTY", opts);
  }

  persistSourceDownload(
    opts.destinationDir,
    originalFilename || path.basename(temporaryPath),
    temporaryPath,
    opts.kind,
  );

  const correctedTemp = correctArtifactFileExtension(temporaryPath);
  const detectedExt = (
    extensionFromFilename(correctedTemp) || ext
  ).replace(/^\./, "");
  const canonicalName = resolveSavedFileName(opts, detectedExt);
  const canonicalPath = path.join(opts.destinationDir, canonicalName);
  assertInside(opts.destinationDir, canonicalPath);
  ensureDir(opts.destinationDir);

  if (
    fs.existsSync(canonicalPath) &&
    path.resolve(canonicalPath) !== path.resolve(correctedTemp)
  ) {
    const existing = fs.statSync(canonicalPath);
    if (existing.size > 0) {
      fs.unlinkSync(correctedTemp);
      return {
        kind: opts.kind,
        linkText: opts.linkText,
        originalFilename,
        finalFilename: canonicalName,
        relativePath: path
          .relative(process.cwd(), canonicalPath)
          .replace(/\\/g, "/"),
        sizeBytes: existing.size,
        status: "success",
        publishedDate: opts.publishedDate ?? null,
        corrigendumType: opts.corrigendumType ?? null,
      };
    }
    fs.unlinkSync(canonicalPath);
  }

  if (path.resolve(correctedTemp) !== path.resolve(canonicalPath)) {
    fs.renameSync(correctedTemp, canonicalPath);
  }
  const sizeBytes = fs.statSync(canonicalPath).size;
  opts.logger.info(
    `Downloaded ${opts.kind} via URL: ${canonicalName} (${sizeBytes} bytes)`,
  );

  return {
    kind: opts.kind,
    linkText: opts.linkText,
    originalFilename,
    finalFilename: canonicalName,
    relativePath: path
      .relative(process.cwd(), canonicalPath)
      .replace(/\\/g, "/"),
    sizeBytes,
    status: "success",
    publishedDate: opts.publishedDate ?? null,
    corrigendumType: opts.corrigendumType ?? null,
  };
}

function resolveSavedFileName(
  opts: {
    preferredBaseName: string;
    canonicalFileName?: string;
  },
  detectedExt: string,
): string {
  const ext = detectedExt.replace(/^\./, "").toLowerCase() || "bin";
  if (opts.canonicalFileName) {
    const canonicalExt = extensionFromFilename(opts.canonicalFileName)?.toLowerCase();
    if (canonicalExt === ext) {
      return opts.canonicalFileName;
    }
  }
  return `${sanitizeFileName(opts.preferredBaseName)}.${ext}`;
}

function persistSourceDownload(
  destinationDir: string,
  originalName: string,
  savedPath: string,
  kind: DownloadedFileRecord["kind"],
): void {
  if (kind !== "document") return;
  try {
    const sourceDir = path.join(destinationDir, "_source_download");
    ensureDir(sourceDir);
    const base = sanitizeFileName(originalName || path.basename(savedPath));
    const dest = path.join(sourceDir, base || path.basename(savedPath));
    assertInside(sourceDir, dest);
    fs.copyFileSync(savedPath, dest);
  } catch {
    // Source copy is debug-only; never fail the real download.
  }
}

function failedRecord(
  kind: DownloadedFileRecord["kind"],
  linkText: string,
  error: string,
  opts: { publishedDate?: string | null; corrigendumType?: string | null },
): DownloadedFileRecord {
  return {
    kind,
    linkText,
    originalFilename: null,
    finalFilename: "",
    relativePath: "",
    sizeBytes: 0,
    status: "failed",
    error,
    publishedDate: opts.publishedDate ?? null,
    corrigendumType: opts.corrigendumType ?? null,
  };
}

export function documentBaseNameFromLinkText(
  linkText: string,
  index: number,
): string {
  const cleaned = linkText
    .replace(/download/gi, "")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^nit\b/i.test(cleaned) || /\bnit\b/i.test(cleaned)) {
    return "NIT";
  }
  const docMatch = cleaned.match(/tender\s*document\s*(\d+)/i);
  if (docMatch?.[1]) {
    return `Tender_Document_${docMatch[1]}`;
  }
  if (/tender\s*document/i.test(cleaned)) {
    return `Tender_Document_${index}`;
  }
  if (cleaned) {
    return sanitizeFileName(cleaned);
  }
  return `Tender_Document_${index}`;
}

/** Dismiss interruptions before a click; reminder blocking stays candidate-fatal. */
async function dismissInterruptionsBeforeClick(
  page: Page,
  logger: Logger,
): Promise<void> {
  try {
    await dismissTender247Interruptions(page, logger);
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
    ) {
      throw error;
    }
  }
}
