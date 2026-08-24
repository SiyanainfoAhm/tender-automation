/**
 * Global rolling-window safety scheduler for NEW detailed ChatGPT submissions.
 * Shared by full pipeline + DOCUMENT_TEXT_MODE across Tender247 accounts.
 *
 * Counts only confirmed new Sends — never reuses / extraction / DB writes.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";

export type DetailSubmissionLedgerEntry = {
  tenderId: string;
  submittedAt: string;
  mode: "TEXT_MODE" | "UPLOAD" | "TENDER_QUALIFICATION";
  runId?: string;
  correlationId?: string;
};

export type DetailSubmissionLedger = {
  submissions: DetailSubmissionLedgerEntry[];
};

export type DetailRateLimitConfig = {
  maxSubmissions: number;
  windowMs: number;
  safetyBufferMs: number;
};

export type DetailRateSlotDecision = {
  allowed: boolean;
  used: number;
  available: number;
  waitMs: number;
  nextSlotAt: string | null;
  oldestActiveAt: string | null;
};

const DEFAULT_MAX = 65;
const DEFAULT_WINDOW_MS = 3 * 60 * 60 * 1000;
const DEFAULT_BUFFER_MS = 60_000;

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

export function getDetailRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): DetailRateLimitConfig {
  const max = Number.parseInt(
    env.CHATGPT_DETAIL_MAX_SUBMISSIONS_PER_WINDOW || String(DEFAULT_MAX),
    10,
  );
  const windowMinutes = Number.parseInt(
    env.CHATGPT_DETAIL_SUBMISSION_WINDOW_MINUTES || "180",
    10,
  );
  const bufferSeconds = Number.parseInt(
    env.CHATGPT_DETAIL_RATE_SAFETY_BUFFER_SECONDS || "60",
    10,
  );
  return {
    maxSubmissions:
      Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX,
    windowMs:
      Number.isFinite(windowMinutes) && windowMinutes > 0
        ? windowMinutes * 60_000
        : DEFAULT_WINDOW_MS,
    safetyBufferMs:
      Number.isFinite(bufferSeconds) && bufferSeconds >= 0
        ? bufferSeconds * 1000
        : DEFAULT_BUFFER_MS,
  };
}

export function detailSubmissionLedgerPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const custom = env.CHATGPT_DETAIL_SUBMISSION_LEDGER_PATH?.trim();
  if (custom) return resolveProjectPath(custom);
  return resolveProjectPath("auth/chatgpt/detail-submission-ledger.json");
}

export function detailSubmissionLedgerLockPath(
  ledgerPath = detailSubmissionLedgerPath(),
): string {
  return `${ledgerPath}.lock`;
}

function readLedger(filePath: string): DetailSubmissionLedger {
  if (!fs.existsSync(filePath)) return { submissions: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      submissions?: DetailSubmissionLedgerEntry[];
    };
    return { submissions: Array.isArray(raw.submissions) ? raw.submissions : [] };
  } catch {
    return { submissions: [] };
  }
}

function writeLedger(filePath: string, ledger: DetailSubmissionLedger): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLedgerLock(
  lockPath: string,
  timeoutMs = 120_000,
): Promise<() => void> {
  ensureDir(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "EEXIST") throw error;
      try {
        const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
          pid?: number;
        };
        if (raw.pid && !isPidAlive(raw.pid)) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // ignore
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(
    `CHATGPT_DETAIL_RATE_LOCK_TIMEOUT lock=${lockPath}`,
  );
}

export function pruneActiveSubmissions(
  submissions: DetailSubmissionLedgerEntry[],
  nowMs: number,
  windowMs: number,
): DetailSubmissionLedgerEntry[] {
  const windowStart = nowMs - windowMs;
  return submissions
    .filter((row) => {
      const ts = Date.parse(row.submittedAt);
      return Number.isFinite(ts) && ts > windowStart;
    })
    .sort(
      (a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
    );
}

export function evaluateDetailRateSlot(options: {
  submissions: DetailSubmissionLedgerEntry[];
  nowMs?: number;
  config?: DetailRateLimitConfig;
}): DetailRateSlotDecision {
  const config = options.config ?? getDetailRateLimitConfig();
  const nowMs = options.nowMs ?? Date.now();
  const active = pruneActiveSubmissions(
    options.submissions,
    nowMs,
    config.windowMs,
  );
  const used = active.length;
  const available = Math.max(0, config.maxSubmissions - used);
  if (used < config.maxSubmissions) {
    return {
      allowed: true,
      used,
      available,
      waitMs: 0,
      nextSlotAt: null,
      oldestActiveAt: active[0]?.submittedAt ?? null,
    };
  }
  const oldest = active[0]!;
  const oldestMs = Date.parse(oldest.submittedAt);
  const nextMs = oldestMs + config.windowMs + config.safetyBufferMs;
  const waitMs = Math.max(0, nextMs - nowMs);
  return {
    allowed: false,
    used,
    available: 0,
    waitMs,
    nextSlotAt: new Date(nextMs).toISOString(),
    oldestActiveAt: oldest.submittedAt,
  };
}

export function appendDetailSubmission(
  ledger: DetailSubmissionLedger,
  entry: DetailSubmissionLedgerEntry,
  nowMs: number,
  windowMs: number,
): DetailSubmissionLedger {
  const submissions = pruneActiveSubmissions(
    [...ledger.submissions, entry],
    nowMs,
    windowMs,
  );
  return { submissions };
}

/**
 * Wait until a rolling-window slot is free, then return.
 * Does NOT register a submission — call recordDetailSubmission after confirmed Send.
 *
 * onWaitRequired fires when a wait is needed (outside the lock). Use it to
 * release ChatGPT browser resources for long waits.
 */
