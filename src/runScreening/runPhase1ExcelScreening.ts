/**
 * Phase-1 run-level Excel screening orchestrator.
 * Deterministic dedupe locally; company suitability only via ChatGPT.
 */
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { buildTenderScreeningPrompt } from "./buildScreeningPrompt.js";
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
import { logActiveScreeningRules, PHASE1_SCREENING_POLICY_VERSION } from "./screeningPolicy.js";
import { persistGptScreenedWorkbookToDatabase } from "./persistPhase1Results.js";
import { enforcePhase1ScreeningDecisions } from "./phase1DecisionGuard.js";
import { runCorrelationIdForDate } from "./phase1DetailQueue.js";
import {
  deriveDetailScrapeIds,
  hashFile,
  hashText,
  normalizeAndDedupeRunRows,
  parseSourceWorkbook,
  RUN_NORMALIZED_FILE,
  ScreeningOutputInvalidError,
  validateScreenedWorkbook,
  writeRunWorkbook,
  countPhase1Statuses,
  type RunWorkbookRow,
} from "./runWorkbook.js";
import {
  assertAiScreeningCompleteForDetailCrawl,
  emptyStatusCounts,
  loadScreeningManifest,
  resolveExistingScreenedWorkbook,
  saveRunState,
  saveScreeningManifest,
  saveIngestionCounts,
  screenedWorkbookPath,
  screeningDir,
  type Phase1ScreeningManifest,
} from "./screeningManifest.js";
import type { AppConfig } from "../config.js";

export { assertAiScreeningCompleteForDetailCrawl };

