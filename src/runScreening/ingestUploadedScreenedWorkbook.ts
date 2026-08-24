/**
 * Ingest an already-screened Excel (Status + Decision Reason present).
 * Skips Tender247 Excel download and ChatGPT Excel screening; writes the
 * canonical run-screened workbook, persists every row (including No Bid) to
 * Supabase, then returns the same Phase-1 result shape the detail crawler uses.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { loadCompanyPreferenceSnapshot } from "./companyPreferences.js";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import { persistGptScreenedWorkbookToDatabase } from "./persistPhase1Results.js";
import { PHASE1_SCREENING_POLICY_VERSION } from "./screeningPolicy.js";
import {
  countPhase1Statuses,
  deriveDetailScrapeIds,
  hashFile,
  hashText,
  parseSourceWorkbook,
  readRunWorkbook,
  workbookLooksPreScreened,
  writeRunWorkbook,
  type RunWorkbookRow,
} from "./runWorkbook.js";
import type { Phase1ExcelScreeningResult } from "./runPhase1ExcelScreening.js";
import { runCorrelationIdForDate } from "./phase1DetailQueue.js";
import {
  saveRunState,
  saveScreeningManifest,
  screenedWorkbookPath,
  screeningDir,
  writeJson,
} from "./screeningManifest.js";

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

export async function ingestUploadedScreenedWorkbook(options: {
  uploadedExcelPath: string;
  dateFolder: string;
  dateIso: string;
  companyId?: string;
  logger?: Logger;
  persistResults?: boolean;
}): Promise<Phase1ExcelScreeningResult> {
  const absolute = path.resolve(options.uploadedExcelPath);
  if (!fs.existsSync(absolute)) {
    throw new AutomationError(
      "UPLOADED_EXCEL_NOT_FOUND",
      `Uploaded Excel not found: ${absolute}`,
    );
  }

  const rows = parseSourceWorkbook(absolute, "TENDER247");
  if (rows.length === 0) {
    throw new AutomationError(
      "UPLOADED_EXCEL_EMPTY",
      `No tender rows found in uploaded Excel: ${absolute}`,
    );
  }

  if (!workbookLooksPreScreened(rows)) {
    throw new AutomationError(
      "UPLOADED_EXCEL_NOT_PRESCREENED",
      "Uploaded Excel is missing Status on most rows. Add Status (No Bid / Verify / May Bid / Will Bid) or omit --pre-screened so ChatGPT Excel screening can run.",
    );
  }

  const missingStatus = rows.filter((row) => !row.screeningStatus);
  if (missingStatus.length > 0) {
    log(
      options.logger,
      `UPLOADED_EXCEL_ROWS_WITHOUT_STATUS=${missingStatus.length} (excluded from shortlist)`,
    );
  }

  const outputRows: RunWorkbookRow[] = rows.filter((row) =>
    Boolean(row.screeningStatus),
  );
  const counts = countPhase1Statuses(outputRows);
  const shortlist = deriveDetailScrapeIds(outputRows);
  const noBidRows = outputRows.filter((row) => row.screeningStatus === "NO_GO");

  const dir = screeningDir(options.dateFolder);
  fs.mkdirSync(dir, { recursive: true });
  const archivedInput = path.join(
    dir,
    `uploaded-prescreened-${options.dateIso}.xlsx`,
  );
  fs.copyFileSync(absolute, archivedInput);
  const screenedPath = screenedWorkbookPath(options.dateFolder);
  writeRunWorkbook(outputRows, screenedPath);

  // Re-read to ensure detail queue uses the same canonical file the rest of the pipeline expects.
  const verified = readRunWorkbook(screenedPath);
  if (verified.length === 0) {
    throw new AutomationError(
      "UPLOADED_EXCEL_SCREENED_WRITE_FAILED",
      `Failed to write screened workbook: ${screenedPath}`,
    );
  }

  const companyId = options.companyId ?? resolveRunCompanyId();
  const snapshot = await loadCompanyPreferenceSnapshot(companyId);
  const screeningRunId = runCorrelationIdForDate(options.dateIso);
  const inputWorkbookHash = hashFile(archivedInput);
  const preferencesHash = hashText(`uploaded-prescreened:${companyId}`);

  writeJson(path.join(dir, "uploaded-excel-ingest.json"), {
    screeningRunId,
    sourcePath: absolute,
    archivedInput,
    screenedPath,
    rowCount: outputRows.length,
    counts,
    detailCandidates: shortlist.tender247Ids.length,
    noBid: counts.NO_GO,
    updatedAt: new Date().toISOString(),
  });

  if (options.persistResults !== false) {
    log(
      options.logger,
      `UPLOADED_EXCEL_SUPABASE_SYNC_START rows=${outputRows.length} noBid=${counts.NO_GO}`,
    );
    await persistGptScreenedWorkbookToDatabase({
      rows: outputRows,
      runDate: options.dateIso,
      dateFolder: options.dateFolder,
      screenedWorkbookPath: screenedPath,
      companyId,
      logger: options.logger,
      screeningSource: "UPLOADED_PRESCREENED_EXCEL",
    });
    log(options.logger, "UPLOADED_EXCEL_SUPABASE_SYNC_COMPLETE=true");
  }

  saveScreeningManifest(options.dateFolder, {
    companyId: snapshot.company.id,
    companyName: snapshot.company.name,
    runDate: options.dateIso,
    screeningRunId,
    stage: "SHORTLIST_READY",
    status: "complete",
    inputWorkbook: archivedInput,
    inputWorkbookHash,
    preferencesHash,
    companyPreferenceSnapshotHash: preferencesHash,
    screeningPolicyVersion: PHASE1_SCREENING_POLICY_VERSION,
    screeningPromptHash: hashText("uploaded-prescreened-skip-chatgpt-excel"),
    screenedWorkbook: screenedPath,
    screenedWorkbookHash: hashFile(screenedPath),
    inputRows: rows.length,
    outputRows: outputRows.length,
    counts,
    error: null,
    updatedAt: new Date().toISOString(),
  });
  saveRunState(options.dateFolder, {
    stage: "SHORTLIST_READY",
    aiScreeningComplete: true,
    shortlistReady: true,
    screeningRunId,
    updatedAt: new Date().toISOString(),
  });

  log(options.logger, "UPLOADED_EXCEL_PRESCREENED_INGEST=true");
  log(options.logger, `AI_SCREENING_COMPLETE=true (skipped ChatGPT Excel screening)`);
  log(options.logger, `SHORTLIST_NO_BID=${counts.NO_GO}`);
  log(options.logger, `SHORTLIST_VERIFY=${counts.VERIFY}`);
  log(options.logger, `SHORTLIST_MAY_BID=${counts.CONDITIONAL_GO}`);
  log(options.logger, `SHORTLIST_WILL_BID=${counts.GO}`);
  log(
    options.logger,
    `[DETAIL CRAWL] candidates = ${shortlist.tender247Ids.length}`,
  );

  return {
    status: "complete",
    aiScreeningComplete: true,
    inputWorkbookPath: archivedInput,
    normalizedPath: archivedInput,
    originalTender247Path: absolute,
    inputFilename: path.basename(absolute),
    screenedPath,
    inputRows: rows.length,
    outputRows: outputRows.length,
    counts,
    tender247DetailIds: shortlist.tender247Ids,
    bidAssistDetailIds: shortlist.bidAssistIds,
    noBidRows,
  };
}
