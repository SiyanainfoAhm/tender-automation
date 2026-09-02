import type { AnnotatedImportRow } from "./duplicateScreening.js";
import {
  isPhase1Duplicate,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";
import {
  ScreeningOutputInvalidError,
  type RunWorkbookRow,
} from "./runWorkbook.js";
import { normalizeTender247Id, referenceKey } from "./duplicateScreening.js";

function rowMatchQueues(gptRows: RunWorkbookRow[]): Map<string, RunWorkbookRow[]> {
  const queues = new Map<string, RunWorkbookRow[]>();
  const push = (key: string, row: RunWorkbookRow) => {
    if (!key) return;
    const list = queues.get(key) || [];
    list.push(row);
    queues.set(key, list);
  };

  for (const row of gptRows) {
    const t247 = normalizeTender247Id(row.tender247Id);
    if (t247) push(`t247:${t247}`, row);
    const ref = referenceKey(row.referenceNo || row.bidAssistId);
    if (ref) push(`ref:${ref}`, row);
    push(`canon:${row.canonicalId}`, row);
  }
  return queues;
}

function takeMatchedGptRow(
  input: AnnotatedImportRow,
  queues: Map<string, RunWorkbookRow[]>,
): RunWorkbookRow | null {
  const keys: string[] = [];
  const t247 = normalizeTender247Id(input.tender247Id);
  if (t247) keys.push(`t247:${t247}`);
  const ref = referenceKey(input.referenceNo || input.bidAssistId);
  if (ref) keys.push(`ref:${ref}`);
  keys.push(`canon:${input.canonicalId}`);

  for (const key of keys) {
    const queue = queues.get(key);
    if (!queue?.length) continue;
    return queue.shift() || null;
  }
  return null;
}

/**
 * Merge GPT-screened rows back onto the full import list (including DUPLICATE rows).
 * Rows ChatGPT omits are kept as VERIFY (never dropped).
 */
export function mergeScreeningResults(options: {
  importRows: AnnotatedImportRow[];
  gptRows: RunWorkbookRow[];
}): { rows: RunWorkbookRow[]; missingIds: string[] } {
  const queues = rowMatchQueues(options.gptRows);
  const merged: RunWorkbookRow[] = [];
  const missing: string[] = [];

  for (const input of options.importRows) {
    if (input.duplicateMark) {
      merged.push({
        ...input,
        screeningStatus: "DUPLICATE",
        screeningReason: input.duplicateMark.reason,
      });
      continue;
    }

    const gpt = takeMatchedGptRow(input, queues);
    if (!gpt || !gpt.screeningStatus) {
      missing.push(input.canonicalId);
      merged.push({
        ...input,
        screeningStatus: "VERIFY",
        screeningReason: "AI response missing tender mapping",
      });
      continue;
    }

    merged.push({
      ...input,
      screeningStatus: gpt.screeningStatus,
      screeningReason: gpt.screeningReason || input.screeningReason,
      tenderCategory: gpt.tenderCategory || input.tenderCategory,
    });
  }

  if (merged.length !== options.importRows.length) {
    throw new ScreeningOutputInvalidError(
      `SCREENING_OUTPUT_ROW_COUNT_MISMATCH output=${merged.length} input=${options.importRows.length}`,
    );
  }

  return { rows: merged, missingIds: missing };
}

export function assertNoScreeningOnDuplicates(rows: RunWorkbookRow[]): void {
  for (const row of rows) {
    if (!isPhase1Duplicate(row.screeningStatus)) continue;
    const status = String(row.screeningStatus || "").toUpperCase();
    if (status !== "DUPLICATE") {
      throw new ScreeningOutputInvalidError(
        `SCREENING_OUTPUT_INVALID duplicate_row_wrong_status=${row.canonicalId}`,
      );
    }
  }
}

export function toPhase1ScreeningStatus(
  status: Phase1ScreeningStatus | "",
): Phase1ScreeningStatus | null {
  if (!status) return null;
  return status;
}