export async function awaitDetailChatGptSubmissionSlot(options?: {
  logger?: Logger;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  ledgerPath?: string;
  config?: DetailRateLimitConfig;
  /** Called when wait is required; return true if resources were released for wait. */
  onWaitRequired?: (decision: DetailRateSlotDecision) => Promise<void> | void;
  /** Prefer closing browser when wait exceeds this (default 120s). */
  longWaitMs?: number;
}): Promise<DetailRateSlotDecision> {
  const logger = options?.logger;
  const clock = options?.clock ?? {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  };
  const config = options?.config ?? getDetailRateLimitConfig();
  const ledgerPath = options?.ledgerPath ?? detailSubmissionLedgerPath();
  const lockPath = detailSubmissionLedgerLockPath(ledgerPath);
  const longWaitMs = options?.longWaitMs ?? 120_000;
  let notifiedLongWait = false;

  log(logger, `CHATGPT_DETAIL_RATE_LIMIT_MAX=${config.maxSubmissions}`);
  log(logger, `CHATGPT_DETAIL_RATE_WINDOW_MS=${config.windowMs}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const release = await acquireLedgerLock(lockPath);
    let decision: DetailRateSlotDecision;
    try {
      const ledger = readLedger(ledgerPath);
      const pruned = {
        submissions: pruneActiveSubmissions(
          ledger.submissions,
          clock.now(),
          config.windowMs,
        ),
      };
      if (pruned.submissions.length !== ledger.submissions.length) {
        writeLedger(ledgerPath, pruned);
      }
      decision = evaluateDetailRateSlot({
        submissions: pruned.submissions,
        nowMs: clock.now(),
        config,
      });
      log(logger, `CHATGPT_DETAIL_RATE_USED=${decision.used}`);
      log(
        logger,
        `CHATGPT_DETAIL_RATE_AVAILABLE=${decision.available}`,
      );
      if (decision.allowed) {
        log(logger, "CHATGPT_DETAIL_RATE_SLOT_AVAILABLE=true");
        return decision;
      }
      log(logger, "CHATGPT_DETAIL_RATE_WAIT_REQUIRED=true");
      log(logger, "WAITING_FOR_CHATGPT_RATE_SLOT=true");
      log(
        logger,
        `CHATGPT_DETAIL_RATE_OLDEST_ACTIVE=${decision.oldestActiveAt}`,
      );
      log(
        logger,
        `CHATGPT_DETAIL_RATE_NEXT_SLOT_AT=${decision.nextSlotAt}`,
      );
      log(logger, `CHATGPT_DETAIL_RATE_WAIT_MS=${decision.waitMs}`);
      log(
        logger,
        `[ChatGPT Qualification] ${decision.used}/${config.maxSubmissions} internal 3-hour safety slots currently used. Next tender will resume automatically at ${decision.nextSlotAt}.`,
      );
    } finally {
      release();
    }

    if (
      !notifiedLongWait &&
      decision!.waitMs >= longWaitMs &&
      options?.onWaitRequired
    ) {
      notifiedLongWait = true;
      log(logger, "CHATGPT_DETAIL_RATE_RELEASE_BROWSER_FOR_WAIT=true");
      await options.onWaitRequired(decision!);
    }

    // Sleep outside the lock so other processes can observe the same ledger.
    const sleepMs = Math.min(
      Math.max(1_000, decision!.waitMs),
      30_000,
    );
    await clock.sleep(sleepMs);
  }
}

/** Record a confirmed NEW detailed ChatGPT submission into the rolling ledger. */
export async function recordDetailSubmission(options: {
  tenderId: string;
  mode: DetailSubmissionLedgerEntry["mode"];
  runId?: string;
  correlationId?: string;
  submittedAt?: Date;
  logger?: Logger;
  ledgerPath?: string;
  config?: DetailRateLimitConfig;
}): Promise<DetailRateSlotDecision> {
  const config = options.config ?? getDetailRateLimitConfig();
  const ledgerPath = options.ledgerPath ?? detailSubmissionLedgerPath();
  const lockPath = detailSubmissionLedgerLockPath(ledgerPath);
  const release = await acquireLedgerLock(lockPath);
  try {
    const now = options.submittedAt ?? new Date();
    const nowMs = now.getTime();
    const ledger = readLedger(ledgerPath);
    const next = appendDetailSubmission(
      ledger,
      {
        tenderId: options.tenderId.replace(/^T247-/i, "").replace(/\D/g, ""),
        submittedAt: now.toISOString(),
        mode: options.mode,
        runId: options.runId,
        correlationId: options.correlationId,
      },
      nowMs,
      config.windowMs,
    );
    writeLedger(ledgerPath, next);
    const decision = evaluateDetailRateSlot({
      submissions: next.submissions,
      nowMs,
      config,
    });
    log(
      options.logger,
      `CHATGPT_DETAIL_RATE_RECORDED=true used=${decision.used} tender=${options.tenderId}`,
    );
    return decision;
  } finally {
    release();
  }
}

/** Snapshot for run summaries (no wait). */
export async function readDetailRateSnapshot(options?: {
  ledgerPath?: string;
  config?: DetailRateLimitConfig;
  nowMs?: number;
}): Promise<DetailRateSlotDecision> {
  const config = options?.config ?? getDetailRateLimitConfig();
  const ledgerPath = options?.ledgerPath ?? detailSubmissionLedgerPath();
  const lockPath = detailSubmissionLedgerLockPath(ledgerPath);
  const release = await acquireLedgerLock(lockPath);
  try {
    const ledger = readLedger(ledgerPath);
    return evaluateDetailRateSlot({
      submissions: ledger.submissions,
      nowMs: options?.nowMs ?? Date.now(),
      config,
    });
  } finally {
    release();
  }
}
