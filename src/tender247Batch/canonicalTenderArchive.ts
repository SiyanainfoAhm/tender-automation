/**
 * Normalize Tender247 downloaded artifacts into the canonical GPT archive:
 * documents/Tender_All_Documents.zip
 *
 * Tender247 may download PDF/DOC/XLS/ZIP/etc. ChatGPT always needs one ZIP.
 * Missing canonical ZIP ≠ missing tender documents.
 */
import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { ensureDir } from "../fileUtils.js";

export const CANONICAL_ARCHIVE_NAME = "Tender_All_Documents.zip";
export const NO_TENDER_DOCUMENT_ARTIFACTS = "NO_TENDER_DOCUMENT_ARTIFACTS";

export type CanonicalArchiveLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
};

export type CanonicalArchiveResult = {
  ready: boolean;
  canonicalZipPath?: string;
  sourceFiles: string[];
  created: boolean;
  reused: boolean;
  foundExisting: boolean;
  reason?: string;
};

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".html",
  ".htm",
  ".txt",
  ".rtf",
  ".odt",
  ".ods",
  ".ppt",
  ".pptx",
  ".zip",
  ".rar",
  ".7z",
]);

const EXCLUDED_BASENAMES = new Set([
  "agenttender-metadata-sync.json",
  "metadata.json",
  "metadata.supabase-sync.json",
  "qualification-result.json",
  "qualification-response.txt",
  "chatgpt-state.json",
  "download-state.json",
  "crawl-manifest.json",
  "gpt-readiness.json",
]);

const TEMP_SUFFIXES = [
  ".tmp",
  ".download",
  ".crdownload",
  ".part",
  ".lock",
];

function log(logger: CanonicalArchiveLogger | undefined, msg: string): void {
  logger?.info(msg);
  if (!logger) {
    console.log(msg);
  }
}

export function isNonEmptyRegularFile(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function isTempOrIncompleteName(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEMP_SUFFIXES.some((ext) => lower.endsWith(ext))) return true;
  if (lower.includes(".tmp")) return true;
  if (/^~\$/.test(name)) return true;
  if (/^playwright/i.test(name)) return true;
  return false;
}

function extensionOf(name: string): string {
  return path.extname(name).toLowerCase();
}

function looksLikePdf(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(5);
      const n = fs.readSync(fd, header, 0, 5, 0);
      return n >= 4 && header.subarray(0, 4).toString("ascii") === "%PDF";
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export function isReadableZipArchive(filePath: string): boolean {
  try {
    if (!isNonEmptyRegularFile(filePath)) return false;
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      if (bytesRead < 4) return false;
      const sig = header.readUInt32LE(0);
      return sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** List entry names from a ZIP central directory (non-zip64). */
export function listZipEntryNames(filePath: string): string[] {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 22) return [];
    let eocd = -1;
    const min = Math.max(0, buf.length - 22 - 65535);
    for (let i = buf.length - 22; i >= min; i -= 1) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return [];
    const entryCount = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const names: string[] = [];
    let offset = cdOffset;
    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > buf.length) break;
      if (buf.readUInt32LE(offset) !== 0x02014b50) break;
      const nameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > buf.length) break;
      names.push(buf.subarray(nameStart, nameEnd).toString("utf8"));
      offset = nameEnd + extraLen + commentLen;
    }
    return names;
  } catch {
    return [];
  }
}

function isMeaningfulZipEntryName(name: string): boolean {
  const base = path.basename(name.replace(/\\/g, "/"));
  if (!base || base.endsWith("/")) return false;
  if (isTempOrIncompleteName(base)) return false;
  if (EXCLUDED_BASENAMES.has(base.toLowerCase())) return false;
  if (/^Tender_All_Documents\.zip$/i.test(base)) return false;
  const ext = extensionOf(base);
  if (ext && SUPPORTED_EXTENSIONS.has(ext)) return true;
  // Allow other non-empty stored files that look like documents.
  return Boolean(ext) && ![".json", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
}

export function zipContainsMeaningfulDocuments(filePath: string): boolean {
  if (!isReadableZipArchive(filePath)) return false;
  return listZipEntryNames(filePath).some(isMeaningfulZipEntryName);
}

function isExcludedSourceFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (path.basename(path.dirname(filePath)).toLowerCase() === "_source_download") {
    return true;
  }
  if (isTempOrIncompleteName(base)) return true;
  if (EXCLUDED_BASENAMES.has(lower)) return true;
  if (/^Tender_All_Documents\.zip$/i.test(base)) {
    // A real canonical ZIP must not be nested inside itself.
    // A PDF/DOC mis-saved as .zip is a source file, not a ZIP.
    return isReadableZipArchive(filePath);
  }
  if (/^Tender_All_Documents\.zip\.tmp$/i.test(base)) return true;
  if (/^AI_Summary/i.test(base)) return true;
  if (/chatgpt-state/i.test(base)) return true;
  if (/qualification-/i.test(base)) return true;
  if (/failure|audit/i.test(lower) && lower.endsWith(".json")) return true;
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extensionOf(base))) {
    return true;
  }
  return false;
}

