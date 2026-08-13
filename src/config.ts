import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveProjectPath } from "./fileUtils.js";

loadDotenv({ path: resolveProjectPath(".env"), quiet: true });

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export interface AppConfig {
  headless: boolean;
  tender247Enabled: boolean;
  bidAssistEnabled: boolean;
  tender247Url: string;
  downloadRoot: string;
  logRoot: string;
  screenshotRoot: string;
  downloadTimeoutMs: number;
  pageTimeoutMs: number;
  maxRetries: number;
  authDir: string;
  tender247AuthPath: string;
  tender247SessionPath: string;
  lockFilePath: string;
  crawlLockFilePath: string;
  projectRoot: string;
  /** Concurrent tender detail pages */
  tenderDetailConcurrency: number;
  /** Retries per tender after the first attempt */
  tenderDetailMaxRetries: number;
  /** 0 = no limit */
  maxTenders: number;
  /** Also click Download All after individual docs */
  downloadAllDocumentsToo: boolean;
  /** Daily batch: keep unzipped tender folders after ZIP */
  keepUnzippedTenderFolders: boolean;
  /** Daily batch: include raw API / debug artifacts in tender ZIP */
  keepDebugFiles: boolean;
  /** Daily batch concurrency (use 1) */
  tenderBatchConcurrency: number;
  /** Delay between tenders in ms */
  tenderDelayMs: number;
  /** Retries per document download */
  documentDownloadMaxRetries: number;
  /** Create master ZIP of all tender ZIPs */
  createDailyMasterZip: boolean;
  /** Hard timeout per tender in the daily batch (ms) */
  perTenderTimeoutMs: number;
  /** Phase 1 ChatGPT qualification (no database) */
  chatgptQualificationEnabled: boolean;
  chatgptHeadless: boolean;
  chatgptUrl: string;
  chatgptProjectName: string;
  chatgptProjectUrl: string | null;
  chatgptProjectMatch: string;
  /** @deprecated alias — use chatgptStorageState */
  chatgptAuthPath: string;
  chatgptStorageState: string;
  chatgptAuthProfile: string;
  chatgptManualLoginTimeoutMs: number;
  siyanaMasterPdf: string;
  /** 0 = all ready tenders; >0 = limit for testing */
  maxGptTenders: number;
  /** Max wait for ChatGPT answer after prompt submit (default 20 min) */
  chatgptResponseTimeoutMs: number;
  /** Max wait budget for upload chips / settle (separate from response) */
  chatgptUploadTimeoutMs: number;
  /** Explicit single-tender test (numeric ID only); null when absent/invalid */
  chatgptTestTenderId: string | null;
  /** Process ready tenders even when ready < expected */
  chatgptProcessReadyOnly: boolean;
  /** Continue to next tender after per-tender failure */
  chatgptContinueOnError: boolean;
  /** Max files per tender upload (2 = AI_Summary + AllDocs ZIP; 0 = all, batched by 10) */
  chatgptUploadMaxFiles: number;
  /** Keep headed browser open after failure for manual inspection */
  chatgptKeepBrowserOpenOnFailure: boolean;
  /** Minimum ms between qualification prompt submissions (default 10 min) */
  chatgptMinSubmissionIntervalMs: number;
  /** Minimum cooldown after a tender finishes before starting the next (default 3 min) */
  chatgptInterTenderDelayMs: number;
  /** Random jitter added to the next-tender wait */
  chatgptInterTenderJitterMs: number;
  /** Initial rate-limit backoff (default 5 min) */
  chatgptRateLimitInitialBackoffMs: number;
  /** Max rate-limit backoff (default 30 min) */
  chatgptRateLimitMaxBackoffMs: number;
  /** Max rate-limit recovery retries per tender/batch pause */
  chatgptRateLimitMaxRetries: number;
  /** Settle delay between Tender247 crawl and ChatGPT qualification */
  dailyPipelinePhaseDelayMs: number;
  /** Master lock for npm run daily:tender-pipeline */
  dailyPipelineLockFilePath: string;
}

