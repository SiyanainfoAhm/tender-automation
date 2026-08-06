import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import type { Logger } from "../logger.js";
import { ensureDir } from "../fileUtils.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import {
  assertInside,
  extensionFromFilename,
  guessExtensionFromUrl,
  sanitizeFileName,
} from "./tenderFolder.js";
import type { DownloadedFileRecord } from "./types.js";

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
 * Click a download control and save the resulting file (direct download,
 * new tab, or redirected signed URL). Never uses coordinates.
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

  const downloadPromise = page
    .waitForEvent("download", { timeout: timeoutMs })
    .catch(() => null);
  const popupPromise = context
    .waitForEvent("page", { timeout: Math.min(timeoutMs, 15_000) })
    .catch(() => null);

  await dismissTender247BlockingOverlays(page, logger).catch(() => undefined);
  await dismissTender247SupportChat(page, logger).catch(() => undefined);
  await clickTarget();

  const download = await downloadPromise;
  if (download) {
    return trackDownloadPromise(
      savePlaywrightDownload(download, {
        destinationDir,
        preferredBaseName,
        preferredExtension,
        canonicalFileName: options.canonicalFileName,
        logger,
        kind,
        linkText,
        publishedDate: options.publishedDate,
        corrigendumType: options.corrigendumType,
      }),
    );
  }

  const popup = await popupPromise;
  if (popup) {
    try {
      await popup
        .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
        .catch(() => undefined);
      await dismissTender247BlockingOverlays(popup, logger).catch(() => undefined);
      const popupDownload = await popup
        .waitForEvent("download", { timeout: Math.min(timeoutMs, 30_000) })
        .catch(() => null);
      if (popupDownload) {
        const record = await trackDownloadPromise(
          savePlaywrightDownload(popupDownload, {
            destinationDir,
            preferredBaseName,
            preferredExtension,
            canonicalFileName: options.canonicalFileName,
            logger,
            kind,
            linkText,
            publishedDate: options.publishedDate,
            corrigendumType: options.corrigendumType,
          }),
        );
        await popup.close().catch(() => undefined);
        await dismissTender247BlockingOverlays(page, logger).catch(() => undefined);
        return record;
      }

      const url = popup.url();
      const saved = await trackDownloadPromise(
        saveUrlResponse(page, url, {
          destinationDir,
          preferredBaseName,
          preferredExtension:
            preferredExtension || guessExtensionFromUrl(url) || "pdf",
          canonicalFileName: options.canonicalFileName,
          logger,
          kind,
          linkText,
          publishedDate: options.publishedDate,
          corrigendumType: options.corrigendumType,
        }),
      );
      await popup.close().catch(() => undefined);
      await dismissTender247BlockingOverlays(page, logger).catch(() => undefined);
      return saved;
    } catch (error) {
      await popup.close().catch(() => undefined);
      await dismissTender247BlockingOverlays(page, logger).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      return failedRecord(kind, linkText, message, options);
    }
  }

  return failedRecord(
    kind,
    linkText,
    "No download event or popup detected after click",
    options,
  );
}

/**
 * Save a Playwright download atomically to a canonical path.
 * Never creates _2/_3 siblings.
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
  let ext =
    opts.preferredExtension ||
    suggestedExt ||
    guessExtensionFromUrl(download.url()) ||
    "bin";
  if (ext.toLowerCase() === "download") {
    ext = suggestedExt || "bin";
  }

  const canonicalName =
    opts.canonicalFileName ||
    `${sanitizeFileName(opts.preferredBaseName)}.${ext.replace(/^\./, "")}`;
  const canonicalPath = path.join(opts.destinationDir, canonicalName);
  assertInside(opts.destinationDir, canonicalPath);
  ensureDir(opts.destinationDir);

  const temporaryPath = `${canonicalPath}.download`;
  if (fs.existsSync(temporaryPath)) {
    fs.unlinkSync(temporaryPath);
  }

  await download.saveAs(temporaryPath);

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

  if (fs.existsSync(canonicalPath)) {
    const existing = await fs.promises.stat(canonicalPath);
    if (existing.size > 0) {
      await fs.promises.unlink(temporaryPath);
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

  await fs.promises.rename(temporaryPath, canonicalPath);
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

  const canonicalName =
    opts.canonicalFileName ||
    `${sanitizeFileName(opts.preferredBaseName)}.${ext.replace(/^\./, "")}`;
  const canonicalPath = path.join(opts.destinationDir, canonicalName);
  assertInside(opts.destinationDir, canonicalPath);
  ensureDir(opts.destinationDir);

  const temporaryPath = `${canonicalPath}.download`;
  if (fs.existsSync(temporaryPath)) {
    fs.unlinkSync(temporaryPath);
  }
  fs.writeFileSync(temporaryPath, body);

  const tempStat = fs.statSync(temporaryPath);
  if (tempStat.size <= 0) {
    fs.unlinkSync(temporaryPath);
    return failedRecord(opts.kind, opts.linkText, "DOWNLOADED_FILE_EMPTY", opts);
  }

  if (fs.existsSync(canonicalPath)) {
    const existing = fs.statSync(canonicalPath);
    if (existing.size > 0) {
      fs.unlinkSync(temporaryPath);
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

  fs.renameSync(temporaryPath, canonicalPath);
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
