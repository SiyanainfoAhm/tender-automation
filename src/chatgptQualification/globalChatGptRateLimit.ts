/**
 * Account-level ChatGPT rate-limit / "Too many requests" coordinator.
 * Shared across all GPT workers in one process — pauses uploads + Send.
 */
import type { Logger } from "../logger.js";

export type GlobalChatGptRateLimitState = {
  limited: boolean;
  untilMs: number;
  backoffMs: number;
  strikeCount: number;
  lastDetectedAtMs: number | null;
};

type Clock = { now: () => number };

const realClock: Clock = { now: () => Date.now() };

let clock: Clock = realClock;
let state: GlobalChatGptRateLimitState = {
  limited: false,
  untilMs: 0,
  backoffMs: 0,
  strikeCount: 0,
  lastDetectedAtMs: null,
};
let workersPausedLogged = false;

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

function warn(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.warn(message);
}

function initialBackoffMs(): number {
  const n = Number.parseInt(
    process.env.CHATGPT_RATE_LIMIT_INITIAL_BACKOFF_MS || "600000",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

function maxBackoffMs(): number {
  const n = Number.parseInt(
    process.env.CHATGPT_RATE_LIMIT_MAX_BACKOFF_MS || "1800000",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 1_800_000;
}

export function resetGlobalChatGptRateLimitForTests(options?: {
  clock?: Clock;
}): void {
  clock = options?.clock ?? realClock;
  state = {
    limited: false,
    untilMs: 0,
    backoffMs: 0,
    strikeCount: 0,
    lastDetectedAtMs: null,
  };
  workersPausedLogged = false;
}

export function getGlobalChatGptRateLimitState(): GlobalChatGptRateLimitState {
  refreshClearedIfDue();
  return { ...state };
}

export function isGlobalChatGptRateLimited(): boolean {
  refreshClearedIfDue();
  return state.limited && clock.now() < state.untilMs;
}

export function getGlobalRateLimitRemainingMs(): number {
  refreshClearedIfDue();
  if (!state.limited) return 0;
  return Math.max(0, state.untilMs - clock.now());
}

function refreshClearedIfDue(logger?: Logger): void {
  if (!state.limited) return;
  if (clock.now() < state.untilMs) return;
  state.limited = false;
  state.untilMs = 0;
  workersPausedLogged = false;
  log(logger, "CHATGPT_GLOBAL_RATE_LIMIT_CLEARED=true");
  log(logger, "CHATGPT_GPT_WORKERS_RESUMED=true");
}

/**
 * Trip account-level rate limit. Idempotent while already limited
 * (extends until if new backoff is longer).
 */
export function tripGlobalChatGptRateLimit(options?: {
  logger?: Logger;
  backoffMs?: number;
  reason?: string;
}): GlobalChatGptRateLimitState {
  const logger = options?.logger;
  state.strikeCount += 1;
  state.lastDetectedAtMs = clock.now();

  const base = options?.backoffMs ?? initialBackoffMs();
  // Progressive: initial * 2^(strike-1), capped at max
  const progressive = Math.min(
    maxBackoffMs(),
    base * Math.pow(2, Math.max(0, state.strikeCount - 1)),
  );
  const backoffMs = Math.min(
    maxBackoffMs(),
    Math.max(base, progressive, options?.backoffMs ?? 0),
  );
  const untilMs = clock.now() + backoffMs;

  state.limited = true;
  state.backoffMs = backoffMs;
  state.untilMs = Math.max(state.untilMs, untilMs);

  warn(logger, "CHATGPT_TOO_MANY_REQUESTS_DETECTED=true");
  warn(logger, "CHATGPT_GLOBAL_RATE_LIMITED=true");
  warn(
    logger,
    `CHATGPT_GLOBAL_RATE_LIMIT_UNTIL=${new Date(state.untilMs).toISOString()}`,
  );
  warn(logger, `CHATGPT_RATE_LIMIT_BACKOFF_MS=${backoffMs}`);
  if (!workersPausedLogged) {
    warn(logger, "CHATGPT_GPT_WORKERS_PAUSED=true");
    workersPausedLogged = true;
  }
  if (options?.reason) {
    warn(logger, `CHATGPT_RATE_LIMIT_REASON=${options.reason}`);
  }

  return getGlobalChatGptRateLimitState();
}

/** Block until global rate-limit window clears (safe to call from workers). */
export async function waitWhileGlobalChatGptRateLimited(options?: {
  logger?: Logger;
  workerId?: number;
  pollMs?: number;
  /** Abort if true (batch cancelled). */
  shouldAbort?: () => boolean;
}): Promise<void> {
  const logger = options?.logger;
  const pollMs = options?.pollMs ?? 5_000;
  while (isGlobalChatGptRateLimited()) {
    if (options?.shouldAbort?.()) return;
    const remaining = getGlobalRateLimitRemainingMs();
    if (options?.workerId != null) {
      log(
        logger,
        `CHATGPT_WORKER_ID=${options.workerId} CHATGPT_WAITING_GLOBAL_RATE_LIMIT_MS=${remaining}`,
      );
    } else {
      log(logger, `CHATGPT_WAITING_GLOBAL_RATE_LIMIT_MS=${remaining}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining || pollMs)));
    refreshClearedIfDue(logger);
  }
}

/** Rolling account-level upload attempt counter (not per-worker). */
let uploadAttemptsTotal = 0;
const uploadAttemptTimestamps: number[] = [];

export function recordGlobalUploadAttempt(count = 1): number {
  const n = Math.max(1, count);
  uploadAttemptsTotal += n;
  const now = clock.now();
  for (let i = 0; i < n; i += 1) {
    uploadAttemptTimestamps.push(now);
  }
  // Keep last hour
  const cutoff = now - 3_600_000;
  while (
    uploadAttemptTimestamps.length &&
    uploadAttemptTimestamps[0]! < cutoff
  ) {
    uploadAttemptTimestamps.shift();
  }
  console.log(`CHATGPT_GLOBAL_UPLOAD_ATTEMPTS_TOTAL=${uploadAttemptsTotal}`);
  console.log(
    `CHATGPT_GLOBAL_UPLOAD_ATTEMPTS_LAST_HOUR=${uploadAttemptTimestamps.length}`,
  );
  return uploadAttemptsTotal;
}

export function getGlobalUploadAttemptsTotal(): number {
  return uploadAttemptsTotal;
}

export function resetGlobalUploadAccountingForTests(): void {
  uploadAttemptsTotal = 0;
  uploadAttemptTimestamps.length = 0;
}
