import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { extractZipArchive, listFilesRecursive } from "./extractZip.js";
import type { TenderFileBundle } from "./types.js";

const SUPPORTED_EXTS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
  ".json",
]);

/**
 * Prepare tender workspace and collect uploadable files.
 * Uses existing T247-{ID}/ folder when present; otherwise extracts final ZIP.
 */
export async function prepareTenderFileBundle(options: {
  dateFolder: string;
  t247Id: string;
  logger: Logger;
}): Promise<TenderFileBundle> {
  const { dateFolder, t247Id, logger } = options;
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  const zipPath = path.join(dateFolder, `T247-${t247Id}.zip`);

  if (!fs.existsSync(tenderFolder)) {
    if (isValidZip(zipPath)) {
      logger.info(`Extracting T247-${t247Id}.zip → T247-${t247Id}/`);
      ensureDir(tenderFolder);
      await extractZipArchive(zipPath, tenderFolder);
    } else {
      throw new Error(
        `No tender folder or non-empty ZIP for T247-${t247Id}`,
      );
    }
  } else if (
    !fs.existsSync(path.join(tenderFolder, "metadata.json")) &&
    isValidZip(zipPath)
  ) {
    logger.info(`Refreshing folder from ZIP for T247-${t247Id}`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `t247-${t247Id}-`));
    try {
      await extractZipArchive(zipPath, tempDir);
      copyMissingInto(tempDir, tenderFolder);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const metadataPath = findFirst(tenderFolder, ["metadata.json"]);
  const aiSummaryPath = findFirst(tenderFolder, [
    "AI_Summary.pdf",
    "AI Summary.pdf",
  ]);
  const documentsDir = path.join(tenderFolder, "documents");
  const allDocumentsArchivePath = findAllDocumentsArchive(documentsDir);

  // Extract Tender_All_Documents locally into documents/extracted/
  let extractedDocsDir: string | null = null;
  if (allDocumentsArchivePath && isValidZip(allDocumentsArchivePath)) {
    extractedDocsDir = path.join(documentsDir, "extracted");
    if (
      !fs.existsSync(extractedDocsDir) ||
      listFilesRecursive(extractedDocsDir).length === 0
    ) {
      ensureDir(extractedDocsDir);
      logger.info(
        `Extracting all-documents archive for T247-${t247Id}`,
      );
      await extractZipArchive(allDocumentsArchivePath, extractedDocsDir);
    }
  }

  const candidates: string[] = [];
  if (metadataPath) {
    candidates.push(metadataPath);
  }
  if (aiSummaryPath) {
    candidates.push(aiSummaryPath);
  }

  const searchRoots = [extractedDocsDir, documentsDir, tenderFolder].filter(
    (p): p is string => Boolean(p && fs.existsSync(p)),
  );

  for (const root of searchRoots) {
    for (const file of listFilesRecursive(root)) {
      const base = path.basename(file).toLowerCase();
      const ext = path.extname(file).toLowerCase();
      if (base === "metadata.json" || base === "ai_summary.pdf") {
        continue;
      }
      if (base.startsWith("tender_all_documents") && ext === ".zip") {
        continue;
      }
      if (base === "qualification-result.json" || base === "qualification-response.txt") {
        continue;
      }
      if (!SUPPORTED_EXTS.has(ext)) {
        continue;
      }
      // Prefer extracted docs over nested archives' parent copies
      if (root === tenderFolder && file.includes(`${path.sep}documents${path.sep}`)) {
        continue;
      }
      candidates.push(file);
    }
  }

  const { uniqueFiles, skippedDuplicates } = dedupeBySha256(candidates);
  logger.info(
    `T247-${t247Id} upload candidates=${uniqueFiles.length} skippedDuplicates=${skippedDuplicates}`,
  );

  return {
    t247Id,
    tenderFolder,
    metadataPath,
    aiSummaryPath,
    allDocumentsArchivePath,
    uploadFiles: uniqueFiles,
    skippedDuplicates,
  };
}

function isValidZip(filePath: string): boolean {
  try {
    return (
      fs.existsSync(filePath) &&
      fs.statSync(filePath).isFile() &&
      fs.statSync(filePath).size > 0
    );
  } catch {
    return false;
  }
}

function findFirst(root: string, names: string[]): string | null {
  for (const name of names) {
    const p = path.join(root, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      return p;
    }
  }
  // shallow search
  if (!fs.existsSync(root)) {
    return null;
  }
  for (const file of listFilesRecursive(root)) {
    const base = path.basename(file);
    if (names.some((n) => n.toLowerCase() === base.toLowerCase())) {
      if (fs.statSync(file).size > 0) {
        return file;
      }
    }
  }
  return null;
}

function findAllDocumentsArchive(documentsDir: string): string | null {
  if (!fs.existsSync(documentsDir)) {
    return null;
  }
  const entries = fs
    .readdirSync(documentsDir)
    .map((n) => path.join(documentsDir, n))
    .filter((p) => {
      try {
        const st = fs.statSync(p);
        return (
          st.isFile() &&
          st.size > 0 &&
          /^Tender_All_Documents/i.test(path.basename(p))
        );
      } catch {
        return false;
      }
    });
  if (entries[0]) {
    return entries[0];
  }
  // any non-empty archive in documents/
  const any = fs
    .readdirSync(documentsDir)
    .map((n) => path.join(documentsDir, n))
    .filter((p) => {
      try {
        const st = fs.statSync(p);
        const ext = path.extname(p).toLowerCase();
        return st.isFile() && st.size > 0 && (ext === ".zip" || ext === ".rar");
      } catch {
        return false;
      }
    });
  return any[0] ?? null;
}

function dedupeBySha256(files: string[]): {
  uniqueFiles: string[];
  skippedDuplicates: number;
} {
  const seen = new Set<string>();
  const uniqueFiles: string[] = [];
  let skippedDuplicates = 0;
  for (const file of files) {
    try {
      const hash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
      if (seen.has(hash)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(hash);
      uniqueFiles.push(file);
    } catch {
      // skip unreadable
    }
  }
  return { uniqueFiles, skippedDuplicates };
}

function copyMissingInto(srcRoot: string, destRoot: string): void {
  for (const file of listFilesRecursive(srcRoot)) {
    const rel = path.relative(srcRoot, file);
    const dest = path.join(destRoot, rel);
    if (!fs.existsSync(dest)) {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(file, dest);
    }
  }
}
