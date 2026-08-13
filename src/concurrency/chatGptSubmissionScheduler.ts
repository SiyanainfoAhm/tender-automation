/**
 * Shared ChatGPT Send-slot scheduler.
 *
 * ONE instance for the whole batch / process. Serializes Send across all workers
 * while allowing parallel upload / prompt / response / Supabase work.
 *
 * Mutex covers: wait for slot → Send click → submission confirmation →
 * persist lastSubmissionAt → release. Never held during response wait.
 */
import { AutomationError } from "../browserUtils.js";
import {
  getDefaultMinSubmissionIntervalMs,
  readLastSubmission,
  remainingSubmissionWaitMs,
  recordSuccessfulSubmission,
  chatgptLastSubmissionPath,
} from "../chatgptQualification/submissionThrottle.js";
import type { Logger } from "../logger.js";

export type ChatGptSubmissionClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const realClock: ChatGptSubmissionClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export type GlobalSendSlotAcquireInfo = {
  waitedMs: number;
  previousSendAtMs: number | null;
  currentSendAtMs: number;
  sequence: number;
  workerId?: number;
};

export type ChatGptSubmissionScheduler = {
  /**
   * Run exclusive Send transaction under the global mutex.
   * Prefer this over acquire/release pairs.
   */
  withGlobalSendSlot: <T>(options: {
    logger?: Logger;
    workerId?: number;
    sourcePortal: "TENDER247" | "BIDASSIST";
    sourceTenderId: string;
    /**
     * Perform Send + authoritative confirmation while mutex is held.
     * Return submitted=true only when Send actually succeeded.
     */
    send: () => Promise<{ submitted: boolean; result: T }>;
  }) => Promise<T>;

  /** @deprecated Prefer withGlobalSendSlot — kept for callers that split acquire/send. */
  acquireSendSlot: (options?: {
    logger?: Logger;
    workerId?: number;
  }) => Promise<{ waitedMs: number }>;

  /** Record successful Send and release slot (legacy pair with acquireSendSlot). */
  releaseSendSlotSuccess: (options: {
    sourcePortal: "TENDER247" | "BIDASSIST";
    sourceTenderId: string;
  }) => void;

  /** Release slot without recording success (failed / uncertain Send). */
  releaseSendSlot: () => void;

  /** Mark submission success while slot already held (or recovery after uncertain Send). */
  markSubmissionSuccess: (options: {
    sourcePortal: "TENDER247" | "BIDASSIST";
    sourceTenderId: string;
    /** Skip throttle violation check (recovery when Send already happened). */
    force?: boolean;
  }) => void;

  /** Account-level rate-limit backoff (affects all workers' Send). */
  applyRateLimitBackoff: (ms: number) => void;

  getActiveWorkersAllowed: () => number;
  setActiveWorkersAllowed: (n: number) => void;
  noteSuccess: () => void;
  getBackoffRemainingMs: () => number;
  getLastSuccessfulSubmissionAtMs: () => number | null;
  getSendSequence: () => number;
};

function loadPersistedLastMs(): number | null {
  const prior = readLastSubmission(chatgptLastSubmissionPath());
  if (!prior?.lastSubmissionAt) return null;
  const ms = Date.parse(prior.lastSubmissionAt);
  return Number.isFinite(ms) ? ms : null;
}