export function isMeaningfulTenderDocumentFile(filePath: string): boolean {
  const name = path.basename(filePath);
  if (isExcludedSourceFile(filePath)) return false;
  if (!isNonEmptyRegularFile(filePath)) return false;
  if (looksLikePdf(filePath)) return true;
  const ext = extensionOf(name);
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  if (!ext && looksLikePdf(filePath)) return true;
  if (/^Tender_All_Documents$/i.test(name) && looksLikePdf(filePath)) return true;
  return false;
}

export function listDocumentSourceFiles(documentsDir: string): string[] {
  if (!fs.existsSync(documentsDir) || !fs.statSync(documentsDir).isDirectory()) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name.toLowerCase() === "_source_download") continue;
        if (name.toLowerCase() === "_tmp") continue;
        walk(p);
        continue;
      }
      if (isMeaningfulTenderDocumentFile(p)) {
        out.push(p);
      }
    }
  };
  walk(documentsDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function canonicalZipPath(documentsDir: string): string {
  return path.join(documentsDir, CANONICAL_ARCHIVE_NAME);
}

export function isCanonicalDocumentsZipReady(
  documentsDir: string,
): boolean {
  return zipContainsMeaningfulDocuments(canonicalZipPath(documentsDir));
}

/** Alias used by document-stage completion checks. */
export function isValidTenderDocumentsZip(zipPath: string): boolean {
  return zipContainsMeaningfulDocuments(zipPath);
}

export function removeInvalidCanonicalZip(documentsDir: string): void {
  const zipPath = canonicalZipPath(documentsDir);
  if (!fs.existsSync(zipPath)) return;
  if (!zipContainsMeaningfulDocuments(zipPath)) {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      // ignore
    }
  }
}

function correctMisnamedDocumentExtensions(documentsDir: string): void {
  if (!fs.existsSync(documentsDir) || !fs.statSync(documentsDir).isDirectory()) {
    return;
  }
  for (const name of fs.readdirSync(documentsDir)) {
    if (name.toLowerCase() === "_source_download") continue;
    if (name.toLowerCase() === "_tmp") continue;
    const p = path.join(documentsDir, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    if (looksLikePdf(p) && !/\.pdf$/i.test(name)) {
      const dest = path.join(
        documentsDir,
        `${path.basename(name, path.extname(name))}.pdf`,
      );
      if (path.resolve(dest) === path.resolve(p)) continue;
      if (fs.existsSync(dest) && isNonEmptyRegularFile(dest)) {
        fs.unlinkSync(p);
        continue;
      }
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(p, dest);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withArchiveLock<T>(
  documentsDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  ensureDir(documentsDir);
  const lockPath = path.join(documentsDir, `${CANONICAL_ARCHIVE_NAME}.lock`);
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}`);
        return await fn();
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > 120_000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Canonical archive lock timeout: ${lockPath}`);
      }
      await sleep(75);
    }
  }
}

async function createZipFromFiles(
  zipPath: string,
  files: string[],
  documentsDir: string,
): Promise<void> {
  const temporaryZipPath = `${zipPath}.tmp`;
  await fs.promises.rm(temporaryZipPath, { force: true });
  ensureDir(path.dirname(zipPath));

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(temporaryZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    output.on("close", ok);
    output.on("error", fail);
    archive.on("error", fail);
    archive.pipe(output);
    const usedNames = new Set<string>();
    for (const file of files) {
      const rel = path.relative(documentsDir, file).replace(/\\/g, "/");
      let entryName = rel && !rel.startsWith("..") ? rel : path.basename(file);
      if (usedNames.has(entryName.toLowerCase())) {
        const ext = path.extname(entryName);
        const stem = entryName.slice(0, entryName.length - ext.length);
        let i = 2;
        while (usedNames.has(`${stem}_${i}${ext}`.toLowerCase())) i += 1;
        entryName = `${stem}_${i}${ext}`;
      }
      usedNames.add(entryName.toLowerCase());
      archive.file(file, { name: entryName });
    }
    void Promise.resolve(archive.finalize()).catch(fail);
  });

  const stat = await fs.promises.stat(temporaryZipPath);
  if (stat.size <= 0) {
    await fs.promises.rm(temporaryZipPath, { force: true });
    throw new Error("CANONICAL_ZIP_EMPTY");
  }
  await fs.promises.rm(zipPath, { force: true });
  await fs.promises.rename(temporaryZipPath, zipPath);
}

