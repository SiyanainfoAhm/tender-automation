/**
 * Strict existing-qualification reuse.
 * RULE: a valid persisted detailed qualification is NEVER re-sent — fresh or resume.
 */
import fs from "node:fs";
import path from "node:path";
import { loadChatGptTenderState } from "./chatgptState.js";
import { inspectQualificationState } from "./inspectQualificationState.js";
import { isValidSavedQualificationResult } from "./qualificationSchema.js";
import {
  computeQualificationInputFingerprint,
  loadStoredQualificationInputHash,
  logDocumentZipFingerprint,
  type QualificationInputFingerprint,
} from "./qualificationInputFingerprint.js";
import { TENDER_DECISION_STATUSES } from "./types.js";

export type ExistingQualificationReuseDecision = {
  found: boolean;
  reuse: boolean;
  stale: boolean;
  inputHashMatch: boolean | null;
  status: string | null;
  resultSource: "local" | null;
  resultDate: string | null;
  reason:
    | "FRESH_RUN_NO_REUSE"
    | "EXISTING_VALID_QUALIFICATION"
    | "EXISTING_STALE_INPUT"
    | "EXISTING_INVALID"
    | "EXISTING_MISSING_INPUT_HASH"
    | "NO_EXISTING_RESULT";
  fingerprint: QualificationInputFingerprint;
};

function isCanonicalStatus(status: string | null | undefined): boolean {
  return Boolean(
    status &&
      (TENDER_DECISION_STATUSES as readonly string[]).includes(status),
  );
}