export function createChatGptSubmissionScheduler(options?: {
  minIntervalMs?: number;
  rateLimitBackoffMs?: number;
  maxRateLimitBackoffMs?: number;
  maxWorkers?: number;
  clock?: ChatGptSubmissionClock;
  /** Seed last submission (tests). */
  initialLastSubmissionAtMs?: number | null;
}): ChatGptSubmissionScheduler {
  const minIntervalMs =
    options?.minIntervalMs ?? getDefaultMinSubmissionIntervalMs();
  const clock = options?.clock ?? realClock;
  const baseBackoff =
    options?.rateLimitBackoffMs ??
    Number.parseInt(process.env.CHATGPT_RATE_LIMIT_BACKOFF_MS || "600000", 10);
  const maxBackoff =
    options?.maxRateLimitBackoffMs ??
    Number.parseInt(
      process.env.CHATGPT_MAX_RATE_LIMIT_BACKOFF_MS || "1800000",
      10,
    );
  const maxWorkers = Math.min(2, Math.max(1, options?.maxWorkers ?? 2));

  let mutexTail: Promise<void> = Promise.resolve();
  let releaseCurrent: (() => void) | null = null;
  let backoffUntilMs = 0;
  let currentBackoffMs = Number.isFinite(baseBackoff) ? baseBackoff : 300_000;
  let activeWorkersAllowed = maxWorkers;
  let successStreak = 0;
  let lastSuccessfulSubmissionAtMs: number | null =
    options?.initialLastSubmissionAtMs !== undefined
      ? options.initialLastSubmissionAtMs
      : loadPersistedLastMs();
  let sendSequence = 0;
  /** True while a caller holds the legacy acquireSendSlot lock. */
  let legacySlotHeld = false;

  const log = (
    logger: Logger | undefined,
    message: string,
  ): void => {
    logger?.info(message);
    console.log(message);
  };

  const enterMutex = async (): Promise<() => void> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = mutexTail;
    mutexTail = previous.then(() => gate);
    await previous;
    return release;
  };

  const waitForBackoffAndInterval = async (opts?: {
    logger?: Logger;
    workerId?: number;
  }): Promise<{ waitedMs: number; previousSendAtMs: number | null }> => {
    const started = clock.now();
    const workerId = opts?.workerId;

    // Refresh from disk so process restarts / other processes are respected.
    const persisted = loadPersistedLastMs();
    if (
      persisted != null &&
      (lastSuccessfulSubmissionAtMs == null ||
        persisted > lastSuccessfulSubmissionAtMs)
    ) {
      lastSuccessfulSubmissionAtMs = persisted;
    }

    const previousSendAtMs = lastSuccessfulSubmissionAtMs;
    const lastIso =
      previousSendAtMs != null
        ? new Date(previousSendAtMs).toISOString()
        : "none";
    const nextAt =
      previousSendAtMs != null
        ? previousSendAtMs + minIntervalMs
        : clock.now();
    const remainingInterval = remainingSubmissionWaitMs({
      lastSubmissionAtMs: previousSendAtMs,
      nowMs: clock.now(),
      minIntervalMs,
    });
    const remainingBackoff = Math.max(0, backoffUntilMs - clock.now());
    const waitMs = Math.max(remainingInterval, remainingBackoff);

    log(
      opts?.logger,
      `CHATGPT_WAITING_FOR_GLOBAL_SEND_SLOT=true`,
    );
    if (workerId != null) {
      log(opts?.logger, `CHATGPT_WORKER_ID=${workerId}`);
    }
    log(opts?.logger, `CHATGPT_GLOBAL_LAST_SEND_AT=${lastIso}`);
    log(
      opts?.logger,
      `CHATGPT_GLOBAL_NEXT_SEND_AT=${new Date(nextAt).toISOString()}`,
    );
    log(opts?.logger, `CHATGPT_GLOBAL_SEND_WAIT_MS=${waitMs}`);

    while (clock.now() < backoffUntilMs) {
      const left = Math.max(0, backoffUntilMs - clock.now());
      log(
        opts?.logger,
        `CHATGPT_SCHEDULER_BACKOFF_WAIT_MS=${left} worker=${workerId ?? "?"}`,
      );
      await clock.sleep(Math.min(left, 5_000));
    }

    const remaining = remainingSubmissionWaitMs({
      lastSubmissionAtMs: lastSuccessfulSubmissionAtMs,
      nowMs: clock.now(),
      minIntervalMs,
    });
    if (remaining > 0) {
      log(
        opts?.logger,
        `CHATGPT_SCHEDULER_MIN_INTERVAL_WAIT_MS=${remaining} worker=${workerId ?? "?"}`,
      );
      await clock.sleep(remaining);
    }

    return { waitedMs: clock.now() - started, previousSendAtMs };
  };

  const assertAndRecordSend = (options: {
    logger?: Logger;
    workerId?: number;
    sourcePortal: "TENDER247" | "BIDASSIST";
    sourceTenderId: string;
    previousSendAtMs: number | null;
  }): GlobalSendSlotAcquireInfo => {
    const currentSendAtMs = clock.now();
    const previousSendAtMs = options.previousSendAtMs;
    const intervalMs =
      previousSendAtMs == null
        ? minIntervalMs
        : currentSendAtMs - previousSendAtMs;

    sendSequence += 1;
    log(options.logger, `CHATGPT_GLOBAL_SEND_SEQUENCE=${sendSequence}`);
    log(
      options.logger,
      `CHATGPT_GLOBAL_PREVIOUS_SEND_AT=${
        previousSendAtMs != null
          ? new Date(previousSendAtMs).toISOString()
          : "none"
      }`,
    );
    log(
      options.logger,
      `CHATGPT_GLOBAL_CURRENT_SEND_AT=${new Date(currentSendAtMs).toISOString()}`,
    );
    log(options.logger, `CHATGPT_GLOBAL_SEND_INTERVAL_MS=${intervalMs}`);

    if (
      previousSendAtMs != null &&
      intervalMs < minIntervalMs
    ) {
      log(options.logger, "CHATGPT_GLOBAL_THROTTLE_VIOLATION=true");
      throw new AutomationError(
        "CHATGPT_GLOBAL_THROTTLE_VIOLATION",
        `CHATGPT_GLOBAL_THROTTLE_VIOLATION=true intervalMs=${intervalMs} min=${minIntervalMs}`,
      );
    }

    lastSuccessfulSubmissionAtMs = currentSendAtMs;
    recordSuccessfulSubmission({
      sourcePortal: options.sourcePortal,
      sourceTenderId: options.sourceTenderId,
      at: new Date(currentSendAtMs),
    });

    return {
      waitedMs: 0,
      previousSendAtMs,
      currentSendAtMs,
      sequence: sendSequence,
      workerId: options.workerId,
    };
  };

  const withGlobalSendSlot: ChatGptSubmissionScheduler["withGlobalSendSlot"] =
    async (opts) => {
      const release = await enterMutex();
      releaseCurrent = release;
      legacySlotHeld = true;
      try {
        const { previousSendAtMs, waitedMs } = await waitForBackoffAndInterval({
          logger: opts.logger,
          workerId: opts.workerId,
        });
        log(opts.logger, "CHATGPT_GLOBAL_SEND_SLOT_ACQUIRED=true");
        void waitedMs;

        const outcome = await opts.send();

        if (outcome.submitted) {
          assertAndRecordSend({
            logger: opts.logger,
            workerId: opts.workerId,
            sourcePortal: opts.sourcePortal,
            sourceTenderId: opts.sourceTenderId,
            previousSendAtMs,
          });
          successStreak += 1;
          if (successStreak >= 2 && activeWorkersAllowed < maxWorkers) {
            activeWorkersAllowed = maxWorkers;
            console.log(`CHATGPT_SCHEDULER_RESTORE_WORKERS=${maxWorkers}`);
          }
          currentBackoffMs = Number.isFinite(baseBackoff)
            ? baseBackoff
            : 300_000;
        }
        // If not submitted: do NOT advance lastSuccessfulSubmissionAtMs.
        return outcome.result;
      } finally {
        legacySlotHeld = false;
        releaseCurrent = null;
        release();
      }
    };

  const acquireSendSlot: ChatGptSubmissionScheduler["acquireSendSlot"] = async (
    opts,
  ) => {
    const release = await enterMutex();
    releaseCurrent = release;
    legacySlotHeld = true;
    const { waitedMs } = await waitForBackoffAndInterval(opts);
    log(opts?.logger, "CHATGPT_GLOBAL_SEND_SLOT_ACQUIRED=true");
    return { waitedMs };
  };

  const releaseSendSlot = (): void => {
    if (!legacySlotHeld) return;
    legacySlotHeld = false;
    const rel = releaseCurrent;
    releaseCurrent = null;
    rel?.();
  };

  return {
    withGlobalSendSlot,
    acquireSendSlot,
    releaseSendSlotSuccess(opts) {
      assertAndRecordSend({
        sourcePortal: opts.sourcePortal,
        sourceTenderId: opts.sourceTenderId,
        previousSendAtMs: lastSuccessfulSubmissionAtMs,
        logger: undefined,
      });
      successStreak += 1;
      releaseSendSlot();
    },
    releaseSendSlot,
    markSubmissionSuccess(opts) {
      if (opts.force) {
        const currentSendAtMs = clock.now();
        lastSuccessfulSubmissionAtMs = currentSendAtMs;
        sendSequence += 1;
        recordSuccessfulSubmission({
          sourcePortal: opts.sourcePortal,
          sourceTenderId: opts.sourceTenderId,
          at: new Date(currentSendAtMs),
        });
        console.log(`CHATGPT_GLOBAL_SEND_SEQUENCE=${sendSequence}`);
        console.log(
          `CHATGPT_GLOBAL_CURRENT_SEND_AT=${new Date(currentSendAtMs).toISOString()}`,
        );
        return;
      }
      assertAndRecordSend({
        sourcePortal: opts.sourcePortal,
        sourceTenderId: opts.sourceTenderId,
        previousSendAtMs: lastSuccessfulSubmissionAtMs,
      });
    },
    applyRateLimitBackoff(ms: number) {
      const capped = Math.min(
        Math.max(ms, currentBackoffMs),
        Number.isFinite(maxBackoff) ? maxBackoff : 600_000,
      );
      currentBackoffMs = capped;
      backoffUntilMs = clock.now() + capped;
      successStreak = 0;
      if (activeWorkersAllowed > 1) {
        activeWorkersAllowed = 1;
        console.log("CHATGPT_SCHEDULER_REDUCE_WORKERS=1");
      }
      console.log(`CHATGPT_SCHEDULER_RATE_LIMIT_BACKOFF_MS=${capped}`);
      console.log(
        `CHATGPT_GLOBAL_RATE_LIMIT_UNTIL=${new Date(backoffUntilMs).toISOString()}`,
      );
    },
    getActiveWorkersAllowed: () => activeWorkersAllowed,
    setActiveWorkersAllowed: (n: number) => {
      activeWorkersAllowed = Math.min(maxWorkers, Math.max(1, n));
    },
    noteSuccess: () => {
      successStreak += 1;
      if (successStreak >= 2 && activeWorkersAllowed < maxWorkers) {
        activeWorkersAllowed = maxWorkers;
        console.log(`CHATGPT_SCHEDULER_RESTORE_WORKERS=${maxWorkers}`);
      }
      currentBackoffMs = Number.isFinite(baseBackoff) ? baseBackoff : 300_000;
    },
    getBackoffRemainingMs: () => Math.max(0, backoffUntilMs - clock.now()),
    getLastSuccessfulSubmissionAtMs: () => lastSuccessfulSubmissionAtMs,
    getSendSequence: () => sendSequence,
  };
}