function existingValidCanonical(zipPath: string): boolean {
  return zipContainsMeaningfulDocuments(zipPath);
}

/**
 * Reuse or create documents/Tender_All_Documents.zip from local artifacts.
 * Never recrawls Tender247. Idempotent: always the same canonical filename.
 */
export async function ensureCanonicalTenderArchive(options: {
  tenderDir: string;
  documentsDir?: string;
  sourceTenderId: string;
  logger?: CanonicalArchiveLogger;
}): Promise<CanonicalArchiveResult> {
  const tenderDir = path.resolve(options.tenderDir);
  const documentsDir = path.resolve(
    options.documentsDir ?? path.join(tenderDir, "documents"),
  );
  const zipPath = canonicalZipPath(documentsDir);
  const t247Id = String(options.sourceTenderId).replace(/^T247-/i, "");

  return withArchiveLock(documentsDir, async () => {
    correctMisnamedDocumentExtensions(documentsDir);
    const foundExisting = fs.existsSync(zipPath);
    if (foundExisting && existingValidCanonical(zipPath)) {
      log(options.logger, "TENDER_CANONICAL_ARCHIVE_FOUND=true");
      log(options.logger, "TENDER_CANONICAL_ARCHIVE_REUSED=true");
      log(options.logger, `TENDER_CANONICAL_ARCHIVE_PATH=${zipPath}`);
      log(options.logger, "TENDER_CANONICAL_ARCHIVE_VALID=true");
      log(options.logger, "TENDER_CANONICAL_ARCHIVE_READY=true");
      return {
        ready: true,
        canonicalZipPath: zipPath,
        sourceFiles: listZipEntryNames(zipPath),
        created: false,
        reused: true,
        foundExisting: true,
      };
    }

    log(options.logger, "TENDER_CANONICAL_ARCHIVE_FOUND=false");
    const sourceFiles = listDocumentSourceFiles(documentsDir);
    log(
      options.logger,
      `TENDER_LOCAL_DOCUMENT_COUNT=${sourceFiles.length}`,
    );
    for (const file of sourceFiles) {
      log(
        options.logger,
        `TENDER_LOCAL_DOCUMENT=${path.basename(file)}`,
      );
    }

    if (sourceFiles.length === 0) {
      return {
        ready: false,
        sourceFiles: [],
        created: false,
        reused: false,
        foundExisting,
        reason: NO_TENDER_DOCUMENT_ARTIFACTS,
      };
    }

    log(options.logger, "TENDER_CANONICAL_ARCHIVE_CREATE_START=true");
    try {
      await createZipFromFiles(zipPath, sourceFiles, documentsDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger?.warn?.(
        `TENDER_CANONICAL_ARCHIVE_CREATE_FAILED=T247-${t247Id} ${message}`,
      );
      return {
        ready: false,
        sourceFiles: sourceFiles.map((p) => path.basename(p)),
        created: false,
        reused: false,
        foundExisting,
        reason: `CANONICAL_ZIP_CREATE_FAILED:${message}`,
      };
    }

    const valid = existingValidCanonical(zipPath);
    log(
      options.logger,
      `TENDER_CANONICAL_ARCHIVE_CREATED=${valid}`,
    );
    log(options.logger, `TENDER_CANONICAL_ARCHIVE_PATH=${zipPath}`);
    log(options.logger, `TENDER_CANONICAL_ARCHIVE_VALID=${valid}`);
    if (!valid) {
      return {
        ready: false,
        sourceFiles: sourceFiles.map((p) => path.basename(p)),
        created: true,
        reused: false,
        foundExisting,
        reason: "CANONICAL_ZIP_INVALID_AFTER_CREATE",
      };
    }
    log(options.logger, "TENDER_CANONICAL_ARCHIVE_READY=true");
    return {
      ready: true,
      canonicalZipPath: zipPath,
      sourceFiles: sourceFiles.map((p) => path.basename(p)),
      created: true,
      reused: false,
      foundExisting,
    };
  });
}
