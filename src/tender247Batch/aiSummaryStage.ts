/**
 * AI Summary acquisition stage. Explicit terminal failure is non-blocking
 * for Tender247 sequential advance once metadata + documents are valid.
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, loadEvidenceState } from "./tender247EvidenceState.js";

export const AI_SUMMARY_STATE_FILE = "ai-summary-state.json";

export type AiSummaryStage =
  | "NOT_STARTED"
  | "DOWNLOADING"
  | "WAITING"
  | "SAVING"
  | "VERIFYING"
  | "COMPLETE"
  | "FAILED"
  | "UNAVAILABLE"
  | "NOT_FOUND";

export const AI_SUMMARY_IN_PROGRESS_STAGES = new Set<AiSummaryStage>([
  "DOWNLOADING",
  "WAITING",
  "SAVING",
  "VERIFYING",
]);

export const AI_SUMMARY_TERMINAL_FAILURE_STAGES = new Set<AiSummaryStage>([
  "FAILED",
  "UNAVAILABLE",
  "NOT_FOUND",
]);

export type AiSummaryPersistedState = {
  t247Id: string;
  aiStage: AiSummaryStage;
  aiSummaryAvailable: boolean;
  aiSummaryStatus: "FAILED" | "UNAVAILABLE" | "NOT_FOUND" | "COMPLETE" | "IN_PROGRESS" | "NOT_STARTED";
  recoveryPending: boolean;
  updatedAt: string;
};

export function normalizeAiSummaryStage(value: unknown): AiSummaryStage {
  const key = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  switch (key) {
    case "DOWNLOADING":
    case "WAITING":
    case "SAVING":
    case "VERIFYING":
    case "COMPLETE":
    case "FAILED":
    case "UNAVAILABLE":
    case "NOT_FOUND":
    case "NOT_STARTED":
      return key;
    case "SUCCESS":
    case "AVAILABLE":
      return "COMPLETE";
    case "MISSING":
    case "NONE":
      return "NOT_FOUND";
    case "PROCESSING":
    case "IN_PROGRESS":
      return "DOWNLOADING";
    default:
      return "NOT_STARTED";
  }
}

export function isAiSummaryInProgress(stage: AiSummaryStage): boolean {
  return AI_SUMMARY_IN_PROGRESS_STAGES.has(stage);
}

export function isAiSummaryTerminalFailure(stage: AiSummaryStage): boolean {
  return AI_SUMMARY_TERMINAL_FAILURE_STAGES.has(stage);
}

export function isAiSummaryTerminal(
  stage: AiSummaryStage,
  aiSummaryValid: boolean,
): boolean {
  return aiSummaryValid || isAiSummaryTerminalFailure(stage);
}

/** Missing AI may be skipped only after an explicit terminal failure. */
export function shouldSkipAiSummaryRetry(
  aiSummaryValid: boolean,
  stage: AiSummaryStage,
): boolean {
  return aiSummaryValid || isAiSummaryTerminalFailure(stage);
}

export function mapCaptureStatusToAiStage(
  status: string | null | undefined,
): AiSummaryStage {
  const key = String(status ?? "").toLowerCase();
  if (key === "complete" || key === "success") return "COMPLETE";
  if (key === "unavailable") return "UNAVAILABLE";
  if (key === "not_found" || key === "missing") return "NOT_FOUND";
  if (key === "failed" || key === "failure") return "FAILED";
  if (
    key === "downloading" ||
    key === "waiting" ||
    key === "saving" ||
    key === "verifying" ||
    key === "processing"
  ) {
    return normalizeAiSummaryStage(key);
  }
  return "NOT_STARTED";
}

export function persistedStatusForStage(
  stage: AiSummaryStage,
  aiSummaryValid: boolean,
): AiSummaryPersistedState["aiSummaryStatus"] {
  if (aiSummaryValid || stage === "COMPLETE") return "COMPLETE";
  if (stage === "FAILED") return "FAILED";
  if (stage === "UNAVAILABLE") return "UNAVAILABLE";
  if (stage === "NOT_FOUND") return "NOT_FOUND";
  if (isAiSummaryInProgress(stage)) return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function saveAiSummaryStage(options: {
  tenderDir: string;
  t247Id: string;
  aiStage: AiSummaryStage;
  aiSummaryValid?: boolean;
}): AiSummaryPersistedState {
  const aiSummaryValid = options.aiSummaryValid === true;
  const recoveryPending =
    !aiSummaryValid && isAiSummaryTerminalFailure(options.aiStage);
  const state: AiSummaryPersistedState = {
    t247Id: options.t247Id,
    aiStage: aiSummaryValid ? "COMPLETE" : options.aiStage,
    aiSummaryAvailable: aiSummaryValid,
    aiSummaryStatus: persistedStatusForStage(options.aiStage, aiSummaryValid),
    recoveryPending,
    updatedAt: new Date().toISOString(),
  };
  if (fs.existsSync(options.tenderDir)) {
    writeJsonAtomic(path.join(options.tenderDir, AI_SUMMARY_STATE_FILE), state);
  }
  return state;
}

export function loadAiSummaryStage(
  tenderDir: string,
): AiSummaryPersistedState | null {
  const filePath = path.join(tenderDir, AI_SUMMARY_STATE_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AiSummaryPersistedState>;
    return {
      t247Id: String(parsed.t247Id || ""),
      aiStage: normalizeAiSummaryStage(parsed.aiStage),
      aiSummaryAvailable: parsed.aiSummaryAvailable === true,
      aiSummaryStatus: parsed.aiSummaryStatus || "NOT_STARTED",
      recoveryPending: parsed.recoveryPending === true,
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return null;
  }
}

export function resolveAiSummaryStage(options: {
  tenderDir: string;
  aiSummaryValid: boolean;
  explicitStage?: AiSummaryStage | string | null;
}): AiSummaryStage {
  if (options.aiSummaryValid) return "COMPLETE";
  if (options.explicitStage) {
    return normalizeAiSummaryStage(options.explicitStage);
  }
  const saved = loadAiSummaryStage(options.tenderDir);
  if (saved) return saved.aiStage;
  const evidence = loadEvidenceState(options.tenderDir);
  if (evidence?.aiSummary?.attempted && !evidence.aiSummary.available) {
    if (evidence.aiSummary.status === "unavailable") return "UNAVAILABLE";
    if (evidence.aiSummary.status === "processing") return "DOWNLOADING";
    return "FAILED";
  }
  return "NOT_STARTED";
}