/** Module-level singleton for cross-worker Send serialization in one process. */
let sharedScheduler: ChatGptSubmissionScheduler | null = null;

export function getSharedChatGptSubmissionScheduler(): ChatGptSubmissionScheduler {
  if (!sharedScheduler) {
    sharedScheduler = createChatGptSubmissionScheduler();
  }
  return sharedScheduler;
}

export function resetSharedChatGptSubmissionSchedulerForTests(): void {
  sharedScheduler = null;
}

/**
 * Optional shared attachment-upload budget across workers (same ChatGPT account).
 * Local file prep is unlimited; only ChatGPT upload attempts consume budget.
 */
export type ChatGptUploadBudget = {
  tryAcquireUploads: (count: number) => boolean;
  releaseUploads: (count: number) => void;
  getRemaining: () => number;
};

export function createChatGptUploadBudget(options?: {
  maxConcurrentFileUploads?: number;
}): ChatGptUploadBudget {
  const max = Math.max(
    1,
    options?.maxConcurrentFileUploads ??
      (Number.parseInt(process.env.CHATGPT_UPLOAD_MAX_IN_FLIGHT || "3", 10) ||
        3),
  );
  let inFlight = 0;
  return {
    tryAcquireUploads(count: number) {
      if (inFlight + count > max) return false;
      inFlight += count;
      return true;
    },
    releaseUploads(count: number) {
      inFlight = Math.max(0, inFlight - count);
    },
    getRemaining: () => Math.max(0, max - inFlight),
  };
}

let sharedUploadBudget: ChatGptUploadBudget | null = null;

export function getSharedChatGptUploadBudget(): ChatGptUploadBudget {
  if (!sharedUploadBudget) {
    sharedUploadBudget = createChatGptUploadBudget();
  }
  return sharedUploadBudget;
}

export function resetSharedChatGptUploadBudgetForTests(): void {
  sharedUploadBudget = null;
}
