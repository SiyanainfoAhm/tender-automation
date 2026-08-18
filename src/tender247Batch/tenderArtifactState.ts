/**
 * Single source of truth for Tender247 selected-tender completeness.
 * Resume, pre-close, pre-next, GPT crawler-readiness, and recovery all use this.
 */
import fs from "node:fs";
import path from "node:path";
import {
  canonicalZipPath,
  zipContainsMeaningfulDocuments,
} from "./canonicalTenderArchive.js";
import { isPdfMagic } from "./simplePdf.js";

const TEMP_EXTS = [".crdownload", ".tmp", ".download", ".part"];
export const MIN_AI_SUMMARY_BYTES = 100;
export const FINAL_GATE_RECOVERY_MS = 5 * 60 * 1000;

export type TenderArtifactMissing = "metadata" | "aiSummary" | "documents";

export type PendingTimeoutReason =
  | "PENDING_TIMEOUT_AI"
  | "PENDING_TIMEOUT_DOCUMENTS"
  | "PENDING_TIMEOUT_AI_AND_DOCUMENTS"
  | "PENDING_TIMEOUT_METADATA"
  | "PENDING_TIMEOUT";

export interface TenderArtifactState {
  tenderDir: string;
  t247Id: string;
  metadataPath: string;
  aiSummaryPath: string;
  documentsZipPath: string;
  metadataValid: boolean;
  aiSummaryValid: boolean;
  documentsZipValid: boolean;
  complete: boolean;
  ready: boolean;
  missing: TenderArtifactMissing[];
}

function isTempPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return TEMP_EXTS.some((ext) => lower.endsWith(ext));
}

function readPrefix(filePath: string, length: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function looksLikeHtmlOrJsonError(filePath: string): boolean {
  try {
    const prefix = readPrefix(filePath, 64).trimStart().toLowerCase();
    return (
      prefix.startsWith("<!doctype") ||
      prefix.startsWith("<html") ||
      prefix.startsWith("{") ||
      prefix.startsWith("[")
    );
  } catch {
    return true;
  }
}

/** Write a small but valid AI Summary PDF (magic + size > MIN_AI_SUMMARY_BYTES). */
export function writeMinimalValidAiSummaryPdf(
  filePath: string,
  body = "AI Generated Tender Summary",
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `%PDF-1.4\n${body}\n${"x".repeat(MIN_AI_SUMMARY_BYTES)}\n`;
  fs.writeFileSync(filePath, payload);
}

export function isValidAiSummaryPdf(filePath: string): boolean {
  if (!filePath || isTempPath(filePath) || !fs.existsSync(filePath)) {
    return false;
  }
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= MIN_AI_SUMMARY_BYTES) {
      return false;
    }
    if (!isPdfMagic(filePath)) {
      return false;
    }
    if (looksLikeHtmlOrJsonError(filePath)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isValidMetadataJsonFile(filePath: string): boolean {
  if (!filePath || isTempPath(filePath) || !fs.existsSync(filePath)) {
    return false;
  }
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 0) {
      return false;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

export function isValidDocumentsZipFile(zipPath: string): boolean {
  if (!zipPath || isTempPath(zipPath)) {
    return false;
  }
  return zipContainsMeaningfulDocuments(zipPath);
}

export function tenderDirForId(dateFolder: string, t247Id: string): string {
  return path.join(dateFolder, `T247-${t247Id}`);
}

export function t247IdFromTenderDir(tenderDir: string): string {
  const base = path.basename(tenderDir);
  const match = base.match(/^T247-(\d+)$/i);
  return match?.[1] || base.replace(/^T247-/i, "");
}

export function inspectTenderArtifactState(
  tenderDir: string,
  t247Id?: string,
): TenderArtifactState {
  const id = t247Id || t247IdFromTenderDir(tenderDir);
  const metadataPath = path.join(tenderDir, "metadata.json");
  const aiSummaryPath = path.join(tenderDir, "AI_Summary.pdf");
  const documentsZipPath = canonicalZipPath(path.join(tenderDir, "documents"));

  const metadataValid = isValidMetadataJsonFile(metadataPath);
  const aiSummaryValid = isValidAiSummaryPdf(aiSummaryPath);
  const documentsZipValid = isValidDocumentsZipFile(documentsZipPath);
  const complete = metadataValid && aiSummaryValid && documentsZipValid;
  const missing: TenderArtifactMissing[] = [];
  if (!metadataValid) missing.push("metadata");
  if (!aiSummaryValid) missing.push("aiSummary");
  if (!documentsZipValid) missing.push("documents");

  return {
    tenderDir,
    t247Id: id,
    metadataPath,
    aiSummaryPath,
    documentsZipPath,
    metadataValid,
    aiSummaryValid,
    documentsZipValid,
    complete,
    ready: complete,
    missing,
  };
}

export async function verifyTenderReadyBeforeAdvance(
  tenderDir: string,
  t247Id: string,
): Promise<TenderArtifactState> {
  return inspectTenderArtifactState(tenderDir, t247Id);
}

export function pendingTimeoutReasonFromState(
  state: TenderArtifactState,
): PendingTimeoutReason {
  const ai = !state.aiSummaryValid;
  const docs = !state.documentsZipValid;
  const meta = !state.metadataValid;
  if (ai && docs) return "PENDING_TIMEOUT_AI_AND_DOCUMENTS";
  if (ai) return "PENDING_TIMEOUT_AI";
  if (docs) return "PENDING_TIMEOUT_DOCUMENTS";
  if (meta) return "PENDING_TIMEOUT_METADATA";
  return "PENDING_TIMEOUT";
}

export function pendingTimeoutMessage(reason: PendingTimeoutReason): string {
  switch (reason) {
    case "PENDING_TIMEOUT_AI":
      return "AI_Summary.pdf not obtained within 5-minute recovery budget";
    case "PENDING_TIMEOUT_DOCUMENTS":
      return "Tender_All_Documents.zip not obtained within 5-minute recovery budget";
    case "PENDING_TIMEOUT_AI_AND_DOCUMENTS":
      return "AI_Summary.pdf and Tender_All_Documents.zip not obtained within 5-minute recovery budget";
    case "PENDING_TIMEOUT_METADATA":
      return "metadata.json not obtained within 5-minute recovery budget";
    default:
      return "Required tender artifacts not obtained within 5-minute recovery budget";
  }
}

export function listT247TenderDirs(
  dateFolder: string,
): Array<{ t247Id: string; tenderDir: string }> {
  if (!fs.existsSync(dateFolder)) {
    return [];
  }
  const out: Array<{ t247Id: string; tenderDir: string }> = [];
  for (const name of fs.readdirSync(dateFolder)) {
    const match = name.match(/^T247-(\d+)$/i);
    if (!match) continue;
    const tenderDir = path.join(dateFolder, name);
    try {
      if (!fs.statSync(tenderDir).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ t247Id: match[1]!, tenderDir });
  }
  return out;
}

/**
 * Resume/recovery discovery: filesystem artifacts are authoritative.
 * Manifest completed / outer T247-id.zip cannot hide an incomplete folder.
 */
export function discoverIncompleteTenders(dateFolder: string): string[] {
  return listT247TenderDirs(dateFolder)
    .filter(({ tenderDir }) => !inspectTenderArtifactState(tenderDir).complete)
    .map(({ t247Id }) => t247Id);
}

export function discoverCompleteTenderIds(dateFolder: string): string[] {
  return listT247TenderDirs(dateFolder)
    .filter(({ tenderDir }) => inspectTenderArtifactState(tenderDir).complete)
    .map(({ t247Id }) => t247Id);
}
