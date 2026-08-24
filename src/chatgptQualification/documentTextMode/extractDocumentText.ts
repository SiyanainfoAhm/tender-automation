/**
 * Experimental DOCUMENT_TEXT_MODE — extract tender ZIP text and qualify via
 * prompt-only ChatGPT (no file attachments). Does not replace upload flow.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
import { ensureDir } from "../../fileUtils.js";
import type { Logger } from "../../logger.js";
import { extractZipArchive, listFilesRecursive } from "../extractZip.js";
import { findTenderAllDocumentsZip } from "../readiness.js";

const SUPPORTED_EXTS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".txt"]);
/** Soft cap so composer paste stays reliable for the test path. */
const MAX_TEXT_CHARS_PER_FILE = 120_000;
const MAX_TOTAL_TEXT_CHARS = 400_000;

export type ExtractedDocumentText = {
  filename: string;
  text: string;
  truncated?: boolean;
  error?: string;
};

export type DocumentTextBundle = {
  tenderId: string;
  documents: ExtractedDocumentText[];
  filesExtracted: number;
  textLength: number;
  zipPath: string;
  outputPath: string;
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

async function extractPdfText(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result?.text ?? "").trim();
  } finally {
    try {
      // pdf-parse v2 optional cleanup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (parser as any).destroy?.();
    } catch {
      // ignore
    }
  }
}

async function extractDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return String(result.value ?? "").trim();
}

function extractXlsxText(filePath: string): string {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      parts.push(`Sheet: ${name}\n${csv.trim()}`);
    }
  }
  return parts.join("\n\n").trim();
}

function extractTxt(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").trim();
}

async function extractOneFile(filePath: string): Promise<ExtractedDocumentText> {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  try {
    let text = "";
    if (ext === ".pdf") text = await extractPdfText(filePath);
    else if (ext === ".docx") text = await extractDocxText(filePath);
    else if (ext === ".xlsx" || ext === ".xls") text = extractXlsxText(filePath);
    else if (ext === ".txt") text = extractTxt(filePath);
    else {
      return { filename, text: "", error: `unsupported:${ext}` };
    }

    let truncated = false;
    if (text.length > MAX_TEXT_CHARS_PER_FILE) {
      text = `${text.slice(0, MAX_TEXT_CHARS_PER_FILE)}\n\n[TRUNCATED]`;
      truncated = true;
    }
    return { filename, text, truncated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { filename, text: "", error: message };
  }
}

/**
 * Unzip Tender_All_Documents.zip (into a temp dir if needed), extract
 * PDF/DOCX/XLSX/TXT text, write document-text.json. Never deletes originals.
 */
export async function extractDocumentTextForTender(options: {
  tenderFolder: string;
  tenderId: string;
  logger?: Logger;
}): Promise<DocumentTextBundle> {
  const tenderId = options.tenderId.replace(/\D/g, "");
  const displayId = `T247-${tenderId}`;
  log(options.logger, "DOCUMENT_EXTRACTION_START");
  log(options.logger, `tenderId=${displayId}`);

  const cachedPath = path.join(options.tenderFolder, "document-text.json");
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachedPath, "utf8")) as {
        tenderId?: string;
        documents?: ExtractedDocumentText[];
      };
      const docs = Array.isArray(cached.documents) ? cached.documents : [];
      const textLength = docs.reduce(
        (sum, d) => sum + String(d.text ?? "").length,
        0,
      );
      if (docs.length > 0 && textLength > 0) {
        log(options.logger, "DOCUMENT_TEXT_REUSED_EXISTING=true");
        const zipPath =
          findTenderAllDocumentsZip(options.tenderFolder) ||
          path.join(options.tenderFolder, "documents", "Tender_All_Documents.zip");
        return {
          tenderId: displayId,
          documents: docs,
          filesExtracted: docs.filter((d) => String(d.text ?? "").length > 0)
            .length,
          textLength,
          zipPath,
          outputPath: cachedPath,
        };
      }
    } catch {
      log(options.logger, "DOCUMENT_TEXT_CACHE_INVALID=true");
    }
  }

  const zipPath = findTenderAllDocumentsZip(options.tenderFolder);
  if (!zipPath || !fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
    throw new Error(
      `DOCUMENT_EXTRACTION_FAILED: Tender_All_Documents.zip missing for ${displayId}`,
    );
  }

  const documentsDir = path.join(options.tenderFolder, "documents");
  const extractedDir = path.join(documentsDir, "extracted");
  const existingExtracted = fs.existsSync(extractedDir)
    ? listFilesRecursive(extractedDir).filter((p) =>
        SUPPORTED_EXTS.has(path.extname(p).toLowerCase()),
      )
    : [];

  let sourceFiles = existingExtracted;
  let tempExtract: string | null = null;
  if (sourceFiles.length === 0) {
    tempExtract = fs.mkdtempSync(path.join(os.tmpdir(), `doc-text-${tenderId}-`));
    await extractZipArchive(zipPath, tempExtract);
    sourceFiles = listFilesRecursive(tempExtract).filter((p) =>
      SUPPORTED_EXTS.has(path.extname(p).toLowerCase()),
    );
    // Also materialize into documents/extracted for inspection (keep originals).
    ensureDir(extractedDir);
    if (listFilesRecursive(extractedDir).length === 0) {
      await extractZipArchive(zipPath, extractedDir);
    }
  }

  const documents: ExtractedDocumentText[] = [];
  let totalChars = 0;
  for (const filePath of sourceFiles) {
    if (totalChars >= MAX_TOTAL_TEXT_CHARS) break;
    const extracted = await extractOneFile(filePath);
    if (!extracted.text && extracted.error) {
      documents.push(extracted);
      continue;
    }
    const remaining = MAX_TOTAL_TEXT_CHARS - totalChars;
    if (extracted.text.length > remaining) {
      extracted.text = `${extracted.text.slice(0, remaining)}\n\n[TRUNCATED_TOTAL]`;
      extracted.truncated = true;
    }
    totalChars += extracted.text.length;
    documents.push(extracted);
  }

  if (tempExtract) {
    fs.rmSync(tempExtract, { recursive: true, force: true });
  }

  const bundle: DocumentTextBundle = {
    tenderId: displayId,
    documents,
    filesExtracted: documents.filter((d) => d.text.length > 0).length,
    textLength: totalChars,
    zipPath,
    outputPath: path.join(options.tenderFolder, "document-text.json"),
  };

  fs.writeFileSync(
    bundle.outputPath,
    JSON.stringify(
      {
        tenderId: bundle.tenderId,
        documents: bundle.documents.map((d) => ({
          filename: d.filename,
          text: d.text,
          ...(d.truncated ? { truncated: true } : {}),
          ...(d.error ? { error: d.error } : {}),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  log(options.logger, "DOCUMENT_EXTRACTION_COMPLETE");
  log(options.logger, `tenderId=${displayId}`);
  log(options.logger, `filesExtracted=${bundle.filesExtracted}`);
  log(options.logger, `textLength=${bundle.textLength}`);

  return bundle;
}
