import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";
import type { Phase1ScreeningStatus } from "./phase1Statuses.js";
import { RUN_SCREENED_FILE } from "./runWorkbook.js";

export type RunScreeningStage =
  | "INGESTION_COMPLETE"
  | "DEDUPE_COMPLETE"
  | "AI_SCREENING_STARTED"
  | "AI_SCREENING_COMPLETE"
  | "AI_SCREENING_FAILED"
  | "SCREENING_PENDING"
  | "SHORTLIST_READY"
  | "DETAIL_CRAWL_STARTED"
  | "DETAIL_CRAWL_COMPLETE";

export type Phase1ScreeningManifest = {
  companyId: string;
  companyName: string;
  runDate: string;
  screeningRunId?: string | null;
  stage: RunScreeningStage;
  status: "complete" | "pending" | "failed";
  inputWorkbook: string;
  inputWorkbookHash: string;
  preferencesHash: string;
  companyPreferenceSnapshotHash?: string;
  screeningPolicyVersion?: string | null;
  screeningPromptHash: string;
  screenedWorkbook: string | null;
  screenedWorkbookHash: string | null;
  inputRows: number;
  outputRows: number;
  counts: Record<Phase1ScreeningStatus, number>;
  originalOutputFilename?: string | null;
  error?: string | null;
  conversationUrl?: string | null;
  expectedGeneratedFilename?: string | null;
  submittedAt?: string | null;
  updatedAt: string;
};

export type ScreeningIngestionCounts = {
  dailyRowsRaw: number;
  dailyRowsDeduped: number;
  tender247Raw: number;
  bidAssistRaw: number;
  updatedAt: string;
};

export type ScreeningChatCheckpoint = {
  conversationUrl: string;
  correlationId: string;
  expectedFilename: string | null;
  submittedAt: string;
  stage: string;
};

export type Phase1RunState = {
  stage: RunScreeningStage;
  aiScreeningComplete: boolean;
  shortlistReady: boolean;
  screeningRunId?: string | null;
  error?: string | null;
  updatedAt: string;
};

export function screeningDir(dateFolder: string): string {
  return path.join(dateFolder, "screening");
}

export function screenedWorkbookPath(dateFolder: string): string {
  return path.join(screeningDir(dateFolder), RUN_SCREENED_FILE);
}

export function resolveExistingScreenedWorkbook(dateFolder: string): string | null {
  const canonical = screenedWorkbookPath(dateFolder);
  const legacy = path.join(dateFolder, RUN_SCREENED_FILE);
  if (fs.existsSync(canonical) && fs.statSync(canonical).size > 0) return canonical;
  if (fs.existsSync(legacy) && fs.statSync(legacy).size > 0) return legacy;
  return null;
}

export function emptyStatusCounts(): Record<Phase1ScreeningStatus, number> {
  return { GO: 0, CONDITIONAL_GO: 0, PARTNER_BID: 0, VERIFY: 0, NO_GO: 0 };
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function loadScreeningManifest(
  dateFolder: string,
): Phase1ScreeningManifest | null {
  const filePath = path.join(screeningDir(dateFolder), "screening-manifest.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Phase1ScreeningManifest;
  } catch {
    return null;
  }
}

export function saveScreeningManifest(
  dateFolder: string,
  manifest: Phase1ScreeningManifest,
): string {
  const filePath = path.join(screeningDir(dateFolder), "screening-manifest.json");
  writeJson(filePath, manifest);
  return filePath;
}

export function saveRunState(dateFolder: string, state: Phase1RunState): string {
  const filePath = path.join(screeningDir(dateFolder), "run-state.json");
  writeJson(filePath, state);
  return filePath;
}

export function loadRunState(dateFolder: string): Phase1RunState | null {
  const filePath = path.join(screeningDir(dateFolder), "run-state.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Phase1RunState;
  } catch {
    return null;
  }
}

export function assertAiScreeningCompleteForDetailCrawl(dateFolder: string): void {
  const state = loadRunState(dateFolder);
  if (!state?.aiScreeningComplete || state.stage === "AI_SCREENING_FAILED") {
    throw new Error(
      "DETAIL_CRAWL_BLOCKED_SCREENING_NOT_COMPLETE: T247_DETAIL_CRAWL_BLOCKED=true: run-level AI screening not complete",
    );
  }
}

export function saveIngestionCounts(
  dateFolder: string,
  counts: ScreeningIngestionCounts,
): string {
  const filePath = path.join(screeningDir(dateFolder), "ingestion-counts.json");
  writeJson(filePath, counts);
  return filePath;
}

export function loadIngestionCounts(
  dateFolder: string,
): ScreeningIngestionCounts | null {
  const filePath = path.join(screeningDir(dateFolder), "ingestion-counts.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ScreeningIngestionCounts;
  } catch {
    return null;
  }
}

export function saveScreeningChatCheckpoint(
  screeningFolderOrOutputPath: string,
  checkpoint: ScreeningChatCheckpoint,
): string {
  const dir = screeningFolderOrOutputPath.toLowerCase().endsWith(".xlsx")
    ? path.dirname(screeningFolderOrOutputPath)
    : screeningFolderOrOutputPath;
  const filePath = path.join(dir, "chatgpt-screening-session.json");
  writeJson(filePath, checkpoint);
  return filePath;
}

export function loadScreeningChatCheckpoint(
  screeningFolderOrOutputPath: string,
): ScreeningChatCheckpoint | null {
  const dir = screeningFolderOrOutputPath.toLowerCase().endsWith(".xlsx")
    ? path.dirname(screeningFolderOrOutputPath)
    : screeningFolderOrOutputPath;
  const filePath = path.join(dir, "chatgpt-screening-session.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ScreeningChatCheckpoint;
  } catch {
    return null;
  }
}
