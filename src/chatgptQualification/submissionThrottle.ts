/**
 * Shared ChatGPT Send-click throttle across Tender247 and BidAssist E2E runs.
 * Persists the latest successful submission so later pipelines wait only the
 * remaining interval (not a full fixed delay after every source completes).
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";

export type ChatGptLastSubmissionState = {
  lastSubmissionAt: string;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
};

export function chatgptLastSubmissionPath(): string {
  return resolveProjectPath("runtime/chatgpt-last-submission.json");
}

export function readLastSubmission(
  filePath = chatgptLastSubmissionPath(),
): ChatGptLastSubmissionState | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as ChatGptLastSubmissionState;
    if (!raw?.lastSubmissionAt) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeLastSubmission(
  state: ChatGptLastSubmissionState,
  filePath = chatgptLastSubmissionPath(),
): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

export function recordSuccessfulSubmission(options: {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  at?: Date;
  filePath?: string;
}): void {
  writeLastSubmission(
    {
      lastSubmissionAt: (options.at || new Date()).toISOString(),
      sourcePortal: options.sourcePortal,
      sourceTenderId: options.sourceTenderId,
    },
    options.filePath,
  );
}

export function getDefaultMinSubmissionIntervalMs(): number {
  const raw = process.env.CHATGPT_MIN_SUBMISSION_INTERVAL_MS?.trim();
  if (!raw) {
    return 600_000;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 600_000;
}

/** Pure helper — remaining wait before the next Send is allowed. */
export function remainingSubmissionWaitMs(options: {
  lastSubmissionAtMs: number | null;
  nowMs?: number;
  minIntervalMs: number;
}): number {
  if (options.lastSubmissionAtMs == null) {
    return 0;
  }
  const now = options.nowMs ?? Date.now();
  const elapsed = Math.max(0, now - options.lastSubmissionAtMs);
  return Math.max(0, options.minIntervalMs - elapsed);
}

export async function waitForSharedSubmissionInterval(options: {
  minIntervalMs?: number;
  logger?: Logger;
  filePath?: string;
  /** Log prefix for between-source waits */
  betweenSource?: boolean;
}): Promise<{ waitedMs: number; elapsedMs: number; remainingMs: number }> {
  const minIntervalMs =
    options.minIntervalMs ?? getDefaultMinSubmissionIntervalMs();
  const filePath = options.filePath ?? chatgptLastSubmissionPath();
  const prior = readLastSubmission(filePath);
  const lastMs = prior?.lastSubmissionAt
    ? Date.parse(prior.lastSubmissionAt)
    : NaN;
  const lastSubmissionAtMs = Number.isFinite(lastMs) ? lastMs : null;
  const now = Date.now();
  const elapsedMs =
    lastSubmissionAtMs == null ? minIntervalMs : Math.max(0, now - lastSubmissionAtMs);
  const remainingMs = remainingSubmissionWaitMs({
    lastSubmissionAtMs,
    nowMs: now,
    minIntervalMs,
  });

  if (prior?.lastSubmissionAt) {
    options.logger?.info(
      `CHATGPT_LAST_SUBMISSION_AT=${prior.lastSubmissionAt}`,
    );
    console.log(`CHATGPT_LAST_SUBMISSION_AT=${prior.lastSubmissionAt}`);
  }
  options.logger?.info(`CHATGPT_SUBMISSION_INTERVAL_ELAPSED_MS=${elapsedMs}`);
  console.log(`CHATGPT_SUBMISSION_INTERVAL_ELAPSED_MS=${elapsedMs}`);
  options.logger?.info(
    `CHATGPT_SUBMISSION_INTERVAL_REMAINING_MS=${remainingMs}`,
  );
  console.log(`CHATGPT_SUBMISSION_INTERVAL_REMAINING_MS=${remainingMs}`);

  if (remainingMs <= 0) {
    return { waitedMs: 0, elapsedMs, remainingMs: 0 };
  }

  if (options.betweenSource) {
    options.logger?.info("COMPLETE_E2E_BETWEEN_SOURCE_WAIT_START");
    console.log("COMPLETE_E2E_BETWEEN_SOURCE_WAIT_START");
  }

  await new Promise((r) => setTimeout(r, remainingMs));

  if (options.betweenSource) {
    options.logger?.info("COMPLETE_E2E_BETWEEN_SOURCE_WAIT_COMPLETE");
    console.log("COMPLETE_E2E_BETWEEN_SOURCE_WAIT_COMPLETE");
  }

  return { waitedMs: remainingMs, elapsedMs, remainingMs: 0 };
}
