/**
 * Experimental DOCUMENT_TEXT_MODE orchestrator for 1–2 test tenders.
 * Downloads remain unchanged; this path extracts text and sends prompt-only.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { AutomationError } from "../../browserUtils.js";
import type { AppConfig } from "../../config.js";
import { resolveRunCompanyId } from "../../company/siyanaCompany.js";
import type { Logger } from "../../logger.js";
import { loadCompanyPreferenceSnapshot } from "../../runScreening/companyPreferences.js";
import { persistValidatedQualificationToSupabase } from "../../supabase/persistQualification.js";
import {
  awaitDetailChatGptSubmissionSlot,
  readDetailRateSnapshot,
} from "../chatgptDetailSubmissionLedger.js";
import {
  hasPendingExistingConversation,
  loadChatGptTenderState,
  saveChatGptTenderState,
} from "../chatgptState.js";
import {
  inspectQualificationState,
  logQualificationStateInspection,
} from "../inspectQualificationState.js";
import {
  sendComposerMessage,
  typeComposerPrompt,
  waitForAssistantResponse,
} from "../chatInteraction.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
  type ChatGptBrowserSession,
} from "../ensureChatGptLoggedIn.js";
import { openFreshTenderPage } from "../freshTenderTab.js";
import { parseAndValidateQualificationResponse } from "../qualificationSchema.js";
import { findTenderAllDocumentsZip } from "../readiness.js";
import { buildDocumentTextQualificationPrompt } from "./buildDocumentTextPrompt.js";
import {
  compressDocumentTextForPrompt,
  DEFAULT_MAX_DOCUMENT_CONTEXT_CHARACTERS,
} from "./compressDocumentText.js";
import { extractDocumentTextForTender } from "./extractDocumentText.js";
import type { QualificationResult } from "../types.js";
import {
  TENDER_DECISION_LABELS,
  TENDER_DECISION_REQUIRED_ACTIONS,
} from "../types.js";
import {
  computeQualificationInputFingerprint,
  saveQualificationInputFingerprint,
} from "../qualificationInputFingerprint.js";

const TEXT_MODE_PROMPT_PATTERN =
  /DOCUMENT TEXT MODE QUALIFICATION|Evaluate this tender for/i;

function log(logger: Logger, message: string): void {
  console.log(message);
  logger.info(message);
}

function normalizeTenderId(raw: string): string {
  return raw.replace(/^T247-/i, "").replace(/\D/g, "");
}

/** Resolve T247-* folder under date root or accounts/* (multi-account layout). */
export function resolveDocumentTextTenderFolder(
  dateFolder: string,
  tenderIdRaw: string,
): string | null {
  const tenderId = normalizeTenderId(tenderIdRaw);
  if (!tenderId) return null;
  const displayId = `T247-${tenderId}`;
  const direct = path.join(dateFolder, displayId);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }
  const accountsRoot = path.join(dateFolder, "accounts");
  if (!fs.existsSync(accountsRoot)) return null;
  for (const accountName of fs.readdirSync(accountsRoot)) {
    const candidate = path.join(accountsRoot, accountName, displayId);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve ZIP-ready tender folders for DOCUMENT_TEXT_MODE.
 * - configuredIds empty → all downloaded T247 folders with Tender_All_Documents.zip
 * - configuredIds set → optional subset filter (debug only)
 * - maxTenders <= 0 → unlimited; otherwise cap (MAX_GPT_TENDERS)
 */
export function resolveDocumentTextTenderTargets(options: {
  dateFolder: string;
  configuredIds: string[];
  maxTenders?: number;
}): Array<{ tenderId: string; tenderFolder: string; source: "configured" | "date_download" }> {
  const max =
    options.maxTenders == null || options.maxTenders <= 0
      ? Number.POSITIVE_INFINITY
      : options.maxTenders;
  const out: Array<{
    tenderId: string;
    tenderFolder: string;
    source: "configured" | "date_download";
  }> = [];
  const seen = new Set<string>();
  const filter = new Set(
    options.configuredIds.map((id) => normalizeTenderId(id)).filter(Boolean),
  );
  const useFilter = filter.size > 0;

  const collect = (dir: string): void => {
    if (!fs.existsSync(dir) || out.length >= max) return;
    const names = fs
      .readdirSync(dir)
      .filter((name) => /^T247-\d+/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of names) {
      if (out.length >= max) return;
      const tenderId = normalizeTenderId(name);
      if (!tenderId || seen.has(tenderId)) continue;
      if (useFilter && !filter.has(tenderId)) continue;
      const folder = path.join(dir, name);
      if (!fs.statSync(folder).isDirectory()) continue;
      if (!findTenderAllDocumentsZip(folder)) continue;
      seen.add(tenderId);
      out.push({
        tenderId,
        tenderFolder: folder,
        source: useFilter ? "configured" : "date_download",
      });
    }
  };

  collect(options.dateFolder);
  const accountsRoot = path.join(options.dateFolder, "accounts");
  if (fs.existsSync(accountsRoot)) {
    for (const accountName of fs.readdirSync(accountsRoot).sort()) {
      collect(path.join(accountsRoot, accountName));
    }
  }

  return out;
}

function readMetadataJson(tenderFolder: string): string {
  const metadataPath = path.join(tenderFolder, "metadata.json");
  if (fs.existsSync(metadataPath) && fs.statSync(metadataPath).size > 0) {
    try {
      const raw = fs.readFileSync(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return fs.readFileSync(metadataPath, "utf8");
    }
  }
  return JSON.stringify(
    { note: "metadata.json missing or empty locally" },
    null,
    2,
  );
}

export type DocumentTextModeTenderResult = {
  tenderId: string;
  status: string | null;
  reason: string | null;
  resultPath: string | null;
  supabaseOk?: boolean;
  error?: string | null;
};

export async function qualifyTenderDocumentTextMode(options: {
  page: Page;
  tenderFolder: string;
  tenderId: string;
  config: AppConfig;
  logger: Logger;
}): Promise<DocumentTextModeTenderResult> {
  const tenderId = normalizeTenderId(options.tenderId);
  const displayId = `T247-${tenderId}`;
  const { tenderFolder, page, config, logger } = options;

  if (!findTenderAllDocumentsZip(tenderFolder)) {
    throw new AutomationError(
      "DOCUMENT_TEXT_ZIP_MISSING",
      `${displayId}: documents/Tender_All_Documents.zip required before text-mode qualification`,
    );
  }

  const bundle = await extractDocumentTextForTender({
    tenderFolder,
    tenderId,
    logger,
  });

  const maxContext =
    config.maxDocumentContextCharacters ??
    DEFAULT_MAX_DOCUMENT_CONTEXT_CHARACTERS;

  let compressed = compressDocumentTextForPrompt({
    tenderId: displayId,
    tenderFolder,
    documents: bundle.documents,
    // Reserve room for company prefs + metadata + JSON schema instructions.
    maxContextCharacters: Math.max(5_000, maxContext - 8_000),
    logger,
  });

  const snapshot = await loadCompanyPreferenceSnapshot(resolveRunCompanyId());
  const metadataJson = readMetadataJson(tenderFolder);

  const buildPrompt = (documentContext: string): string =>
    buildDocumentTextQualificationPrompt({
      tenderId,
      companySnapshot: snapshot,
      metadataJson,
      compressedDocumentContext: documentContext,
    });

  let prompt = buildPrompt(compressed.finalContext);
  if (prompt.length > maxContext) {
    const overhead = Math.max(0, prompt.length - compressed.finalContextLength);
    const allowed = Math.max(5_000, maxContext - overhead - 64);
    const trimmed =
      compressed.finalContext.length > allowed
        ? `${compressed.finalContext.slice(0, allowed - 24)}\n\n[CONTEXT_TRUNCATED]`
        : compressed.finalContext;
    compressed = {
      ...compressed,
      finalContext: trimmed,
      finalContextLength: trimmed.length,
      compressionApplied: true,
    };
    log(logger, `DOCUMENT_TEXT_FINAL_CONTEXT_LENGTH=${trimmed.length}`);
    log(logger, "DOCUMENT_TEXT_COMPRESSION_APPLIED=true");
    prompt = buildPrompt(trimmed);
  }

  const promptPath = path.join(tenderFolder, "qualification-text-mode-prompt.txt");
  fs.writeFileSync(promptPath, prompt, "utf8");

  log(logger, "DOCUMENT_TEXT_MODE_PROMPT_READY=true");
  log(logger, `DOCUMENT_TEXT_MODE_PROMPT_LENGTH=${prompt.length}`);
  log(logger, "DOCUMENT_TEXT_MODE_ATTACHMENTS=none");

  if (prompt.length > maxContext) {
    throw new AutomationError(
      "DOCUMENT_TEXT_PROMPT_TOO_LARGE",
      `${displayId}: prompt length ${prompt.length} exceeds MAX_DOCUMENT_CONTEXT_CHARACTERS=${maxContext}`,
    );
  }
  await typeComposerPrompt(page, prompt, logger);
  const sendResult = await sendComposerMessage(page, logger, {
    requireNewConversation: true,
    submissionKind: "DOCUMENT_TEXT_QUALIFICATION",
    userMessagePattern: TEXT_MODE_PROMPT_PATTERN,
    expectedT247Id: tenderId,
    minAttachmentCount: 0,
    confirmedAttachments: {
      requiredAttachmentsConfirmed: true,
      sourcePortal: "TENDER247",
      sourceTenderId: tenderId,
      fileNames: [],
      composerIdentity: `doc-text-${tenderId}`,
    },
  });

  if (!sendResult.submissionConfirmed) {
    throw new AutomationError(
      "CHATGPT_PROMPT_NOT_SUBMITTED",
      `${displayId}: document-text-mode prompt was not submitted`,
    );
  }

  // Persist PENDING immediately after confirmed Send (crash must not blind re-send).
  const companyId = resolveRunCompanyId();
  const correlationId = `QUALIFICATION-${companyId}-${tenderId}`;
  saveChatGptTenderState(tenderFolder, {
    t247Id: tenderId,
    status: "response_pending",
    submissionConfirmed: true,
    chatUrl: sendResult.chatUrl || page.url(),
    phase: "RESPONSE_PENDING",
    correlationId,
    assistantCountBefore: sendResult.baseline.assistantCountBefore,
    userCountBefore: sendResult.baseline.userCountBefore,
    updatedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    error: null,
  });
  log(logger, `CHATGPT_SUBMISSION_CORRELATION_ID=${correlationId}`);
  log(logger, "QUALIFICATION_STATE=PENDING");

  const waitResult = await waitForAssistantResponse({
    page,
    timeoutMs: config.chatgptResponseTimeoutMs,
    logger,
    expectedT247Id: tenderId,
    assistantCountBefore: sendResult.baseline.assistantCountBefore,
    userCountBefore: sendResult.baseline.userCountBefore,
    submissionKind: "DOCUMENT_TEXT_QUALIFICATION",
    completionMode: "qualification_json",
  });

  if (waitResult.status !== "complete" || !waitResult.text) {
    throw new AutomationError(
      "CHATGPT_RESPONSE_INCOMPLETE",
      `${displayId}: text-mode wait ended status=${waitResult.status}`,
    );
  }

  const responsePath = path.join(
    tenderFolder,
    "qualification-text-mode-response.txt",
  );
  fs.writeFileSync(responsePath, waitResult.text, "utf8");

  const parsed = parseAndValidateQualificationResponse(
    waitResult.text,
    tenderId,
  );
  if (!parsed.ok) {
    throw new AutomationError(
      "QUALIFICATION_JSON_INVALID",
      `${displayId}: ${parsed.error}`,
    );
  }

  const resultPath = path.join(tenderFolder, "qualification-text-mode.json");
  fs.writeFileSync(resultPath, JSON.stringify(parsed.result, null, 2), "utf8");

  // Also write canonical upload-flow filenames so both entry points share COMPLETE state.
  const canonicalResultPath = path.join(tenderFolder, "qualification-result.json");
  const canonicalResponsePath = path.join(
    tenderFolder,
    "qualification-response.txt",
  );
  const canonicalResult: QualificationResult = {
    ...parsed.result,
    sourcePortal: "TENDER247",
    sourceTenderId: tenderId,
    t247Id: tenderId,
    decisionLabel:
      parsed.result.decisionLabel ||
      TENDER_DECISION_LABELS[parsed.result.status],
    requiredAction:
      parsed.result.requiredAction ||
      TENDER_DECISION_REQUIRED_ACTIONS[parsed.result.status],
  };
  fs.writeFileSync(
    canonicalResultPath,
    JSON.stringify(canonicalResult, null, 2),
    "utf8",
  );
  fs.writeFileSync(canonicalResponsePath, waitResult.text, "utf8");
  saveChatGptTenderState(tenderFolder, {
    t247Id: tenderId,
    chatUrl: page.url(),
    status: "completed",
    submissionConfirmed: true,
    phase: "COMPLETED",
    updatedAt: new Date().toISOString(),
    latestAssistantText: waitResult.text,
    uiState: "completed_text_mode",
    error: null,
  });
  try {
    const fingerprint = computeQualificationInputFingerprint({
      dateFolder: path.dirname(tenderFolder),
      sourceTenderId: tenderId,
      sourcePortal: "TENDER247",
    });
    saveQualificationInputFingerprint(tenderFolder, fingerprint);
  } catch {
    // Fingerprint is best-effort for text mode.
  }

  log(logger, "TEXT_MODE_RESULT");
  log(logger, `tenderId=${displayId}`);
  log(logger, `status=${parsed.result.status}`);
  log(logger, `reason=${parsed.result.reason}`);

  let supabaseOk = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const persist = await persistValidatedQualificationToSupabase({
      sourcePortal: "TENDER247",
      sourceTenderId: tenderId,
      qualification: canonicalResult,
      rawResponse: waitResult.text,
      chatUrl: page.url(),
      logger,
    });
    if (persist.ok) {
      supabaseOk = true;
      log(logger, `DOCUMENT_TEXT_SUPABASE_PERSIST_OK=${displayId}`);
      break;
    }
    logger.warn(
      `DOCUMENT_TEXT_SUPABASE_PERSIST_RETRY=${attempt}/3 error=${persist.error}`,
    );
  }
  if (!supabaseOk) {
    logger.warn(`DOCUMENT_TEXT_SUPABASE_PERSIST_FAILED=${displayId}`);
  }

  return {
    tenderId: displayId,
    status: parsed.result.status,
    reason: parsed.result.reason,
    resultPath: canonicalResultPath,
    supabaseOk,
    error: null,
  };
}

export async function runDocumentTextModeTest(options: {
  dateFolder: string;
  dateIso: string;
  tenderIds: string[];
  config: AppConfig;
  logger: Logger;
}): Promise<{
  results: DocumentTextModeTenderResult[];
  complete: boolean;
}> {
  const { config, logger, dateFolder, tenderIds } = options;
  log(logger, "DOCUMENT_TEXT_MODE=true");
  log(
    logger,
    tenderIds.length > 0
      ? `DOCUMENT_TEXT_FILTER_IDS=${JSON.stringify(tenderIds)}`
      : "DOCUMENT_TEXT_FILTER_IDS=[] (all ZIP-ready tenders for date)",
  );

  const targets = resolveDocumentTextTenderTargets({
    dateFolder,
    configuredIds: tenderIds,
    maxTenders: config.maxGptTenders,
  });
  log(logger, `DOCUMENT_TEXT_TARGET_COUNT=${targets.length}`);
  log(
    logger,
    `DOCUMENT_TEXT_RESOLVED_TARGETS=${JSON.stringify(
      targets.map((t) => ({
        tenderId: `T247-${t.tenderId}`,
        source: t.source,
        folder: t.tenderFolder,
      })),
    )}`,
  );

  if (targets.length === 0) {
    throw new AutomationError(
      "DOCUMENT_TEXT_TARGETS_MISSING",
      "DOCUMENT_TEXT_MODE=true: no ZIP-ready tender folders under the date download root. Crawl/detail-download first, or clear DOCUMENT_TEXT_TEST_TENDER_IDS to process all downloaded tenders.",
    );
  }

  if (tenderIds.length > 0) {
    for (const raw of tenderIds) {
      const id = normalizeTenderId(raw);
      if (!id) continue;
      if (!targets.some((t) => t.tenderId === id)) {
        log(
          logger,
          `DOCUMENT_TEXT_FILTER_ID_MISSING=${`T247-${id}`} (skipped — not on disk or no ZIP)`,
        );
      }
    }
  }

  const sessionHolder: { session: ChatGptBrowserSession | null } = {
    session: await launchChatGptPersistentSession({
      config,
      logger,
      downloadPath: dateFolder,
    }),
  };

  const ensureSession = async (): Promise<ChatGptBrowserSession> => {
    if (!sessionHolder.session) {
      sessionHolder.session = await launchChatGptPersistentSession({
        config,
        logger,
        downloadPath: dateFolder,
      });
      await ensureChatGptLoggedIn({
        page: sessionHolder.session.page,
        context: sessionHolder.session.context,
        config,
        logger,
      });
    }
    return sessionHolder.session;
  };

  const results: DocumentTextModeTenderResult[] = [];
  let reused = 0;
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let notReady = 0;
  try {
    await ensureChatGptLoggedIn({
      page: sessionHolder.session!.page,
      context: sessionHolder.session!.context,
      config,
      logger,
    });

    for (const target of targets) {
      const displayId = `T247-${target.tenderId}`;
      try {
        const inspection = inspectQualificationState({
          dateFolder,
          tenderId: target.tenderId,
        });
        logQualificationStateInspection(target.tenderId, inspection, logger);
        if (inspection.validResponse) {
          reused += 1;
          log(logger, `CHATGPT_QUALIFICATION_REUSED_EXISTING=true`);
          results.push({
            tenderId: displayId,
            status: inspection.qualificationStatus ?? "VERIFY",
            reason: "reused existing valid qualification",
            resultPath: inspection.resultPath ?? null,
            supabaseOk: true,
            error: null,
          });
          continue;
        }
        if (
          inspection.status === "PENDING" ||
          hasPendingExistingConversation(
            loadChatGptTenderState(target.tenderFolder),
          )
        ) {
          pending += 1;
          log(logger, "CHATGPT_PENDING_RECOVERY_REQUIRED=true");
          log(logger, "WAITING_FOR_CHATGPT_RATE_SLOT=false");
          results.push({
            tenderId: displayId,
            status: null,
            reason: "PENDING_EXISTING_CONVERSATION",
            resultPath: null,
            supabaseOk: false,
            error: null,
          });
          continue;
        }
        if (!findTenderAllDocumentsZip(target.tenderFolder)) {
          notReady += 1;
          results.push({
            tenderId: displayId,
            status: null,
            reason: null,
            resultPath: null,
            supabaseOk: false,
            error: "NOT_READY_MISSING_ZIP",
          });
          continue;
        }

        // Acquire rolling 65/3h slot before opening ChatGPT tab; release browser on long wait.
        await awaitDetailChatGptSubmissionSlot({
          logger,
          onWaitRequired: async (decision) => {
            log(
              logger,
              `GPT_WAITING_RATE_SLOT=true next=${decision.nextSlotAt}`,
            );
            if (sessionHolder.session) {
              await closeChatGptSession(sessionHolder.session).catch(
                () => undefined,
              );
              sessionHolder.session = null;
              log(logger, "CHATGPT_BROWSER_CLOSED_FOR_RATE_WAIT=true");
            }
          },
        });

        const session = await ensureSession();
        log(logger, `DOCUMENT_TEXT_TARGET_SOURCE=${target.source}`);
        const page = await openFreshTenderPage({
          context: session.context,
          config,
          logger,
          workerId: 0,
          sourceTenderId: target.tenderId,
        });
        const result = await qualifyTenderDocumentTextMode({
          page,
          tenderFolder: target.tenderFolder,
          tenderId: target.tenderId,
          config,
          logger,
        });
        results.push(result);
        if (result.status && !result.error) completed += 1;
        else failed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`DOCUMENT_TEXT_MODE_FAILED=${displayId} ${message}`);
        failed += 1;
        results.push({
          tenderId: displayId,
          status: null,
          reason: null,
          resultPath: null,
          supabaseOk: false,
          error: message,
        });
        if (!config.chatgptContinueOnError) {
          throw error;
        }
      }
    }
  } finally {
    if (sessionHolder.session) {
      await closeChatGptSession(sessionHolder.session).catch(() => undefined);
    }
  }

  const readyTotal = targets.length;
  const remaining =
    readyTotal - reused - completed - failed - pending - notReady;
  log(logger, `GPT_READY_TOTAL=${readyTotal}`);
  log(logger, `GPT_REUSED_EXISTING_VALID=${reused}`);
  log(logger, `GPT_NEW_REQUIRED=${readyTotal - reused - pending - notReady}`);
  log(logger, `GPT_COMPLETED_THIS_RUN=${completed}`);
  log(logger, `GPT_FAILED_THIS_RUN=${failed}`);
  log(logger, `GPT_PENDING=${pending}`);
  log(logger, `GPT_QUEUED_REMAINING=${Math.max(0, remaining)}`);
  if (remaining !== 0) {
    logger.warn(
      `GPT_QUEUE_RECONCILIATION_FAILED ready=${readyTotal} reused=${reused} completed=${completed} failed=${failed} pending=${pending} notReady=${notReady} remaining=${remaining}`,
    );
  }
  const rate = await readDetailRateSnapshot();
  log(logger, `CHATGPT_RATE_LIMIT_SAFETY_MAX=${rate.used + rate.available}`);
  log(logger, `CHATGPT_ROLLING_WINDOW_USED=${rate.used}`);
  log(logger, `CHATGPT_ROLLING_WINDOW_AVAILABLE=${rate.available}`);
  if (rate.nextSlotAt) {
    log(logger, `CHATGPT_NEXT_RATE_SLOT_AT=${rate.nextSlotAt}`);
  }

  const allOk = results.every(
    (r) => (r.status && !r.error) || r.reason === "PENDING_EXISTING_CONVERSATION",
  );
  if (allOk) {
    log(logger, "DOCUMENT_TEXT_MODE_TEST_COMPLETE=true");
  } else {
    log(logger, "DOCUMENT_TEXT_MODE_TEST_COMPLETE=false");
  }
  return { results, complete: allOk };
}
