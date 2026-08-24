/**
 * Authoritative detailed ChatGPT qualification state — shared by full pipeline
 * and DOCUMENT_TEXT_MODE. Local persisted response is the source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import {
  hasPendingExistingConversation,
  loadChatGptTenderState,
} from "./chatgptState.js";
import {
  isValidSavedQualificationResult,
  validateQualificationResult,
} from "./qualificationSchema.js";
import { TENDER_DECISION_STATUSES } from "./types.js";

export type QualificationStateStatus =
  | "COMPLETE"
  | "PENDING"
  | "FAILED_RETRYABLE"
  | "NOT_STARTED";

export type QualificationStateInspection = {
  status: QualificationStateStatus;
  validResponse: boolean;
  qualificationStatus?: string;
  responsePath?: string;
  resultPath?: string;
  databaseRecordId?: string;
  completedAt?: string;
  skipReason?: "VALID_EXISTING_RESPONSE" | "PENDING_EXISTING_CONVERSATION";
  source?: "qualification-result" | "qualification-text-mode" | null;
};

function normalizeTenderId(raw: string): string {
  return String(raw ?? "")
    .replace(/^T247-/i, "")
    .replace(/\D/g, "");
}

function isCanonicalStatus(status: string | null | undefined): boolean {
  return Boolean(
    status &&
      (TENDER_DECISION_STATUSES as readonly string[]).includes(status),
  );
}

function resolveTenderFolder(
  dateFolder: string,
  tenderIdRaw: string,
): string {
  const tenderId = normalizeTenderId(tenderIdRaw);
  const direct = path.join(dateFolder, `T247-${tenderId}`);
  if (fs.existsSync(direct)) return direct;
  const accountsRoot = path.join(dateFolder, "accounts");
  if (fs.existsSync(accountsRoot)) {
    for (const accountName of fs.readdirSync(accountsRoot)) {
      const candidate = path.join(accountsRoot, accountName, `T247-${tenderId}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return direct;
}

/** Validate text-mode artifacts (separate filenames from upload flow). */
export function isValidTextModeQualificationResult(
  tenderFolder: string,
  expectedTenderId: string,
): {
  ok: boolean;
  status?: string;
  resultPath?: string;
  responsePath?: string;
  completedAt?: string;
} {
  const resultPath = path.join(tenderFolder, "qualification-text-mode.json");
  const responsePath = path.join(
    tenderFolder,
    "qualification-text-mode-response.txt",
  );
  if (!fs.existsSync(resultPath) || fs.statSync(resultPath).size <= 0) {
    return { ok: false };
  }
  if (!fs.existsSync(responsePath) || fs.statSync(responsePath).size <= 0) {
    return { ok: false };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(resultPath, "utf8")) as Record<
      string,
      unknown
    >;
    const id = normalizeTenderId(
      String(raw.sourceTenderId ?? raw.t247Id ?? ""),
    );
    const expected = normalizeTenderId(expectedTenderId);
    if (id && expected && id !== expected) {
      return { ok: false };
    }
    const validated = validateQualificationResult(raw, expected || id);
    if (!validated.ok) return { ok: false };
    if (!isCanonicalStatus(validated.result.status)) return { ok: false };
    return {
      ok: true,
      status: validated.result.status,
      resultPath,
      responsePath,
      completedAt: fs.statSync(resultPath).mtime.toISOString(),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Inspect whether a tender already has a valid detailed qualification response.
 * RULE: valid existing response → COMPLETE (never re-send).
 */
export function inspectQualificationState(options: {
  dateFolder: string;
  tenderId: string;
  companyId?: string;
}): QualificationStateInspection {
  void options.companyId;
  const tenderId = normalizeTenderId(options.tenderId);
  const tenderFolder = resolveTenderFolder(options.dateFolder, tenderId);
  const canonicalResultPath = path.join(
    tenderFolder,
    "qualification-result.json",
  );
  const canonicalResponsePath = path.join(
    tenderFolder,
    "qualification-response.txt",
  );

  if (isValidSavedQualificationResult(canonicalResultPath)) {
    let qualificationStatus: string | undefined;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(canonicalResultPath, "utf8"),
      ) as { status?: string };
      qualificationStatus = parsed.status;
    } catch {
      qualificationStatus = undefined;
    }
    return {
      status: "COMPLETE",
      validResponse: true,
      qualificationStatus,
      responsePath: canonicalResponsePath,
      resultPath: canonicalResultPath,
      completedAt: fs.existsSync(canonicalResultPath)
        ? fs.statSync(canonicalResultPath).mtime.toISOString()
        : undefined,
      skipReason: "VALID_EXISTING_RESPONSE",
      source: "qualification-result",
    };
  }

  const textMode = isValidTextModeQualificationResult(tenderFolder, tenderId);
  if (textMode.ok) {
    return {
      status: "COMPLETE",
      validResponse: true,
      qualificationStatus: textMode.status,
      responsePath: textMode.responsePath,
      resultPath: textMode.resultPath,
      completedAt: textMode.completedAt,
      skipReason: "VALID_EXISTING_RESPONSE",
      source: "qualification-text-mode",
    };
  }

  const state = loadChatGptTenderState(tenderFolder);
  if (hasPendingExistingConversation(state)) {
    return {
      status: "PENDING",
      validResponse: false,
      skipReason: "PENDING_EXISTING_CONVERSATION",
      source: null,
    };
  }

  const hasPartial =
    (fs.existsSync(canonicalResultPath) &&
      fs.statSync(canonicalResultPath).size > 0) ||
    (fs.existsSync(path.join(tenderFolder, "qualification-text-mode.json")) &&
      fs.statSync(path.join(tenderFolder, "qualification-text-mode.json"))
        .size > 0) ||
    state?.status === "failed";

  if (hasPartial) {
    return {
      status: "FAILED_RETRYABLE",
      validResponse: false,
      source: null,
    };
  }

  return {
    status: "NOT_STARTED",
    validResponse: false,
    source: null,
  };
}

export function logQualificationStateInspection(
  tenderId: string,
  inspection: QualificationStateInspection,
  logger?: { info: (msg: string) => void },
): void {
  const id = `T247-${normalizeTenderId(tenderId)}`;
  const lines = [
    `[${id}] QUALIFICATION_STATE=${inspection.status}`,
    inspection.validResponse
      ? `[${id}] CHATGPT_SKIP_REASON=VALID_EXISTING_RESPONSE`
      : inspection.status === "PENDING"
        ? `[${id}] CHATGPT_SKIP_REASON=PENDING_EXISTING_CONVERSATION`
        : `[${id}] CHATGPT_QUEUE_REQUIRED=true`,
  ];
  for (const line of lines) {
    console.log(line);
    logger?.info(line);
  }
}
