/**
 * Explicit ChatGPT submission modes.
 * Attachment requirements are mode-specific and must never be inferred from filenames.
 */
import { AutomationError } from "../browserUtils.js";

export type ChatGptSubmissionKind =
  | "RUN_EXCEL_SCREENING"
  | "TENDER_QUALIFICATION"
  | "DOCUMENT_TEXT_QUALIFICATION";

export type PreSendAttachmentPresence = {
  metadataAttached: boolean;
  documentsAttached: boolean;
  aiSummaryAttached: boolean;
  visibleCardCount: number;
  candidates: string[];
  signals?: string[];
};

export type TenderQualificationPreSendResult = {
  ok: boolean;
  metadataDetected: boolean;
  documentsDetected: boolean;
  aiDetected: boolean;
  aiRequired: boolean;
};

export type RunExcelScreeningPreSendResult = {
  ok: boolean;
  workbookReady: boolean;
  promptPresent: boolean;
  sendEnabled: boolean;
  matchedNames: string[];
};

export function isRunWorkbookFileName(
  name: string,
  expectedFileName?: string,
): boolean {
  const normalized = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  if (expectedFileName) {
    const expected = expectedFileName.replace(/\s+/g, " ").trim().toLowerCase();
    const expectedStem = expected.replace(/\.xlsx$/i, "");
    if (normalized.includes(expectedStem) && /\.xlsx$/i.test(normalized)) {
      return true;
    }
    if (normalized === expected || normalized.includes(expected)) {
      return true;
    }
  }
  return /\.xlsx$/i.test(normalized) && !normalized.startsWith("~$");
}

export function findRunWorkbookMatches(
  presence: PreSendAttachmentPresence,
  expectedFileName: string,
): string[] {
  const names = [
    ...presence.candidates,
    ...(presence.signals ?? []),
  ];
  return names.filter((name) => isRunWorkbookFileName(name, expectedFileName));
}

/**
 * Existing single-tender gate. Do not weaken.
 * Requires metadata + documents ZIP, and AI Summary when aiRequired.
 */
export function evaluateTenderQualificationPreSend(
  presence: PreSendAttachmentPresence,
  aiRequired: boolean,
): TenderQualificationPreSendResult {
  const metadataDetected = presence.metadataAttached;
  const documentsDetected = presence.documentsAttached;
  const aiDetected = presence.aiSummaryAttached;
  const ok =
    metadataDetected && documentsDetected && (!aiRequired || aiDetected);
  return {
    ok,
    metadataDetected,
    documentsDetected,
    aiDetected,
    aiRequired,
  };
}

export function assertTenderQualificationPreSend(
  presence: PreSendAttachmentPresence,
  aiRequired: boolean,
): TenderQualificationPreSendResult {
  const result = evaluateTenderQualificationPreSend(presence, aiRequired);
  if (result.ok) return result;
  const missing: string[] = [];
  if (!result.metadataDetected) missing.push("metadata");
  if (!result.documentsDetected) missing.push("documents");
  if (result.aiRequired && !result.aiDetected) missing.push("ai_summary");
  throw new AutomationError(
    "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
    `Cannot submit: metadata=${result.metadataDetected} documents=${result.documentsDetected} ai=${result.aiDetected} aiRequired=${result.aiRequired} cards=${presence.visibleCardCount} missing=${missing.join(",")}`,
  );
}

/**
 * Run-level Excel screening: only the workbook + prompt + send enabled.
 * Never requires metadata / documents ZIP / AI Summary.
 */
export function evaluateRunExcelScreeningPreSend(options: {
  presence: PreSendAttachmentPresence;
  expectedWorkbookName: string;
  promptPresent: boolean;
  sendEnabled: boolean;
  requireSendEnabled?: boolean;
}): RunExcelScreeningPreSendResult {
  const matchedNames = findRunWorkbookMatches(
    options.presence,
    options.expectedWorkbookName,
  );
  const workbookReady = matchedNames.length > 0;
  const requireSend = options.requireSendEnabled !== false;
  const sendOk = !requireSend || options.sendEnabled;
  return {
    ok: workbookReady && options.promptPresent && sendOk,
    workbookReady,
    promptPresent: options.promptPresent,
    sendEnabled: options.sendEnabled,
    matchedNames,
  };
}

export function assertRunExcelScreeningPreSend(options: {
  presence: PreSendAttachmentPresence;
  expectedWorkbookName: string;
  promptPresent: boolean;
  sendEnabled: boolean;
  requireSendEnabled?: boolean;
}): RunExcelScreeningPreSendResult {
  const result = evaluateRunExcelScreeningPreSend(options);
  if (result.ok) return result;
  if (!result.workbookReady) {
    throw new AutomationError(
      "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
      `Cannot submit run Excel screening: workbook not attached (${options.expectedWorkbookName}) candidates=${options.presence.candidates.join(",")}`,
    );
  }
  if (!result.promptPresent) {
    throw new AutomationError(
      "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
      "Cannot submit run Excel screening: screening prompt is not present in the composer",
    );
  }
  throw new AutomationError(
    "CHATGPT_SEND_BUTTON_DISABLED",
    "Cannot submit run Excel screening: Send button is not enabled",
  );
}
