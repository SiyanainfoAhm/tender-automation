/**
 * Phase-1 run-level Excel screening orchestrator.
 * Source of truth: Tender247 downloaded Excel → ChatGPT screening.
 * No local company/NO_BID pre-filter; only exact dedupe + column normalize.
 */
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { buildDailyScreeningOperatorPrompt, writeScreeningMdPreferences, dailyScreeningOutputFilename } from "./buildDailyScreeningOperatorPrompt.js";
import { isDailyScreeningOutputFilename } from "../chatgptQualification/assistantSpreadsheetAttachment.js";
import {
  hashPreferenceSnapshot,
  loadCompanyPreferenceSnapshot,
  toTenderScreeningPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "./companyPreferences.js";
import {
  createLiveChatGptExcelScreeningClient,
  type ChatGptExcelScreeningClient,
} from "./chatgptExcelScreening.js";
import {
  applyScreeningDecisionsToWorkbook,
  inventoryTenderWorkbook,
} from "./applyScreeningDecisionsToWorkbook.js";
import {
  parseScreeningDecisionsJson,
} from "./screeningDecisionSchema.js";
import { logActiveScreeningRules, PHASE1_SCREENING_POLICY_VERSION } from "./screeningPolicy.js";
import { persistGptScreenedWorkbookToDatabase } from "./persistPhase1Results.js";
import { runCorrelationIdForDate } from "./phase1DetailQueue.js";
import {
  deriveDetailScrapeIds,
  hashFile,
  hashText,
  normalizeAndDedupeRunRows,
  parseSourceWorkbook,
  ScreeningOutputInvalidError,
  validateScreenedWorkbook,
  type RunWorkbookRow,
} from "./runWorkbook.js";
import {
  assertAiScreeningCompleteForDetailCrawl,
  emptyStatusCounts,
  loadScreeningManifest,
  resolveExistingScreenedWorkbook,
  saveRunState,
  saveScreeningChatCheckpoint,
  saveScreeningManifest,
  saveIngestionCounts,
  screenedWorkbookPath,
  screeningDir,
  loadScreeningChatCheckpoint,
  type Phase1ScreeningManifest,
} from "./screeningManifest.js";
import type { AppConfig } from "../config.js";

export { assertAiScreeningCompleteForDetailCrawl };

export type Phase1ExcelScreeningResult = {
  status: "complete" | "failed" | "pending";
  aiScreeningComplete: boolean;
  /** GPT input workbook path (Tender247-derived under screening/). */
  inputWorkbookPath: string;
  /** @deprecated Alias of inputWorkbookPath (legacy callers). */
  normalizedPath: string;
  originalTender247Path: string;
  inputFilename: string;
  screenedPath: string | null;
  inputRows: number;
  outputRows: number;
  counts: Phase1ScreeningManifest["counts"];
  tender247DetailIds: string[];
  bidAssistDetailIds: string[];
  noBidRows: RunWorkbookRow[];
  error?: string | null;
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

async function validateScreenedWorkbookAsIs(options: {
  inputRows: RunWorkbookRow[];
  outputPath: string;
  logger?: Logger;
}): Promise<{
  outputRows: RunWorkbookRow[];
  counts: Phase1ScreeningManifest["counts"];
}> {
  log(options.logger, "SCREENING_VALIDATION_START");
  // ChatGPT Status / Decision Reason are authoritative — no local repair.
  const validated = validateScreenedWorkbook({
    inputRows: options.inputRows,
    outputPath: options.outputPath,
    allowMissingStatus: false,
  });
  log(options.logger, `GPT_ROWS=${validated.outputRows.length}`);
  log(options.logger, `SCREENED_ROWS=${validated.outputRows.length}`);
  log(
    options.logger,
    `VALID_STATUS_ROWS=${validated.outputRows.filter((row) => Boolean(row.screeningStatus)).length}`,
  );
  log(options.logger, "SCREENING_VALIDATION_COMPLETE=true");
  log(options.logger, "PHASE1_DECISION_GUARD=SKIPPED");
  log(options.logger, "PHASE1_LOCAL_STATUS_REPAIR=SKIPPED");
  return {
    outputRows: validated.outputRows,
    counts: validated.counts,
  };
}

function newestMatching(dateFolder: string, pattern: RegExp): string | undefined {
  if (!fs.existsSync(dateFolder)) return undefined;

  const accountId = process.env.TENDER247_ACCOUNT_ID?.trim() || "";
  const preferDir = accountId
    ? path.join(dateFolder, "accounts", accountId)
    : null;

  const candidates: Array<{ fullPath: string; mtimeMs: number }> = [];
  const collectFrom = (dir: string, depth: number) => {
    if (!fs.existsSync(dir) || depth > 3) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith("~$")) continue;
      const fullPath = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (name === "accounts" || dir.includes(`${path.sep}accounts`)) {
          collectFrom(fullPath, depth + 1);
        }
        continue;
      }
      if (pattern.test(name)) {
        candidates.push({ fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  };

  // Prefer this account's seed Excel so multi-account runs never cross-read.
  if (preferDir && fs.existsSync(preferDir)) {
    collectFrom(preferDir, 0);
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]?.fullPath;
    }
  }

  collectFrom(dateFolder, 0);
  for (const name of fs.readdirSync(dateFolder)) {
    if (name.startsWith("~$") || !pattern.test(name)) continue;
    const fullPath = path.join(dateFolder, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        candidates.push({ fullPath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.fullPath;
}

function emptyResult(base: {
  inputWorkbookPath: string;
  originalTender247Path: string;
  inputFilename: string;
  status: Phase1ExcelScreeningResult["status"];
  error?: string | null;
  inputRows?: number;
}): Phase1ExcelScreeningResult {
  return {
    status: base.status,
    aiScreeningComplete: base.status === "complete",
    inputWorkbookPath: base.inputWorkbookPath,
    normalizedPath: base.inputWorkbookPath,
    originalTender247Path: base.originalTender247Path,
    inputFilename: base.inputFilename,
    screenedPath: null,
    inputRows: base.inputRows ?? 0,
    outputRows: 0,
    counts: emptyStatusCounts(),
    tender247DetailIds: [],
    bidAssistDetailIds: [],
    noBidRows: [],
    error: base.error ?? null,
  };
}

/**
 * Prepare Tender247 Excel for GPT: archive original multi-sheet export and
 * attach that same structure (never flatten / rebuild as GPT input).
 */
function prepareTender247GptInput(options: {
  tender247Path: string;
  dateFolder: string;
  logger?: Logger;
}): {
  originalArchivePath: string;
  gptInputPath: string;
  inputFilename: string;
  rows: RunWorkbookRow[];
  tender247Raw: number;
  tender247Unique: number;
  duplicatesRemoved: number;
} {
  const dir = screeningDir(options.dateFolder);
  fs.mkdirSync(dir, { recursive: true });

  const inputFilename = path.basename(options.tender247Path);
  const originalArchivePath = path.join(dir, `export-original-${inputFilename}`);
  fs.copyFileSync(options.tender247Path, originalArchivePath);
  log(options.logger, `SCREENING_ORIGINAL_TENDER247=${originalArchivePath}`);

  // GPT attachment = original multi-sheet Tender247 export (Gem / Non-Gem preserved).
  const gptInputPath = path.join(dir, inputFilename);
  fs.copyFileSync(options.tender247Path, gptInputPath);

  const tender247Rows = parseSourceWorkbook(options.tender247Path, "TENDER247");
  const prepared = normalizeAndDedupeRunRows({
    tender247Rows,
    bidAssistRows: [],
  });
  log(options.logger, `[RUN] Tender247 raw = ${prepared.tender247Raw}`);
  log(options.logger, `[DEDUPE] Tender247 unique = ${prepared.tender247Unique}`);
  log(options.logger, `[DEDUPE] duplicates removed = ${prepared.duplicatesRemoved}`);
  log(options.logger, "TENDER247_LOCAL_NO_BID_PREFILTER=false");
  log(options.logger, "TENDER247_ROWS_PRESERVED_BEFORE_GPT=true");
  log(options.logger, "CHATGPT_SCREENING_MODE=JSON_DECISIONS");

  return {
    originalArchivePath,
    gptInputPath,
    inputFilename,
    // Preserve every original tender row for reconciliation (no shortlist / no drop).
    rows: tender247Rows,
    tender247Raw: prepared.tender247Raw,
    tender247Unique: prepared.tender247Unique,
    duplicatesRemoved: prepared.duplicatesRemoved,
  };
}

export async function runPhase1ExcelScreening(options: {
  dateFolder: string;
  dateIso: string;
  config?: AppConfig;
  logger?: Logger;
  tender247ExcelPath?: string;
  /** Ignored for GPT input — Tender247 is the sole source of truth. */
  bidAssistExcelPath?: string;
  chatgptClient?: ChatGptExcelScreeningClient;
  companySnapshot?: CompanyPreferenceSnapshot;
  skipChatGpt?: boolean;
  persistResults?: boolean;
}): Promise<Phase1ExcelScreeningResult> {
  const { dateFolder, dateIso, logger } = options;
  const tender247Path =
    options.tender247ExcelPath ??
    newestMatching(dateFolder, /^Tender247_.*\.xlsx$/i);

  if (!tender247Path || !fs.existsSync(tender247Path)) {
    throw new AutomationError(
      "TENDER247_EXCEL_MISSING",
      "Tender247 downloaded Excel not found for Phase-1 screening",
    );
  }

  saveRunState(dateFolder, {
    stage: "INGESTION_COMPLETE",
    aiScreeningComplete: false,
    shortlistReady: false,
    updatedAt: new Date().toISOString(),
  });

  const prepared = prepareTender247GptInput({
    tender247Path,
    dateFolder,
    logger,
  });
  const {
    gptInputPath,
    inputFilename,
    rows: inputRows,
    originalArchivePath,
  } = prepared;
  const inputWorkbookHash = hashFile(gptInputPath);

  saveIngestionCounts(dateFolder, {
    dailyRowsRaw: prepared.tender247Raw,
    dailyRowsDeduped: prepared.tender247Unique,
    tender247Raw: prepared.tender247Raw,
    bidAssistRaw: 0,
    updatedAt: new Date().toISOString(),
  });

  saveRunState(dateFolder, {
    stage: "DEDUPE_COMPLETE",
    aiScreeningComplete: false,
    shortlistReady: false,
    updatedAt: new Date().toISOString(),
  });

  if (inputRows.length === 0) {
    const empty = emptyResult({
      inputWorkbookPath: gptInputPath,
      originalTender247Path: originalArchivePath,
      inputFilename,
      status: "complete",
      inputRows: 0,
    });
    saveRunState(dateFolder, {
      stage: "AI_SCREENING_COMPLETE",
      aiScreeningComplete: true,
      shortlistReady: true,
      updatedAt: new Date().toISOString(),
    });
    return empty;
  }

  if (options.skipChatGpt) {
    saveRunState(dateFolder, {
      stage: "SCREENING_PENDING",
      aiScreeningComplete: false,
      shortlistReady: false,
      error: "SCREENING_PENDING",
      updatedAt: new Date().toISOString(),
    });
    return emptyResult({
      inputWorkbookPath: gptInputPath,
      originalTender247Path: originalArchivePath,
      inputFilename,
      status: "pending",
      error: "SCREENING_PENDING",
      inputRows: inputRows.length,
    });
  }

  log(logger, "[AI SCREENING] Loading Siyana preferences...");
  const snapshot =
    options.companySnapshot ?? (await loadCompanyPreferenceSnapshot(resolveRunCompanyId()));
  log(logger, "[AI SCREENING] Company preferences loaded");
  const screeningSnapshot = toTenderScreeningPreferenceSnapshot(snapshot);
  const preferencesHash = hashPreferenceSnapshot(snapshot);
  const companyPreferenceSnapshotHash = preferencesHash;
  const workbookInventory = await inventoryTenderWorkbook(gptInputPath);
  log(logger, `INPUT_TOTAL_ROWS=${workbookInventory.totalRows}`);
  log(logger, `INPUT_SHEETS=${JSON.stringify(workbookInventory.sheetNames)}`);
  const dir = screeningDir(dateFolder);
  fs.mkdirSync(dir, { recursive: true });
  const screeningMdPath = path.join(dir, "screening.md");
  writeScreeningMdPreferences({
    snapshot,
    outputPath: screeningMdPath,
  });
  const prompt = buildDailyScreeningOperatorPrompt({
    runDate: dateIso,
    sourceExcelName: inputFilename,
  });
  const screeningPromptHash = hashText(prompt);
  logActiveScreeningRules(screeningSnapshot, (message) => log(logger, message));
  fs.writeFileSync(
    path.join(dir, "company-preferences-snapshot.json"),
    JSON.stringify(
      {
        ...snapshot,
        screening: screeningSnapshot,
        screeningPolicyVersion: PHASE1_SCREENING_POLICY_VERSION,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "chatgpt-screening-prompt.txt"), prompt, "utf8");
  log(logger, `CHATGPT_SCREENING_MD_WRITTEN=${screeningMdPath}`);

  const screenedPath = screenedWorkbookPath(dateFolder);
  const existingManifest = loadScreeningManifest(dateFolder);
  const existingScreened = resolveExistingScreenedWorkbook(dateFolder, dateIso);
  const screenedExists = Boolean(existingScreened);
  const hashesMatchExisting =
    Boolean(existingManifest) &&
    existingManifest!.inputWorkbookHash === inputWorkbookHash &&
    existingManifest!.preferencesHash === preferencesHash &&
    (existingManifest!.companyPreferenceSnapshotHash ?? existingManifest!.preferencesHash) ===
      companyPreferenceSnapshotHash &&
    existingManifest!.screeningPromptHash === screeningPromptHash &&
    existingManifest!.screeningPolicyVersion === PHASE1_SCREENING_POLICY_VERSION;
  // Resume when a prior run left a valid XLSX even if status was "failed"
  // (e.g. old multi-sheet double-count bug that is now fixed in the reader).
  if (screenedExists && hashesMatchExisting) {
    try {
      const validated = await validateScreenedWorkbookAsIs({
        inputRows,
        outputPath: existingScreened!,
        logger,
      });
      log(
        logger,
        existingManifest?.status === "complete"
          ? "[AI SCREENING] Resuming valid screened workbook"
          : "[AI SCREENING] Revalidating existing screened workbook after prior failure",
      );
      return await finalizeScreening({
        dateFolder,
        dateIso,
        snapshot,
        inputWorkbookPath: gptInputPath,
        originalTender247Path: originalArchivePath,
        inputFilename,
        screenedPath: existingScreened!,
        inputWorkbookHash,
        preferencesHash,
        companyPreferenceSnapshotHash,
        screeningPromptHash,
        inputRows,
        outputRows: validated.outputRows,
        counts: validated.counts,
        logger,
        persistResults: options.persistResults,
      });
    } catch {
      log(logger, "[AI SCREENING] Existing screened workbook failed validation; rerunning");
    }
  }

  saveRunState(dateFolder, {
    stage: "AI_SCREENING_STARTED",
    aiScreeningComplete: false,
    shortlistReady: false,
    updatedAt: new Date().toISOString(),
  });

  log(logger, `CHATGPT_INPUT_FILE_READY=true`);
  log(logger, `CHATGPT_INPUT_FILENAME=${inputFilename}`);
  log(logger, `CHATGPT_INPUT_ROW_COUNT=${workbookInventory.totalRows || inputRows.length}`);
  log(logger, `[AI SCREENING] Uploading ${inputFilename} + screening.md to shared chat`);

  const client =
    options.chatgptClient ??
    (options.config
      ? createLiveChatGptExcelScreeningClient({
          config: options.config,
          logger: logger!,
        })
      : null);
  if (!client) {
    saveRunState(dateFolder, {
      stage: "SCREENING_PENDING",
      aiScreeningComplete: false,
      shortlistReady: false,
      error: "SCREENING_PENDING",
      updatedAt: new Date().toISOString(),
    });
    return emptyResult({
      inputWorkbookPath: gptInputPath,
      originalTender247Path: originalArchivePath,
      inputFilename,
      status: "pending",
      error: "SCREENING_PENDING: no ChatGPT screening client",
      inputRows: inputRows.length,
    });
  }

  try {
    const screening = await client.screenWorkbook({
      inputWorkbookPath: gptInputPath,
      prompt,
      screeningMdPath,
      outputPath: screenedPath,
      runDate: dateIso,
    });

    if (screening.screenedWorkbookPath) {
      if (
        path.resolve(screening.screenedWorkbookPath) !==
        path.resolve(screenedPath)
      ) {
        fs.copyFileSync(screening.screenedWorkbookPath, screenedPath);
      }
      log(logger, `CHATGPT_SCREENED_WORKBOOK=${screenedPath}`);
    } else if (screening.decisionsText) {
      const parsed = parseScreeningDecisionsJson(screening.decisionsText);
      if (!parsed.ok) {
        throw new AutomationError(
          "SCREENING_OUTPUT_INVALID",
          `SCREENING_OUTPUT_INVALID: ${parsed.error}`,
        );
      }
      const applied = await applyScreeningDecisionsToWorkbook({
        sourceWorkbookPath: gptInputPath,
        outputPath: screenedPath,
        decisions: parsed.decisions,
        logger,
      });
      log(logger, `SCREENING_INPUT_ROWS=${applied.inputTotalRows}`);
      log(logger, `SCREENING_OUTPUT_ROWS=${applied.outputTotalRows}`);
      log(
        logger,
        `SCREENING_MISSING_TENDER_IDS=${JSON.stringify(applied.missingTenderIds)}`,
      );
      log(logger, `SCREENING_UPDATED_ROWS=${applied.updatedRows}`);
      if (applied.inputTotalRows !== applied.outputTotalRows) {
        throw new AutomationError(
          "SCREENING_OUTPUT_INVALID",
          `SCREENING_OUTPUT_INVALID missing_rows=${JSON.stringify(applied.missingTenderIds)} extra_rows=${JSON.stringify(applied.extraDecisionIds)}`,
        );
      }
    } else {
      throw new AutomationError(
        "SCREENING_OUTPUT_MISSING",
        "SCREENING_OUTPUT_MISSING: ChatGPT returned neither screened Excel nor JSON decisions",
      );
    }

    const validated = await validateScreenedWorkbookAsIs({
      inputRows,
      outputPath: screenedPath,
      logger,
    });
    log(logger, "SCREENING_ROW_RECONCILIATION=PASS");
    log(logger, "[AI SCREENING] Reconciliation = PASS");
    log(logger, "[AI SCREENING] Workbook validation=PASS");
    log(logger, "CHATGPT_SCREENING_OUTPUT_VALID=true");
    log(logger, `[AI SCREENING] NO_BID = ${validated.counts.NO_GO}`);
    log(logger, `[AI SCREENING] VERIFY = ${validated.counts.VERIFY}`);
    log(logger, `[AI SCREENING] MAY_BID = ${validated.counts.CONDITIONAL_GO}`);
    log(logger, `[AI SCREENING] WILL_BID = ${validated.counts.GO}`);
    {
      const prior = loadScreeningChatCheckpoint(screenedPath);
      saveScreeningChatCheckpoint(screenedPath, {
        conversationUrl: prior?.conversationUrl || "",
        correlationId: runCorrelationIdForDate(dateIso),
        expectedFilename:
          prior?.expectedFilename &&
          isDailyScreeningOutputFilename(prior.expectedFilename)
            ? prior.expectedFilename
            : dailyScreeningOutputFilename(dateIso),
        submittedAt: prior?.submittedAt || new Date().toISOString(),
        stage: "WORKBOOK_DOWNLOADED",
        validated: true,
      });
    }

    return await finalizeScreening({
      dateFolder,
      dateIso,
      snapshot,
      inputWorkbookPath: gptInputPath,
      originalTender247Path: originalArchivePath,
      inputFilename,
      screenedPath,
      inputWorkbookHash,
      preferencesHash,
      companyPreferenceSnapshotHash,
      screeningPromptHash,
      inputRows,
      outputRows: validated.outputRows,
      counts: validated.counts,
      logger,
      persistResults: options.persistResults,
    });
  } catch (error) {
    const code =
      error instanceof ScreeningOutputInvalidError
        ? error.code
        : error instanceof AutomationError
          ? error.code
          : "SCREENING_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    logger?.error?.(`[AI SCREENING] ${code} ${message}`);
    // Drop invalid/partial screened Excel so the next run cannot resume it.
    try {
      if (fs.existsSync(screenedPath)) {
        fs.unlinkSync(screenedPath);
        log(logger, "CHATGPT_SCREENING_INVALID_OUTPUT_REMOVED=true");
      }
      const sessionPath = path.join(
        screeningDir(dateFolder),
        "chatgpt-screening-session.json",
      );
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    } catch {
      /* ignore cleanup errors */
    }
    saveRunState(dateFolder, {
      stage: "AI_SCREENING_FAILED",
      aiScreeningComplete: false,
      shortlistReady: false,
      error: `${code}: ${message}`,
      updatedAt: new Date().toISOString(),
    });
    saveScreeningManifest(dateFolder, {
      companyId: snapshot.company.id,
      companyName: snapshot.company.name,
      runDate: dateIso,
      stage: "AI_SCREENING_FAILED",
      status: "failed",
      inputWorkbook: gptInputPath,
      inputWorkbookHash,
      preferencesHash,
      companyPreferenceSnapshotHash,
      screeningPolicyVersion: PHASE1_SCREENING_POLICY_VERSION,
      screeningPromptHash,
      screenedWorkbook: null,
      screenedWorkbookHash: null,
      inputRows: inputRows.length,
      outputRows: 0,
      counts: emptyStatusCounts(),
      error: `${code}: ${message}`,
      updatedAt: new Date().toISOString(),
    });
    throw error instanceof ScreeningOutputInvalidError ||
      error instanceof AutomationError
      ? error
      : new Error(`${code}: ${message}`);
  }
}

async function finalizeScreening(options: {
  dateFolder: string;
  dateIso: string;
  snapshot: CompanyPreferenceSnapshot;
  inputWorkbookPath: string;
  originalTender247Path: string;
  inputFilename: string;
  screenedPath: string;
  inputWorkbookHash: string;
  preferencesHash: string;
  companyPreferenceSnapshotHash: string;
  screeningPromptHash: string;
  inputRows: RunWorkbookRow[];
  outputRows: RunWorkbookRow[];
  counts: Phase1ScreeningManifest["counts"];
  logger?: Logger;
  persistResults?: boolean;
}): Promise<Phase1ExcelScreeningResult> {
  const shortlist = deriveDetailScrapeIds(options.outputRows);
  const noBidRows = options.outputRows.filter((row) => row.screeningStatus === "NO_GO");
  const screeningRunId = runCorrelationIdForDate(options.dateIso);
  if (options.persistResults !== false) {
    // GPT screened workbook is the DB source of truth.
    await persistGptScreenedWorkbookToDatabase({
      rows: options.outputRows,
      runDate: options.dateIso,
      dateFolder: options.dateFolder,
      screenedWorkbookPath: options.screenedPath,
      companyId: options.snapshot.company.id,
      logger: options.logger,
    });
  }

  saveScreeningManifest(options.dateFolder, {
    companyId: options.snapshot.company.id,
    companyName: options.snapshot.company.name,
    runDate: options.dateIso,
    screeningRunId,
    stage: "SHORTLIST_READY",
    status: "complete",
    inputWorkbook: options.inputWorkbookPath,
    inputWorkbookHash: options.inputWorkbookHash,
    preferencesHash: options.preferencesHash,
    companyPreferenceSnapshotHash: options.companyPreferenceSnapshotHash,
    screeningPolicyVersion: PHASE1_SCREENING_POLICY_VERSION,
    screeningPromptHash: options.screeningPromptHash,
    screenedWorkbook: options.screenedPath,
    screenedWorkbookHash: hashFile(options.screenedPath),
    inputRows: options.inputRows.length,
    outputRows: options.outputRows.length,
    counts: options.counts,
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
  log(options.logger, "AI_SCREENING_COMPLETE=true");
  log(options.logger, `SCREENING_RUN_ID=${screeningRunId}`);
  log(options.logger, `FILTERED_OUT=${options.counts.NO_GO}`);
  log(options.logger, `FILTER_PASSED=${shortlist.tender247Ids.length + shortlist.bidAssistIds.length}`);
  log(options.logger, `SHORTLIST_NO_BID=${options.counts.NO_GO}`);
  log(options.logger, `SHORTLIST_VERIFY=${options.counts.VERIFY}`);
  log(options.logger, `SHORTLIST_MAY_BID=${options.counts.CONDITIONAL_GO}`);
  log(options.logger, `SHORTLIST_WILL_BID=${options.counts.GO}`);

  options.logger?.info(
    `[DETAIL CRAWL] candidates = ${shortlist.tender247Ids.length}`,
  );

  return {
    status: "complete",
    aiScreeningComplete: true,
    inputWorkbookPath: options.inputWorkbookPath,
    normalizedPath: options.inputWorkbookPath,
    originalTender247Path: options.originalTender247Path,
    inputFilename: options.inputFilename,
    screenedPath: options.screenedPath,
    inputRows: options.inputRows.length,
    outputRows: options.outputRows.length,
    counts: options.counts,
    tender247DetailIds: shortlist.tender247Ids,
    bidAssistDetailIds: shortlist.bidAssistIds,
    noBidRows,
  };
}