export type Phase1ExcelScreeningResult = {
  status: "complete" | "failed" | "pending";
  aiScreeningComplete: boolean;
  normalizedPath: string;
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

function applyDeterministicPhase1Guard(options: {
  inputRows: RunWorkbookRow[];
  outputRows: RunWorkbookRow[];
  snapshot: CompanyPreferenceSnapshot;
  runDate: string;
  screenedPath: string;
  logger?: Logger;
}): { outputRows: RunWorkbookRow[]; counts: Phase1ScreeningManifest["counts"] } {
  const enforced = enforcePhase1ScreeningDecisions({
    inputRows: options.inputRows,
    outputRows: options.outputRows,
    snapshot: options.snapshot,
    runDate: options.runDate,
    log: (message) => log(options.logger, message),
  });
  writeRunWorkbook(enforced.rows, options.screenedPath);
  if (enforced.corrected > 0) {
    log(options.logger, `PHASE1_DECISIONS_CORRECTED=${enforced.corrected}`);
  }
  log(options.logger, "PHASE1_HARD_GATE_GUARD=APPLIED");
  return {
    outputRows: enforced.rows,
    counts: countPhase1Statuses(enforced.rows),
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

export async function runPhase1ExcelScreening(options: {
  dateFolder: string;
  dateIso: string;
  config?: AppConfig;
  logger?: Logger;
  tender247ExcelPath?: string;
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
  const bidAssistPath =
    options.bidAssistExcelPath ??
    newestMatching(dateFolder, /^BidAssist_.*\.xlsx$/i);

  const tender247Rows = parseSourceWorkbook(tender247Path, "TENDER247");
  const bidAssistRows = parseSourceWorkbook(bidAssistPath, "BIDASSIST");
  log(logger, `[RUN] Tender247 raw = ${tender247Rows.length}`);
  log(logger, `[RUN] BidAssist raw = ${bidAssistRows.length}`);

  saveRunState(dateFolder, {
    stage: "INGESTION_COMPLETE",
    aiScreeningComplete: false,
    shortlistReady: false,
    updatedAt: new Date().toISOString(),
  });

  const normalized = normalizeAndDedupeRunRows({
    tender247Rows,
    bidAssistRows,
  });
  log(logger, `[DEDUPE] Tender247 unique = ${normalized.tender247Unique}`);
  log(logger, `[DEDUPE] BidAssist unique = ${normalized.bidAssistUnique}`);
  log(logger, `[DEDUPE] Combined unique = ${normalized.combinedUnique}`);

  saveIngestionCounts(dateFolder, {
    dailyRowsRaw: normalized.tender247Raw,
    dailyRowsDeduped: normalized.combinedUnique,
    tender247Raw: normalized.tender247Raw,
    bidAssistRaw: normalized.bidAssistRaw,
    updatedAt: new Date().toISOString(),
  });

  const normalizedPath = path.join(dateFolder, RUN_NORMALIZED_FILE);
  writeRunWorkbook(normalized.rows, normalizedPath);
  const inputWorkbookHash = hashFile(normalizedPath);

  saveRunState(dateFolder, {
    stage: "DEDUPE_COMPLETE",
    aiScreeningComplete: false,
    shortlistReady: false,
    updatedAt: new Date().toISOString(),
  });

  if (normalized.rows.length === 0) {
    const empty: Phase1ExcelScreeningResult = {
      status: "complete",
      aiScreeningComplete: true,
      normalizedPath,
      screenedPath: null,
      inputRows: 0,
      outputRows: 0,
      counts: emptyStatusCounts(),
      tender247DetailIds: [],
      bidAssistDetailIds: [],
      noBidRows: [],
    };
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
    return {
      status: "pending",
      aiScreeningComplete: false,
      normalizedPath,
      screenedPath: null,
      inputRows: normalized.combinedUnique,
      outputRows: 0,
      counts: emptyStatusCounts(),
      tender247DetailIds: [],
      bidAssistDetailIds: [],
      noBidRows: [],
      error: "SCREENING_PENDING",
    };
  }

  log(logger, "[AI SCREENING] Loading Siyana preferences...");
  const snapshot =
    options.companySnapshot ?? (await loadCompanyPreferenceSnapshot(resolveRunCompanyId()));
  log(logger, "[AI SCREENING] Company preferences loaded");
  const screeningSnapshot = toTenderScreeningPreferenceSnapshot(snapshot);
  const preferencesHash = hashPreferenceSnapshot(snapshot);
  const companyPreferenceSnapshotHash = preferencesHash;
  const prompt = buildTenderScreeningPrompt({
    companySnapshot: snapshot,
    runDate: dateIso,
    sourceExcelName: RUN_NORMALIZED_FILE,
    inputRowCount: normalized.combinedUnique,
  });
  const screeningPromptHash = hashText(prompt);
  logActiveScreeningRules(screeningSnapshot, (message) => log(logger, message));
  const dir = screeningDir(dateFolder);
  fs.mkdirSync(dir, { recursive: true });
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

  const screenedPath = screenedWorkbookPath(dateFolder);
  const existingManifest = loadScreeningManifest(dateFolder);
  const existingScreened = resolveExistingScreenedWorkbook(dateFolder);
  const screenedExists = Boolean(existingScreened);
  if (
    screenedExists &&
    existingManifest?.status === "complete" &&
    existingManifest.inputWorkbookHash === inputWorkbookHash &&
    existingManifest.preferencesHash === preferencesHash &&
    (existingManifest.companyPreferenceSnapshotHash ?? existingManifest.preferencesHash) ===
      companyPreferenceSnapshotHash &&
    existingManifest.screeningPromptHash === screeningPromptHash &&
    existingManifest.screeningPolicyVersion === PHASE1_SCREENING_POLICY_VERSION
  ) {
    try {
      const validated = validateScreenedWorkbook({
        inputRows: normalized.rows,
        outputPath: existingScreened!,
      });
      const guarded = applyDeterministicPhase1Guard({
        inputRows: normalized.rows,
        outputRows: validated.outputRows,
        snapshot,
        runDate: dateIso,
        screenedPath: existingScreened!,
        logger,
      });
      log(logger, "[AI SCREENING] Resuming valid screened workbook");
      return await finalizeScreening({
        dateFolder,
        dateIso,
        snapshot,
        normalizedPath,
        screenedPath: existingScreened!,
        inputWorkbookHash,
        preferencesHash,
        companyPreferenceSnapshotHash,
        screeningPromptHash,
        inputRows: normalized.rows,
        outputRows: guarded.outputRows,
        counts: guarded.counts,
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
  log(logger, `[AI SCREENING] Uploading ${RUN_NORMALIZED_FILE}`);

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
    return {
      status: "pending",
      aiScreeningComplete: false,
      normalizedPath,
      screenedPath: null,
      inputRows: normalized.combinedUnique,
      outputRows: 0,
      counts: emptyStatusCounts(),
      tender247DetailIds: [],
      bidAssistDetailIds: [],
      noBidRows: [],
      error: "SCREENING_PENDING: no ChatGPT screening client",
    };
  }

  try {
    await client.screenWorkbook({
      inputWorkbookPath: normalizedPath,
      prompt,
      outputPath: screenedPath,
      runDate: dateIso,
    });
    const validated = validateScreenedWorkbook({
      inputRows: normalized.rows,
      outputPath: screenedPath,
    });
    const guarded = applyDeterministicPhase1Guard({
      inputRows: normalized.rows,
      outputRows: validated.outputRows,
      snapshot,
      runDate: dateIso,
      screenedPath,
      logger,
    });
    log(logger, `SCREENING_INPUT_ROWS=${normalized.combinedUnique}`);
    log(logger, `SCREENING_OUTPUT_ROWS=${guarded.outputRows.length}`);
    log(logger, "SCREENING_ROW_RECONCILIATION=PASS");
    log(logger, "[AI SCREENING] Reconciliation = PASS");
    log(logger, "[AI SCREENING] Workbook validation=PASS");
    log(logger, "CHATGPT_SCREENING_OUTPUT_VALID=true");
    log(logger, `[AI SCREENING] NO_BID = ${guarded.counts.NO_GO}`);
    log(logger, `[AI SCREENING] VERIFY = ${guarded.counts.VERIFY}`);
    log(logger, `[AI SCREENING] MAY_BID = ${guarded.counts.CONDITIONAL_GO}`);
    log(logger, `[AI SCREENING] WILL_BID = ${guarded.counts.GO}`);

    return await finalizeScreening({
      dateFolder,
      dateIso,
      snapshot,
      normalizedPath,
      screenedPath,
      inputWorkbookHash,
      preferencesHash,
      companyPreferenceSnapshotHash,
      screeningPromptHash,
      inputRows: normalized.rows,
      outputRows: guarded.outputRows,
      counts: guarded.counts,
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
      inputWorkbook: normalizedPath,
      inputWorkbookHash,
      preferencesHash,
      companyPreferenceSnapshotHash,
      screeningPolicyVersion: PHASE1_SCREENING_POLICY_VERSION,
      screeningPromptHash,
      screenedWorkbook: fs.existsSync(screenedPath) ? screenedPath : null,
      screenedWorkbookHash: fs.existsSync(screenedPath) ? hashFile(screenedPath) : null,
      inputRows: normalized.combinedUnique,
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
  normalizedPath: string;
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
    // GPT screened workbook is the DB source of truth (not run-normalized.xlsx).
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
    inputWorkbook: options.normalizedPath,
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
    normalizedPath: options.normalizedPath,
    screenedPath: options.screenedPath,
    inputRows: options.inputRows.length,
    outputRows: options.outputRows.length,
    counts: options.counts,
    tender247DetailIds: shortlist.tender247Ids,
    bidAssistDetailIds: shortlist.bidAssistIds,
    noBidRows,
  };
}
