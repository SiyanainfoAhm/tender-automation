import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Dialog, Download, Page, Response } from "playwright";
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
import { tender247RegionFromUrl } from "../tender247/sourceRegion.js";

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
  /** Extra Global/Download-All diagnostics. */
  capturePortalFailures?: boolean;
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

export function classifyDocumentDownloadFailure(input: {
  portalAlert?: string | null;
  error?: string | null;
  responseStatus?: number | null;
  downloadEndpoint?: string | null;
}): NonNullable<DownloadedFileRecord["failureKind"]> {
  const alert = String(input.portalAlert || "");
  const err = String(input.error || "");
  const combined = `${alert} ${err}`.toLowerCase();
  const status = input.responseStatus ?? 0;
  const endpoint = String(input.downloadEndpoint || "").toLowerCase();

  if (
    /no\s+document|document\s+not\s+available|not\s+available|no\s+file\s+found|documents?\s+missing/i.test(
      combined,
    )
  ) {
    return "DOCUMENT_NOT_AVAILABLE";
  }
  if (status === 401 || status === 403 || /unauthor|session|login|auth/i.test(combined)) {
    return "AUTH_SESSION";
  }
  // Global download-document-all HTTP 500 (+ optional portal alert) = no archive.
  // Do not keep retrying / waiting — close tender and move on.
  if (
    status >= 500 &&
    /download-document-all|downloaddocument\/global|download-document/i.test(
      endpoint,
    )
  ) {
    return "DOCUMENT_NOT_AVAILABLE";
  }
  if (
    /failed to download file/i.test(combined) &&
    (status >= 500 ||
      /download-document-all|downloaddocument\/global/i.test(endpoint))
  ) {
    return "DOCUMENT_NOT_AVAILABLE";
  }
  if (/failed to download file/i.test(combined)) {
    return "PORTAL_ALERT";
  }
  if (/empty|DOWNLOADED_FILE_EMPTY/i.test(combined)) {
    return "EMPTY_FILE";
  }
  if (/no download event|no download/i.test(combined)) {
    return "NO_DOWNLOAD_EVENT";
  }
  return "TEMPORARY_FAILURE";
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
  const isGlobal = tender247RegionFromUrl(urlBefore) === "GLOBAL";
  const isDownloadAll = /download\s+all\s+documents/i.test(linkText);
  const capturePortalFailures =
    options.capturePortalFailures === true || isGlobal || isDownloadAll;
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

  const portalState: {
    alert: string | null;
    lastResponse: { url: string; status: number } | null;
  } = {
    alert: null,
    lastResponse: null,
  };

  const onDialog = (dialog: Dialog): void => {
    const msg = dialog.message() || "";
    portalState.alert = msg;
    logDownload(
      logger,
      options.t247Id,
      `DOWNLOAD_PORTAL_ALERT message=${msg.slice(0, 200)}`,
    );
    if (isGlobal) {
      logDownload(
        logger,
        options.t247Id,
        `GLOBAL_DOWNLOAD_FAILED reason=portal_alert message=${msg.slice(0, 160)}`,
      );
    }
    void dialog.accept().catch(() => undefined);
  };

  const onResponse = (response: Response): void => {
    const u = response.url();
    const lower = u.toLowerCase();
    if (
      !/download|document|zip|blob|file|attachment/i.test(lower) ||
      /analytics|telemetry|hotjar|gtm|google-analytics|facebook/i.test(lower)
    ) {
      return;
    }
    portalState.lastResponse = { url: u, status: response.status() };
    logDownload(
      logger,
      options.t247Id,
      `DOWNLOAD_NETWORK_RESPONSE status=${response.status()} url=${u.slice(0, 220)}`,
    );
    if (isGlobal) {
      logDownload(
        logger,
        options.t247Id,
        `GLOBAL_DOWNLOAD_REQUEST status=${response.status()} url=${u.slice(0, 220)}`,
      );
    }
  };

  await dismissInterruptionsBeforeClick(page, logger);

  if (capturePortalFailures) {
    page.on("dialog", onDialog);
    page.on("response", onResponse);
  }

  try {
    const download = await clickAndWaitForPlaywrightDownload({
      page,
      context,
      timeoutMs,
      shouldAbort: () => {
        if (portalState.alert && /failed to download/i.test(portalState.alert)) {
          return true;
        }
        const last = portalState.lastResponse;
        if (
          last &&
          last.status >= 500 &&
          /download-document-all|downloaddocument\/global|download-document/i.test(
            last.url,
          )
        ) {
          return true;
        }
        return false;
      },
      clickTarget: async () => {
        await clickTarget();
        if (isDownloadAll) {
          logDownload(logger, options.t247Id, "DOWNLOAD_ALL_CLICKED");
          if (isGlobal) {
            logDownload(logger, options.t247Id, "GLOBAL_DOWNLOAD_CLICKED");
          }
        }
      },
    });

    const portalAlert = portalState.alert;
    const lastDownloadResponse = portalState.lastResponse;

    if (download) {
      logDownload(logger, options.t247Id, "DOWNLOAD_EVENT_RECEIVED");
      logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_START");
      const saved = await trackDownloadPromise(
        savePlaywrightDownload(download, saveOpts),
      );
      const failure = await download.failure();
      if (failure || portalAlert) {
        const error =
          failure ||
          (portalAlert
            ? `Tender247 portal alert: ${portalAlert}`
            : "Download failed");
        const failureKind = classifyDocumentDownloadFailure({
          portalAlert,
          error,
          responseStatus: lastDownloadResponse?.status,
          downloadEndpoint: lastDownloadResponse?.url || download.url(),
        });
        return failedRecord(kind, linkText, error, {
          ...options,
          failureKind,
          portalAlert,
          downloadEndpoint: lastDownloadResponse?.url || download.url(),
          responseStatus: lastDownloadResponse?.status ?? null,
        });
      }
      if (saved.status !== "success" || saved.sizeBytes <= 0) {
        const failureKind = classifyDocumentDownloadFailure({
          portalAlert,
          error: saved.error || "EMPTY_FILE",
          responseStatus: lastDownloadResponse?.status,
          downloadEndpoint: lastDownloadResponse?.url || download.url(),
        });
        return {
          ...saved,
          status: "failed",
          error: saved.error || "DOWNLOADED_FILE_EMPTY",
          failureKind,
          portalAlert,
          downloadEndpoint: lastDownloadResponse?.url || download.url(),
          responseStatus: lastDownloadResponse?.status ?? null,
        };
      }
      logDownload(logger, options.t247Id, "DOWNLOAD_SAVE_DONE");
      if (isGlobal && isDownloadAll) {
        logDownload(
          logger,
          options.t247Id,
          `GLOBAL_DOWNLOAD_SUCCESS filename=${saved.finalFilename} size=${saved.sizeBytes} url=${urlBefore}`,
        );
      }
      return {
        ...saved,
        downloadEndpoint: lastDownloadResponse?.url || download.url(),
        responseStatus: lastDownloadResponse?.status ?? null,
      };
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

    const error = portalAlert
      ? `Tender247 portal alert: ${portalAlert}`
      : "No download event, popup, or file response detected after click";
    const failureKind = classifyDocumentDownloadFailure({
      portalAlert,
      error,
      responseStatus: lastDownloadResponse?.status,
      downloadEndpoint: lastDownloadResponse?.url,
    });
    return failedRecord(kind, linkText, error, {
      ...options,
      failureKind,
      portalAlert,
      downloadEndpoint: lastDownloadResponse?.url ?? null,
      responseStatus: lastDownloadResponse?.status ?? null,
    });
  } finally {
    if (capturePortalFailures) {
      page.off("dialog", onDialog);
      page.off("response", onResponse);
    }
  }
}

/**
 * Arm Playwright's download listener, then click. A popup/new tab is only
 * another source of a `download` event — never completion by itself.
 * `shouldAbort` lets portal alerts / HTTP 500 end the wait immediately.
 */
export async function clickAndWaitForPlaywrightDownload(options: {
  page: Page;
  context: BrowserContext;
  timeoutMs: number;
  clickTarget: () => Promise<void>;
  shouldAbort?: () => boolean;
}): Promise<Download | null> {
  const { page, context, timeoutMs, clickTarget, shouldAbort } = options;
  let popupDownload: Download | null = null;
  let pageDownload: Download | null = null;
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
      .then((download) => {
        pageDownload = download;
        return download;
      })
      .catch(() => null);
    await clickTarget();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pageDownload || popupDownload) {
        return pageDownload || popupDownload;
      }
      if (shouldAbort?.()) {
        return null;
      }
      await Promise.race([
        pageDownloadPromise,
        new Promise((r) => setTimeout(r, 120)),
      ]);
    }
    return pageDownload || popupDownload;
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
  opts: {
    publishedDate?: string | null;
    corrigendumType?: string | null;
    failureKind?: DownloadedFileRecord["failureKind"];
    portalAlert?: string | null;
    downloadEndpoint?: string | null;
    responseStatus?: number | null;
  },
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
    failureKind: opts.failureKind,
    portalAlert: opts.portalAlert ?? null,
    downloadEndpoint: opts.downloadEndpoint ?? null,
    responseStatus: opts.responseStatus ?? null,
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
