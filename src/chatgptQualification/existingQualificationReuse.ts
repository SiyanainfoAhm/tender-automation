/**
 * Strict existing-qualification reuse — only for --resume with matching input hash.
 */
import fs from "node:fs";
import path from "node:path";
import { loadChatGptTenderState } from "./chatgptState.js";
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
  const log = (msg: string) => {
    console.log(msg);
    options.logger?.info(msg);
  };

  log(`CHATGPT_EXISTING_QUALIFICATION_FOUND=${found}`);
  if (status) {
    log(`CHATGPT_EXISTING_QUALIFICATION_STATUS=${status}`);
  }

  if (!options.resumeMode) {
    log("CHATGPT_EXISTING_QUALIFICATION_REUSE=false");
    return {
      found,
      reuse: false,
      stale: false,
      inputHashMatch: null,
      status,
      resultSource: found ? "local" : null,
      resultDate,
      reason: "FRESH_RUN_NO_REUSE",
      fingerprint,
    };
  }

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
    // Without a stored fingerprint we cannot prove the result matches current inputs.
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
    // Incomplete/failed states must not be treated as reusable completions.
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

  log("CHATGPT_EXISTING_QUALIFICATION_REUSED=true");
  log("CHATGPT_EXISTING_QUALIFICATION_REUSE=true");
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