export function loadConfig(): AppConfig {
  const projectRoot = process.cwd();
  const authDir = resolveProjectPath("auth");

  return {
    headless: parseBool(process.env.HEADLESS, false),
    tender247Enabled: parseBool(process.env.TENDER247_ENABLED, true),
    bidAssistEnabled: parseBool(process.env.BIDASSIST_ENABLED, false),
    tender247Url:
      process.env.TENDER247_URL?.trim() ||
      "https://www.tender247.com/auth/tender",
    downloadRoot: process.env.DOWNLOAD_ROOT?.trim() || "./downloads",
    logRoot: process.env.LOG_ROOT?.trim() || "./logs",
    screenshotRoot: process.env.SCREENSHOT_ROOT?.trim() || "./screenshots",
    downloadTimeoutMs: parseIntEnv(process.env.DOWNLOAD_TIMEOUT_MS, 120_000),
    pageTimeoutMs: parseIntEnv(process.env.PAGE_TIMEOUT_MS, 90_000),
    maxRetries: parseIntEnv(process.env.MAX_RETRIES, 2),
    authDir,
    tender247AuthPath: path.join(authDir, "tender247.json"),
    tender247SessionPath: path.join(authDir, "tender247-session.json"),
    lockFilePath: resolveProjectPath("automation.lock"),
    crawlLockFilePath: resolveProjectPath("crawl.lock"),
    projectRoot,
    tenderDetailConcurrency: Math.max(
      1,
      parseIntEnv(process.env.TENDER_DETAIL_CONCURRENCY, 2),
    ),
    tenderDetailMaxRetries: Math.max(
      0,
      parseIntEnv(process.env.TENDER_DETAIL_MAX_RETRIES, 2),
    ),
    maxTenders: Math.max(0, parseIntEnv(process.env.MAX_TENDERS, 0)),
    downloadAllDocumentsToo: parseBool(
      process.env.DOWNLOAD_ALL_DOCUMENTS_TOO,
      false,
    ),
    keepUnzippedTenderFolders: parseBool(
      process.env.KEEP_UNZIPPED_TENDER_FOLDERS,
      false,
    ),
    keepDebugFiles: parseBool(process.env.KEEP_DEBUG_FILES, false),
    tenderBatchConcurrency: Math.max(
      1,
      parseIntEnv(process.env.TENDER_BATCH_CONCURRENCY, 1),
    ),
    tenderDelayMs: Math.max(0, parseIntEnv(process.env.TENDER_DELAY_MS, 1000)),
    documentDownloadMaxRetries: Math.max(
      0,
      parseIntEnv(process.env.DOCUMENT_DOWNLOAD_MAX_RETRIES, 2),
    ),
    createDailyMasterZip: parseBool(
      process.env.CREATE_DAILY_MASTER_ZIP,
      false,
    ),
    perTenderTimeoutMs: Math.max(
      60_000,
      parseIntEnv(process.env.PER_TENDER_TIMEOUT_MS, 240_000),
    ),
    chatgptQualificationEnabled: parseBool(
      process.env.CHATGPT_QUALIFICATION_ENABLED,
      false,
    ),
    // First login / auth always uses visible browser; keep env for later options
    chatgptHeadless: parseBool(process.env.CHATGPT_HEADLESS, false),
    chatgptUrl: process.env.CHATGPT_URL?.trim() || "https://chatgpt.com/",
    chatgptProjectName:
      process.env.CHATGPT_PROJECT_NAME?.trim() ||
      "Siyana Tender Qualification Automation",
    chatgptProjectUrl: process.env.CHATGPT_PROJECT_URL?.trim() || null,
    chatgptProjectMatch:
      process.env.CHATGPT_PROJECT_MATCH?.trim() || "Siyana Tender Quali",
    chatgptStorageState: (() => {
      const raw =
        process.env.CHATGPT_STORAGE_STATE?.trim() ||
        path.join("auth", "chatgpt.json");
      return resolveProjectPath(raw);
    })(),
    chatgptAuthPath: (() => {
      const raw =
        process.env.CHATGPT_STORAGE_STATE?.trim() ||
        path.join("auth", "chatgpt.json");
      return resolveProjectPath(raw);
    })(),
    chatgptAuthProfile: (() => {
      const raw =
        process.env.CHATGPT_AUTH_PROFILE?.trim() ||
        path.join("auth", "chatgpt-profile");
      return resolveProjectPath(raw);
    })(),
    chatgptManualLoginTimeoutMs: Math.max(
      60_000,
      parseIntEnv(process.env.CHATGPT_MANUAL_LOGIN_TIMEOUT_MS, 600_000),
    ),
    siyanaMasterPdf:
      process.env.SIYANA_MASTER_PDF?.trim() ||
      "./Consolidated Siyana Docs PDF.pdf",
    maxGptTenders: Math.max(0, parseIntEnv(process.env.MAX_GPT_TENDERS, 0)),
    chatgptResponseTimeoutMs: Math.max(
      60_000,
      parseIntEnv(process.env.CHATGPT_RESPONSE_TIMEOUT_MS, 1_200_000),
    ),
    chatgptUploadTimeoutMs: Math.max(
      30_000,
      parseIntEnv(process.env.CHATGPT_UPLOAD_TIMEOUT_MS, 300_000),
    ),
    chatgptTestTenderId: parseChatGptTestTenderId(
      process.env.CHATGPT_TEST_TENDER_ID,
    ),
    chatgptProcessReadyOnly: parseBool(
      process.env.CHATGPT_PROCESS_READY_ONLY,
      true,
    ),
    chatgptContinueOnError: parseBool(
      process.env.CHATGPT_CONTINUE_ON_ERROR,
      true,
    ),
    chatgptUploadMaxFiles: Math.max(
      0,
      parseIntEnv(process.env.CHATGPT_UPLOAD_MAX_FILES, 3),
    ),
    chatgptKeepBrowserOpenOnFailure: parseBool(
      process.env.CHATGPT_KEEP_BROWSER_OPEN_ON_FAILURE,
      false,
    ),
    chatgptMinSubmissionIntervalMs: Math.max(
      0,
      parseIntEnv(process.env.CHATGPT_MIN_SUBMISSION_INTERVAL_MS, 300_000),
    ),
    chatgptInterTenderDelayMs: Math.max(
      0,
      parseIntEnv(process.env.CHATGPT_INTER_TENDER_DELAY_MS, 0),
    ),
    chatgptInterTenderJitterMs: Math.max(
      0,
      parseIntEnv(process.env.CHATGPT_INTER_TENDER_JITTER_MS, 0),
    ),
    chatgptRateLimitInitialBackoffMs: Math.max(
      30_000,
      parseIntEnv(process.env.CHATGPT_RATE_LIMIT_INITIAL_BACKOFF_MS, 600_000),
    ),
    chatgptRateLimitMaxBackoffMs: Math.max(
      60_000,
      parseIntEnv(process.env.CHATGPT_RATE_LIMIT_MAX_BACKOFF_MS, 1_800_000),
    ),
    chatgptRateLimitMaxRetries: Math.max(
      1,
      parseIntEnv(process.env.CHATGPT_RATE_LIMIT_MAX_RETRIES, 3),
    ),
    dailyPipelinePhaseDelayMs: Math.max(
      0,
      parseIntEnv(process.env.DAILY_PIPELINE_PHASE_DELAY_MS, 60_000),
    ),
    dailyPipelineLockFilePath: resolveProjectPath(
      process.env.DAILY_PIPELINE_LOCK_FILE?.trim() || "daily-pipeline.lock",
    ),
  };
}

/** Accept only numeric T247 IDs; reject stale/non-numeric overrides. */
function parseChatGptTestTenderId(
  raw: string | undefined,
): string | null {
  const value = raw?.trim().replace(/^T247-/i, "") || "";
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return value;
}

export function resolveChatGptAuthPath(config: AppConfig): string | undefined {
  if (fs.existsSync(config.chatgptAuthPath)) {
    return config.chatgptAuthPath;
  }
  return undefined;
}

/** Prefer tender247.json, fall back to tender247-session.json. */
export function resolveTender247AuthPath(config: AppConfig): string | undefined {
  if (fs.existsSync(config.tender247AuthPath)) {
    return config.tender247AuthPath;
  }
  if (fs.existsSync(config.tender247SessionPath)) {
    return config.tender247SessionPath;
  }
  return undefined;
}