export function evaluateExistingQualificationReuse(options: {
  dateFolder: string;
  sourceTenderId: string;
  resumeMode: boolean;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): ExistingQualificationReuseDecision {
  const t247Id = options.sourceTenderId.replace(/^T247-/i, "").trim();
  const tenderFolder = path.join(options.dateFolder, `T247-${t247Id}`);
  const resultPath = path.join(tenderFolder, "qualification-result.json");
  const fingerprint = computeQualificationInputFingerprint({
    dateFolder: options.dateFolder,
    sourceTenderId: t247Id,
    sourcePortal: "TENDER247",
  });

  logDocumentZipFingerprint(fingerprint, options.logger);

  const inspection = inspectQualificationState({
    dateFolder: options.dateFolder,
    tenderId: t247Id,
  });
  const log = (msg: string) => {
    console.log(msg);
    options.logger?.info(msg);
  };

  log(`CHATGPT_EXISTING_QUALIFICATION_FOUND=${inspection.validResponse || inspection.status !== "NOT_STARTED"}`);
  if (inspection.qualificationStatus) {
    log(`CHATGPT_EXISTING_QUALIFICATION_STATUS=${inspection.qualificationStatus}`);
  }

  // Non-negotiable: valid detailed response → never send again.
  if (inspection.validResponse) {
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=true");
    log("CHATGPT_QUALIFICATION_REUSED_EXISTING=true");
    return {
      found: true,
      reuse: true,
      stale: false,
      inputHashMatch: true,
      status: inspection.qualificationStatus ?? null,
      resultSource: "local",
      resultDate: inspection.completedAt ?? null,
      reason: "EXISTING_VALID_QUALIFICATION",
      fingerprint,
    };
  }

  const resultExists =
    fs.existsSync(resultPath) && fs.statSync(resultPath).size > 0;
  let status: string | null = null;
  let resultDate: string | null = null;
  if (resultExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
        status?: string;
      };
      status = parsed.status ?? null;
      resultDate = fs.statSync(resultPath).mtime.toISOString();
    } catch {
      status = null;
    }
  }

  const found = resultExists;
  const state = loadChatGptTenderState(tenderFolder);

  if (!found) {
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
    return {
      found: false,
      reuse: false,
      stale: false,
      inputHashMatch: null,
      status: null,
      resultSource: null,
      resultDate: null,
      reason: "NO_EXISTING_RESULT",
      fingerprint,
    };
  }

  const valid = isValidSavedQualificationResult(resultPath);
  const belongsToTender = resultBelongsToTender(resultPath, t247Id);
  if (!valid || !isCanonicalStatus(status) || !belongsToTender) {
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
    log("CHATGPT_EXISTING_QUALIFICATION_INVALID=true");
    return {
      found: true,
      reuse: false,
      stale: false,
      inputHashMatch: null,
      status,
      resultSource: "local",
      resultDate,
      reason: "EXISTING_INVALID",
      fingerprint,
    };
  }

  const storedHash = loadStoredQualificationInputHash(tenderFolder);
  if (!storedHash) {
    // Valid schema result still counts as complete via inspectQualificationState above.
    // Reach here only when canonical validator passed but inspector disagreed — treat invalid.
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
    log("CHATGPT_EXISTING_QUALIFICATION_INPUT_HASH_MATCH=false");
    log("CHATGPT_EXISTING_QUALIFICATION_MISSING_INPUT_HASH=true");
    return {
      found: true,
      reuse: false,
      stale: true,
      inputHashMatch: false,
      status,
      resultSource: "local",
      resultDate,
      reason: "EXISTING_MISSING_INPUT_HASH",
      fingerprint,
    };
  }

  const inputHashMatch = storedHash === fingerprint.qualificationInputHash;
  log(`CHATGPT_EXISTING_QUALIFICATION_INPUT_HASH_MATCH=${inputHashMatch}`);

  if (!inputHashMatch) {
    log("CHATGPT_EXISTING_QUALIFICATION_STALE=true");
    log("CHATGPT_EXISTING_QUALIFICATION_SKIP=false");
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
    return {
      found: true,
      reuse: false,
      stale: true,
      inputHashMatch: false,
      status,
      resultSource: "local",
      resultDate,
      reason: "EXISTING_STALE_INPUT",
      fingerprint,
    };
  }

  if (
    state?.status === "failed" ||
    state?.status === "not_ready" ||
    state?.status === "response_pending"
  ) {
    if (state.status !== "response_pending" || !isValidSavedQualificationResult(resultPath)) {
      log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
      return {
        found: true,
        reuse: false,
        stale: false,
        inputHashMatch: true,
        status,
        resultSource: "local",
        resultDate,
        reason: "EXISTING_INVALID",
        fingerprint,
      };
    }
  }

  log("CHATGPT_EXISTING_QUALIFICATION_REUSE=true");
  log("CHATGPT_QUALIFICATION_REUSED_EXISTING=true");
  return {
    found: true,
    reuse: true,
    stale: false,
    inputHashMatch: true,
    status,
    resultSource: "local",
    resultDate,
    reason: "EXISTING_VALID_QUALIFICATION",
    fingerprint,
  };
}

function resultBelongsToTender(resultPath: string, t247Id: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
      t247Id?: string;
      sourceTenderId?: string;
    };
    const resultId = String(parsed.sourceTenderId ?? parsed.t247Id ?? "")
      .replace(/^T247-/i, "")
      .trim();
    return resultId === t247Id;
  } catch {
    return false;
  }
}

/** True only when a valid reusable individual qualification exists on disk. */
export function hasValidExistingQualification(options: {
  dateFolder: string;
  sourceTenderId: string;
}): boolean {
  return evaluateExistingQualificationReuse({
    ...options,
    resumeMode: true,
  }).reuse;
}

export function logSkipExistingDetails(options: {
  sourceTenderId: string;
  decision: ExistingQualificationReuseDecision;
}): void {
  const { sourceTenderId, decision } = options;
  console.log(`CHATGPT_SKIP_TENDER=${sourceTenderId}`);
  console.log(`CHATGPT_SKIP_REASON=${decision.reason}`);
  console.log(`CHATGPT_EXISTING_STATUS=${decision.status ?? ""}`);
  console.log(
    `CHATGPT_EXISTING_RESULT_SOURCE=${decision.resultSource ?? ""}`,
  );
  console.log(`CHATGPT_EXISTING_RESULT_DATE=${decision.resultDate ?? ""}`);
  console.log(
    `CHATGPT_INPUT_HASH_MATCH=${decision.inputHashMatch === true}`,
  );
}
