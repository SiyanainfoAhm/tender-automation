/**
 * Persist per-candidate ChatGPT failure evidence without fabricating qualifications.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import type { ChatGptCandidateStage } from "./candidateTxnState.js";

export type CandidateFailureAudit = {
  tenderId: string;
  attempt: number;
  stage: ChatGptCandidateStage | string;
  reason: string;
  conversationUrl: string | null;
  promptSubmitted: boolean;
  filesLocked: boolean;
  responseDetected: boolean;
  retryable: boolean;
  timestamp: string;
};

export function getCandidateAuditDir(
  dateFolder: string,
  tenderId: string,
): string {
  return path.join(dateFolder, "until-go-audit", `T247-${tenderId}`);
}

export async function saveCandidateFailureAudit(options: {
  dateFolder: string;
  tenderId: string;
  attempt: number;
  stage: ChatGptCandidateStage | string;
  reason: string;
  conversationUrl?: string | null;
  promptSubmitted?: boolean;
  filesLocked?: boolean;
  responseDetected?: boolean;
  retryable: boolean;
  page?: Page | null;
  logger?: Logger;
  workerEvents?: unknown[];
}): Promise<string> {
  const {
    dateFolder,
    tenderId,
    attempt,
    stage,
    reason,
    conversationUrl = null,
    promptSubmitted = false,
    filesLocked = false,
    responseDetected = false,
    retryable,
    page,
    logger,
    workerEvents = [],
  } = options;

  const auditDir = getCandidateAuditDir(dateFolder, tenderId);
  ensureDir(auditDir);

  const failure: CandidateFailureAudit = {
    tenderId,
    attempt,
    stage,
    reason: reason.slice(0, 2000),
    conversationUrl,
    promptSubmitted,
    filesLocked,
    responseDetected,
    retryable,
    timestamp: new Date().toISOString(),
  };

  const failurePath = path.join(auditDir, "failure.json");
  fs.writeFileSync(failurePath, JSON.stringify(failure, null, 2), "utf8");

  const eventsPath = path.join(auditDir, "worker-events.json");
  fs.writeFileSync(
    eventsPath,
    JSON.stringify(
      {
        tenderId,
        attempt,
        events: workerEvents,
        updatedAt: failure.timestamp,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (page) {
    const shotPath = path.join(auditDir, "failure-screenshot.png");
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
      logger?.info(`CHATGPT_FAILURE_SCREENSHOT=${shotPath}`);
    } catch {
      logger?.warn("CHATGPT_FAILURE_SCREENSHOT_FAILED");
    }
  }

  logger?.info(`CHATGPT_FAILURE_AUDIT=${failurePath}`);
  console.log(`CHATGPT_FAILURE_AUDIT=${failurePath}`);
  return failurePath;
}
