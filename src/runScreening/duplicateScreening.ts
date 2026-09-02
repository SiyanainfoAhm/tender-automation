/**
 * Preserve every imported Tender247 row; mark duplicates without removing them.
 */
import type { RunWorkbookRow } from "./runWorkbook.js";

export const INVALID_REFERENCE_TOKENS = new Set([
  "",
  "-",
  "0",
  "00",
  "01",
  "02",
  "n/a",
  "na",
  "nil",
  "none",
  "null",
]);

export type DuplicateMarkKind =
  | "tender247_id"
  | "reference"
  | "authority_brief_deadline"
  | "historical";

export type DuplicateMark = {
  kind: DuplicateMarkKind;
  reason: string;
  matchedTenderId: string;
  matchedRunDate?: string;
};

export type AnnotatedImportRow = RunWorkbookRow & {
  importIndex: number;
  duplicateMark?: DuplicateMark;
};

export type HistoricalTenderRecord = {
  tender247Id: string;
  referenceNumber: string | null;
  organization: string;
  tenderName: string;
  deadline: string;
  runDate: string;
};

export type HistoricalTenderIndex = {
  byTender247Id: Map<string, HistoricalTenderRecord>;
  byReference: Map<string, HistoricalTenderRecord>;
  byAuthorityBriefDeadline: Map<string, HistoricalTenderRecord>;
};

export function normalizeMatchText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeTender247Id(
  value: string | null | undefined,
): string {
  const id = String(value ?? "")
    .replace(/^T247[-\s]*/i, "")
    .trim();
  const digits = id.replace(/\D/g, "");
  if (!digits) return "";
  if (/^0+$/.test(digits)) return "";
  return digits;
}

export function isValidReferenceNumber(
  value: string | null | undefined,
): boolean {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  const key = text.toLowerCase();
  if (INVALID_REFERENCE_TOKENS.has(key)) return false;
  if (/^0+$/.test(key.replace(/\D/g, ""))) return false;
  return true;
}

export function referenceKey(value: string | null | undefined): string {
  if (!isValidReferenceNumber(value)) return "";
  return normalizeMatchText(value);
}

