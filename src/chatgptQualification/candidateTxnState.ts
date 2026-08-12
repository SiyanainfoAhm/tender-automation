/**
 * ChatGPT candidate transaction stage machine.
 * Prevents re-paste / re-upload after FILES_LOCKED / PROMPT_READY / SUBMITTED.
 */
export type ChatGptCandidateStage =
  | "PREPARING"
  | "FILES_UPLOADING"
  | "FILES_READY"
  | "FILES_LOCKED"
  | "PROMPT_ENTERING"
  | "PROMPT_READY"
  | "WAITING_FOR_SEND_SLOT"
  | "SUBMITTING"
  | "SUBMITTED"
  | "WAITING_RESPONSE"
  | "RESPONSE_ACTIVE"
  | "RESPONSE_COMPLETE"
  | "RESPONSE_STALLED"
  | "PARSED"
  | "PERSISTED"
  | "DONE"
  | "FAILED"
  | "RETRY_PENDING"
  | "FAILED_FINAL"
  | "RATE_LIMITED";

const STAGE_ORDER: ChatGptCandidateStage[] = [
  "PREPARING",
  "FILES_UPLOADING",
  "FILES_READY",
  "FILES_LOCKED",
  "PROMPT_ENTERING",
  "PROMPT_READY",
  "WAITING_FOR_SEND_SLOT",
  "SUBMITTING",
  "SUBMITTED",
  "WAITING_RESPONSE",
  "RESPONSE_ACTIVE",
  "RESPONSE_COMPLETE",
  "PARSED",
  "PERSISTED",
  "DONE",
];

export function stageIndex(stage: ChatGptCandidateStage): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : -1;
}

export function stageAtLeast(
  current: ChatGptCandidateStage,
  minimum: ChatGptCandidateStage,
): boolean {
  return stageIndex(current) >= stageIndex(minimum);
}

export type ChatGptCandidateTxnState = {
  stage: ChatGptCandidateStage;
  promptEntryCount: number;
  uploadAttemptCount: number;
  sendAttemptCount: number;
  filesLocked: boolean;
  promptReady: boolean;
  submitted: boolean;
  conversationUrl: string | null;
  lastProgressAtMs: number;
  attempt: number;
  failureReason: string | null;
  failureStage: ChatGptCandidateStage | null;
};

export function createCandidateTxnState(
  attempt = 1,
): ChatGptCandidateTxnState {
  return {
    stage: "PREPARING",
    promptEntryCount: 0,
    uploadAttemptCount: 0,
    sendAttemptCount: 0,
    filesLocked: false,
    promptReady: false,
    submitted: false,
    conversationUrl: null,
    lastProgressAtMs: Date.now(),
    attempt,
    failureReason: null,
    failureStage: null,
  };
}

export function advanceCandidateStage(
  state: ChatGptCandidateTxnState,
  next: ChatGptCandidateStage,
): ChatGptCandidateTxnState {
  // Never move backwards past SUBMITTED within the same attempt.
  if (
    stageAtLeast(state.stage, "SUBMITTED") &&
    stageIndex(next) >= 0 &&
    stageIndex(next) < stageIndex("SUBMITTED")
  ) {
    return state;
  }
  return {
    ...state,
    stage: next,
    lastProgressAtMs: Date.now(),
    filesLocked:
      state.filesLocked ||
      next === "FILES_LOCKED" ||
      stageAtLeast(next, "FILES_LOCKED"),
    promptReady:
      state.promptReady ||
      next === "PROMPT_READY" ||
      stageAtLeast(next, "PROMPT_READY"),
    submitted:
      state.submitted ||
      next === "SUBMITTED" ||
      stageAtLeast(next, "SUBMITTED"),
  };
}

/** True when prompt must NOT be pasted again. */
export function shouldSkipPromptPaste(state: ChatGptCandidateTxnState): boolean {
  return state.promptReady || stageAtLeast(state.stage, "PROMPT_READY");
}

/** True when Send must NOT be clicked again. */
export function shouldSkipSend(state: ChatGptCandidateTxnState): boolean {
  return state.submitted || stageAtLeast(state.stage, "SUBMITTED");
}

/** True when uploads must NOT restart within this attempt. */
export function shouldSkipUpload(state: ChatGptCandidateTxnState): boolean {
  return state.filesLocked || stageAtLeast(state.stage, "FILES_LOCKED");
}

export function getMaxChatgptCandidateAttempts(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(env.MAX_CHATGPT_CANDIDATE_ATTEMPTS || "2", 10);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

export function getStageStallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(env.CHATGPT_STAGE_STALL_TIMEOUT_MS || "300000", 10);
  return Number.isFinite(n) && n >= 10_000 ? n : 300_000;
}

export function getResponseStallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(
    env.CHATGPT_RESPONSE_STALL_TIMEOUT_MS || "300000",
    10,
  );
  return Number.isFinite(n) && n >= 10_000 ? n : 300_000;
}

export function isPreSubmissionStall(
  state: ChatGptCandidateTxnState,
  nowMs = Date.now(),
  stallMs = getStageStallTimeoutMs(),
): boolean {
  if (stageAtLeast(state.stage, "SUBMITTED")) return false;
  const preStages: ChatGptCandidateStage[] = [
    "FILES_UPLOADING",
    "PROMPT_ENTERING",
    "SUBMITTING",
  ];
  if (!preStages.includes(state.stage)) return false;
  return nowMs - state.lastProgressAtMs >= stallMs;
}