export function normalizeDeadlineKey(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1]!;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const dd = dmy[1]!.padStart(2, "0");
    const mm = dmy[2]!.padStart(2, "0");
    let yyyy = dmy[3]!;
    if (yyyy.length === 2) yyyy = Number(yyyy) >= 70 ? `19${yyyy}` : `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  return normalizeMatchText(text);
}

export function authorityBriefDeadlineKey(row: {
  organization: string;
  tenderName: string;
  deadline: string;
}): string {
  const authority = normalizeMatchText(row.organization);
  const brief = normalizeMatchText(row.tenderName);
  const deadline = normalizeDeadlineKey(row.deadline);
  if (!authority || !brief || !deadline) return "";
  return `${authority}|${brief}|${deadline}`;
}

function duplicateTender247Reason(tenderId: string): string {
  return `Duplicate Tender247 ID: ${tenderId}. Existing tender record retained for review.`;
}

function duplicateReferenceReason(
  reference: string,
  existingTenderId: string,
): string {
  return `Duplicate Reference Number: ${reference}. Matches Tender247 ID ${existingTenderId}.`;
}

function duplicateAuthorityReason(existingTenderId: string): string {
  return `Duplicate tender: same Authority, Tender Brief, and Deadline as Tender247 ID ${existingTenderId}.`;
}

function historicalReason(existingTenderId: string, runDate: string): string {
  return `Already reviewed tender: matches existing Tender247 ID ${existingTenderId} from ${runDate}.`;
}

function firstTender247IdForRow(row: RunWorkbookRow): string {
  return normalizeTender247Id(row.tender247Id) || row.tender247Id || row.canonicalId;
}

function findHistoricalMatch(
  row: RunWorkbookRow,
  history: HistoricalTenderIndex,
): HistoricalTenderRecord | null {
  const t247 = normalizeTender247Id(row.tender247Id);
  if (t247) {
    const hit = history.byTender247Id.get(t247);
    if (hit) return hit;
  }
  const ref = referenceKey(row.referenceNo || row.bidAssistId);
  if (ref) {
    const hit = history.byReference.get(ref);
    if (hit) return hit;
  }
  const abd = authorityBriefDeadlineKey(row);
  if (abd) {
    const hit = history.byAuthorityBriefDeadline.get(abd);
    if (hit) return hit;
  }
  return null;
}

function findInternalMatch(
  row: RunWorkbookRow,
  seen: {
    tender247Id: Map<string, string>;
    reference: Map<string, string>;
    authorityBriefDeadline: Map<string, string>;
  },
): DuplicateMark | null {
  const t247 = normalizeTender247Id(row.tender247Id);
  if (t247 && seen.tender247Id.has(t247)) {
    return {
      kind: "tender247_id",
      reason: duplicateTender247Reason(t247),
      matchedTenderId: seen.tender247Id.get(t247)!,
    };
  }
  const ref = referenceKey(row.referenceNo || row.bidAssistId);
  if (ref && seen.reference.has(ref)) {
    return {
      kind: "reference",
      reason: duplicateReferenceReason(
        String(row.referenceNo || row.bidAssistId).trim(),
        seen.reference.get(ref)!,
      ),
      matchedTenderId: seen.reference.get(ref)!,
    };
  }
  const abd = authorityBriefDeadlineKey(row);
  if (abd && seen.authorityBriefDeadline.has(abd)) {
    return {
      kind: "authority_brief_deadline",
      reason: duplicateAuthorityReason(seen.authorityBriefDeadline.get(abd)!),
      matchedTenderId: seen.authorityBriefDeadline.get(abd)!,
    };
  }
  return null;
}

function registerInternalSeen(
  row: RunWorkbookRow,
  seen: {
    tender247Id: Map<string, string>;
    reference: Map<string, string>;
    authorityBriefDeadline: Map<string, string>;
  },
): void {
  const representativeId = firstTender247IdForRow(row);
  const t247 = normalizeTender247Id(row.tender247Id);
  if (t247 && !seen.tender247Id.has(t247)) {
    seen.tender247Id.set(t247, representativeId);
  }
  const ref = referenceKey(row.referenceNo || row.bidAssistId);
  if (ref && !seen.reference.has(ref)) {
    seen.reference.set(ref, representativeId);
  }
  const abd = authorityBriefDeadlineKey(row);
  if (abd && !seen.authorityBriefDeadline.has(abd)) {
    seen.authorityBriefDeadline.set(abd, representativeId);
  }
}

/**
 * Mark duplicate / historical rows while preserving every imported record.
 * First occurrence in the import stays screenable unless it matches history.
 */
export function annotateImportDuplicates(
  rows: RunWorkbookRow[],
  history: HistoricalTenderIndex,
): AnnotatedImportRow[] {
  const seen = {
    tender247Id: new Map<string, string>(),
    reference: new Map<string, string>(),
    authorityBriefDeadline: new Map<string, string>(),
  };
  const annotated: AnnotatedImportRow[] = [];

  rows.forEach((row, importIndex) => {
    const historical = findHistoricalMatch(row, history);
    if (historical) {
      annotated.push({
        ...row,
        importIndex,
        duplicateMark: {
          kind: "historical",
          reason: historicalReason(
            historical.tender247Id,
            historical.runDate,
          ),
          matchedTenderId: historical.tender247Id,
          matchedRunDate: historical.runDate,
        },
      });
      return;
    }

    const internal = findInternalMatch(row, seen);
    if (internal) {
      annotated.push({
        ...row,
        importIndex,
        duplicateMark: internal,
      });
      return;
    }

    annotated.push({ ...row, importIndex });
    registerInternalSeen(row, seen);
  });

  return annotated;
}

export function isAnnotatedDuplicate(
  row: AnnotatedImportRow,
): boolean {
  return Boolean(row.duplicateMark);
}

export function duplicateStatusCounts(rows: RunWorkbookRow[]): {
  DUPLICATE: number;
  NO_GO: number;
  VERIFY: number;
  CONDITIONAL_GO: number;
  GO: number;
  PARTNER_BID: number;
} {
  const counts = {
    DUPLICATE: 0,
    NO_GO: 0,
    VERIFY: 0,
    CONDITIONAL_GO: 0,
    GO: 0,
    PARTNER_BID: 0,
  };
  for (const row of rows) {
    const status = String(row.screeningStatus || "").toUpperCase();
    if (status === "DUPLICATE") counts.DUPLICATE += 1;
    else if (status === "NO_GO") counts.NO_GO += 1;
    else if (status === "VERIFY") counts.VERIFY += 1;
    else if (status === "CONDITIONAL_GO") counts.CONDITIONAL_GO += 1;
    else if (status === "GO") counts.GO += 1;
    else if (status === "PARTNER_BID") counts.PARTNER_BID += 1;
  }
  return counts;
}
