import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import { ensureDir, screenshotDirForToday } from "../fileUtils.js";
import { getLocalTimestamp } from "../dateUtils.js";
import type { Logger } from "../logger.js";
import {
  findProjectComposerPlusButton,
  getProjectComposerLocator,
} from "./openProject.js";
import { assertRequiredAttachmentsReady } from "./sourceDocumentResolver.js";
import {
  getSharedChatGptSubmissionScheduler,
} from "../concurrency/chatGptSubmissionScheduler.js";
import {
  awaitDetailChatGptSubmissionSlot,
  recordDetailSubmission,
} from "./chatgptDetailSubmissionLedger.js";
import type { Tender247ExpectedManifest } from "./tender247AttachmentManifest.js";
import {
  STABLE_ATTACHMENT_POLL_MS,
  evaluateAttachmentStabilityPoll,
} from "./tender247AttachmentUploadState.js";
import {
  COMPOSER_TOKEN_ATTR,
  discoverComposerAttachments,
  resolveComposerShell,
} from "./composerShellAttachments.js";
import {
  clearCurrentComposer,
  ensureCleanComposerForNewTender,
} from "./clearCurrentComposer.js";
import {
  getResponseStallTimeoutMsFromEnv,
  isResponseActivityStalled,
  mayNavigateAwayDuringResponseWait,
  updateLastResponseActivityAt,
  type ResponseActivitySnapshot,
} from "./responseWaitPolicy.js";
import {
  createJsonStabilityState,
  getPostJsonUiGraceMs,
  tickCanonicalJsonStability,
  tryParseCanonicalQualificationJson,
} from "./canonicalJsonCompletion.js";
import { tickScreeningJsonStability } from "../runScreening/screeningJsonCompletion.js";
import {
  inspectionToActivitySnapshot,
  inspectLatestAssistantBounded,
  isRateLimitVisibleImmediate,
  RESPONSE_INSPECT_TIMEOUT_MS,
} from "./immediateResponseInspect.js";
import type { AppConfig } from "../config.js";
import {
  countAssistantMessages,
  isScreeningGenerationActive,
  logScreeningScanDiagnostics,
  scanGeneratedScreeningOutput,
} from "./assistantSpreadsheetAttachment.js";
import {
  assertRunExcelScreeningPreSend,
  assertTenderQualificationPreSend,
  findRunWorkbookMatches,
  isRunWorkbookFileName,
  type ChatGptSubmissionKind,
} from "./chatgptSubmissionKind.js";

export type { ChatGptSubmissionKind } from "./chatgptSubmissionKind.js";

export { COMPOSER_TOKEN_ATTR } from "./composerShellAttachments.js";
export {
  clearCurrentComposer,
  ensureCleanComposerForNewTender,
  ensureFreshWorkerComposer,
  recoverFreshComposer,
} from "./clearCurrentComposer.js";
export {
  tryParseCanonicalQualificationJson,
  tickCanonicalJsonStability,
  getPostJsonUiGraceMs,
} from "./canonicalJsonCompletion.js";

export function isConversationUrl(url: string): boolean {
  return /\/c\/[^/?#]+/i.test(url);
}

const RATE_LIMIT_TEXT_RE =
  /Too many requests|temporarily limited access|making requests too quickly/i;

/** Click Got it at most once per modal appearance (per page). */
const rateLimitModalDismissedByPage = new WeakMap<object, boolean>();

/**
 * Detect / dismiss ChatGPT "Too many requests" modal.
 * Returns true when the rate-limit UI is present.
 * Dismissing the modal does NOT clear the restriction — callers must pause.
 */
export async function handleRateLimitModal(
  page: Page,
  logger?: Logger,
): Promise<boolean> {
  const dialogModal = page
    .getByRole("dialog")
    .filter({
      hasText: /Too many requests|temporarily limited access/i,
    })
    .last();

  let modalVisible = await dialogModal
    .isVisible({ timeout: 500 })
    .catch(() => false);
  let useDialogScope = modalVisible;

  if (!modalVisible) {
    // Fallback: text may render outside a role=dialog
    const banner = page.getByText(RATE_LIMIT_TEXT_RE).first();
    modalVisible = await banner.isVisible({ timeout: 500 }).catch(() => false);
  }

  if (!modalVisible) {
    rateLimitModalDismissedByPage.set(page, false);
    return false;
  }

  logger?.warn("CHATGPT_RATE_LIMIT_DETECTED");
  // Account-level — pause ALL GPT workers (uploads + Send).
  try {
    const { tripGlobalChatGptRateLimit } = await import(
      "./globalChatGptRateLimit.js"
    );
    tripGlobalChatGptRateLimit({
      logger,
      reason: "too_many_requests_ui",
    });
  } catch {
    // ignore dynamic import failures in odd test harnesses
  }

  if (!rateLimitModalDismissedByPage.get(page)) {
    let clicked = false;

    if (useDialogScope) {
      const gotItButton = dialogModal.getByRole("button", {
        name: /^Got it$/i,
      });
      if (await gotItButton.isVisible().catch(() => false)) {
        await gotItButton.click({ timeout: 5_000 }).catch(() => undefined);
        clicked = true;
      }
    }

    if (!clicked) {
      const roleButton = page.getByRole("button", { name: /^Got it$/i }).last();
      if (await roleButton.isVisible().catch(() => false)) {
        await roleButton.click({ timeout: 5_000 }).catch(() => undefined);
        clicked = true;
      }
    }

    if (!clicked) {
      const fallbackButton = page
        .locator("button")
        .filter({ hasText: /^Got it$/i })
        .filter({ visible: true })
        .last();
      if (await fallbackButton.isVisible().catch(() => false)) {
        await fallbackButton.click({ timeout: 5_000 }).catch(() => undefined);
        clicked = true;
      }
    }

    if (clicked) {
      rateLimitModalDismissedByPage.set(page, true);
      logger?.info("CHATGPT_RATE_LIMIT_MODAL_DISMISSED");
      await page.waitForTimeout(500);
    }
  }

  // Modal dismissed ≠ restriction cleared
  return true;
}

/**
 * @deprecated Prefer handleRateLimitModal. stillLimited is always true when detected
 * because dismissing the popup does not clear the rate limit.
 */
export async function detectAndDismissRateLimit(
  page: Page,
  logger?: Logger,
): Promise<{ detected: boolean; stillLimited: boolean }> {
  const detected = await handleRateLimitModal(page, logger);
  return { detected, stillLimited: detected };
}

/** Throws CHATGPT_RATE_LIMITED when the rate-limit modal is (or was) present. */
export async function assertNotRateLimited(
  page: Page,
  logger?: Logger,
): Promise<void> {
  if (await handleRateLimitModal(page, logger)) {
    throw new AutomationError(
      "CHATGPT_RATE_LIMITED",
      "ChatGPT temporarily limited requests",
    );
  }
}

/**
 * Find a completed assistant answer that embeds the current tender ID.
 * Used when user-message DOM is virtualized / covered by a modal.
 */
export async function findAssistantAnswerForTender(
  page: Page,
  expectedT247Id: string,
): Promise<string | null> {
  const assistants = page.locator('[data-message-author-role="assistant"]');
  const count = await assistants.count().catch(() => 0);
  const idPatterns = [
    new RegExp(`"t247Id"\\s*:\\s*"${expectedT247Id}"`, "i"),
    new RegExp(`"t247Id"\\s*:\\s*"T247-${expectedT247Id}"`, "i"),
    new RegExp(`T247-${expectedT247Id}`, "i"),
  ];
  const statusRe =
    /"status"\s*:\s*"(GO|CONDITIONAL_GO|PARTNER_BID|VERIFY|NO_GO|WILL_BID|NO_BID|PARTNERSHIP|MAY_BID)"/i;

  for (let i = count - 1; i >= 0; i -= 1) {
    const text = await getAssistantMessageTextAt(page, i);
    if (!text.trim()) {
      continue;
    }
    const hasId = idPatterns.some((re) => re.test(text));
    if (hasId && statusRe.test(text)) {
      return text;
    }
  }

  // Also scan visible page text as a last resort (virtualized messages)
  const bodyText = (await page.locator("main").innerText().catch(() => "")) || "";
  if (
    idPatterns.some((re) => re.test(bodyText)) &&
    statusRe.test(bodyText)
  ) {
    // Prefer extracting a JSON-looking slice containing the id
    const start = bodyText.lastIndexOf("{");
    const end = bodyText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = bodyText.slice(start, end + 1);
      if (
        idPatterns.some((re) => re.test(slice)) &&
        statusRe.test(slice)
      ) {
        return slice;
      }
    }
  }

  return null;
}

export interface PreparedTenderUploads {
  metadataSourcePath: string;
  aiSummarySourcePath: string | null;
  documentsSourcePath: string;
  metadataUploadPath: string;
  aiSummaryUploadPath: string | null;
  documentsUploadPath: string;
  metadataSha256: string;
  aiSummarySha256: string | null;
  documentsSha256: string;
  aiSummaryAvailable: boolean;
  uploadPaths: string[];
  /** OS temp dir if copies were made; null when uploading originals directly */
  tempDir: string | null;
}

/**
 * Prepare ChatGPT upload sources for a tender.
 * Uploads original files from the tender folder (no .gpt-upload under downloads).
 * Identity is proven via absolute path + T247-{ID} folder + SHA-256.
 */
export function prepareTenderSpecificUploadFiles(options: {
  t247Id: string;
  tenderFolder: string;
  metadataPath: string;
  aiSummaryPath: string | null;
  documentZipPath: string;
  logger: Logger;
}): PreparedTenderUploads {
  const { t247Id, logger } = options;
  const marker = `T247-${t247Id}`;
  const metadataSourcePath = path.resolve(options.metadataPath);
  const documentsSourcePath = path.resolve(options.documentZipPath);
  const aiSummarySourcePath = options.aiSummaryPath
    ? path.resolve(options.aiSummaryPath)
    : null;

  const metaOk =
    metadataSourcePath.toLowerCase().includes(marker.toLowerCase()) ||
    /[/\\]metadata\.json$/i.test(metadataSourcePath);
  if (!metaOk) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_SOURCE_MISMATCH",
      `Metadata path does not belong to ${marker}: ${metadataSourcePath}`,
    );
  }
  const docsOk =
    documentsSourcePath.toLowerCase().includes(marker.toLowerCase()) ||
    /Tender[_\s-]*All[_\s-]*Documents/i.test(
      path.basename(documentsSourcePath),
    ) ||
    /\.zip$/i.test(documentsSourcePath);
  if (!docsOk) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_SOURCE_MISMATCH",
      `Documents ZIP path does not belong to ${marker}: ${documentsSourcePath}`,
    );
  }
  if (
    aiSummarySourcePath &&
    !aiSummarySourcePath.toLowerCase().includes(marker.toLowerCase()) &&
    !/AI[_\s-]*Summary\.pdf$/i.test(path.basename(aiSummarySourcePath))
  ) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_SOURCE_MISMATCH",
      `AI Summary path does not belong to ${marker}: ${aiSummarySourcePath}`,
    );
  }

  logger.info(`CHATGPT_UPLOAD_SOURCE_METADATA=${metadataSourcePath}`);
  if (aiSummarySourcePath) {
    logger.info(`CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=${aiSummarySourcePath}`);
  } else {
    logger.info("CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=NOT_AVAILABLE");
    logger.info(`CHATGPT_AI_SUMMARY_NOT_AVAILABLE=${marker}`);
  }
  logger.info(`CHATGPT_UPLOAD_SOURCE_DOCUMENTS=${documentsSourcePath}`);

  const metadataSha256 = sha256File(metadataSourcePath);
  const documentsSha256 = sha256File(documentsSourcePath);
  const aiSummarySha256 = aiSummarySourcePath
    ? sha256File(aiSummarySourcePath)
    : null;
  logger.info(`CHATGPT_UPLOAD_METADATA_SHA256=${metadataSha256}`);
  if (aiSummarySha256) {
    logger.info(`CHATGPT_UPLOAD_AI_SUMMARY_SHA256=${aiSummarySha256}`);
  }
  logger.info(`CHATGPT_UPLOAD_DOCUMENTS_SHA256=${documentsSha256}`);

  // Upload originals directly — ChatGPT may display AI_Summary(2).pdf etc.
  const uploadPaths = [metadataSourcePath];
  if (aiSummarySourcePath) {
    uploadPaths.push(aiSummarySourcePath);
  }
  uploadPaths.push(documentsSourcePath);

  return {
    metadataSourcePath,
    aiSummarySourcePath,
    documentsSourcePath,
    metadataUploadPath: metadataSourcePath,
    aiSummaryUploadPath: aiSummarySourcePath,
    documentsUploadPath: documentsSourcePath,
    metadataSha256,
    aiSummarySha256,
    documentsSha256,
    aiSummaryAvailable: Boolean(aiSummarySourcePath),
    uploadPaths,
    tempDir: null,
  };
}

/**
 * Prepare ChatGPT upload sources for partial-evidence Tender247 runs.
 * Only validates and hashes paths that are actually present.
 */
export function preparePartialTenderUploadFiles(options: {
  t247Id: string;
  tenderFolder: string;
  metadataPath: string | null;
  aiSummaryPath: string | null;
  documentZipPath: string | null;
  logger: Logger;
}): PreparedTenderUploads {
  const { t247Id, logger } = options;
  const marker = `T247-${t247Id}`;
  const metadataSourcePath = options.metadataPath
    ? path.resolve(options.metadataPath)
    : null;
  const documentsSourcePath = options.documentZipPath
    ? path.resolve(options.documentZipPath)
    : null;
  const aiSummarySourcePath = options.aiSummaryPath
    ? path.resolve(options.aiSummaryPath)
    : null;

  if (
    !metadataSourcePath &&
    !documentsSourcePath &&
    !aiSummarySourcePath
  ) {
    throw new AutomationError(
      "CHATGPT_NO_QUALIFICATION_EVIDENCE",
      `No upload sources for ${marker}`,
    );
  }

  if (metadataSourcePath) {
    const metaOk =
      metadataSourcePath.toLowerCase().includes(marker.toLowerCase()) ||
      /[/\\]metadata\.json$/i.test(metadataSourcePath);
    if (!metaOk) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_SOURCE_MISMATCH",
        `Metadata path does not belong to ${marker}: ${metadataSourcePath}`,
      );
    }
    logger.info(`CHATGPT_UPLOAD_SOURCE_METADATA=${metadataSourcePath}`);
  }

  if (documentsSourcePath) {
    const docsOk =
      documentsSourcePath.toLowerCase().includes(marker.toLowerCase()) ||
      /Tender[_\s-]*All[_\s-]*Documents/i.test(
        path.basename(documentsSourcePath),
      ) ||
      /\.zip$/i.test(documentsSourcePath);
    if (!docsOk) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_SOURCE_MISMATCH",
        `Documents ZIP path does not belong to ${marker}: ${documentsSourcePath}`,
      );
    }
    logger.info(`CHATGPT_UPLOAD_SOURCE_DOCUMENTS=${documentsSourcePath}`);
  }

  if (aiSummarySourcePath) {
    if (
      !aiSummarySourcePath.toLowerCase().includes(marker.toLowerCase()) &&
      !/AI[_\s-]*Summary\.pdf$/i.test(path.basename(aiSummarySourcePath))
    ) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_SOURCE_MISMATCH",
        `AI Summary path does not belong to ${marker}: ${aiSummarySourcePath}`,
      );
    }
    logger.info(`CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=${aiSummarySourcePath}`);
  } else {
    logger.info("CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=NOT_AVAILABLE");
    logger.info(`CHATGPT_AI_SUMMARY_NOT_AVAILABLE=${marker}`);
  }

  const metadataSha256 = metadataSourcePath
    ? sha256File(metadataSourcePath)
    : null;
  const documentsSha256 = documentsSourcePath
    ? sha256File(documentsSourcePath)
    : null;
  const aiSummarySha256 = aiSummarySourcePath
    ? sha256File(aiSummarySourcePath)
    : null;
  if (metadataSha256) {
    logger.info(`CHATGPT_UPLOAD_METADATA_SHA256=${metadataSha256}`);
  }
  if (aiSummarySha256) {
    logger.info(`CHATGPT_UPLOAD_AI_SUMMARY_SHA256=${aiSummarySha256}`);
  }
  if (documentsSha256) {
    logger.info(`CHATGPT_UPLOAD_DOCUMENTS_SHA256=${documentsSha256}`);
  }

  const uploadPaths: string[] = [];
  if (metadataSourcePath) uploadPaths.push(metadataSourcePath);
  if (aiSummarySourcePath) uploadPaths.push(aiSummarySourcePath);
  if (documentsSourcePath) uploadPaths.push(documentsSourcePath);

  return {
    metadataSourcePath: metadataSourcePath ?? "",
    aiSummarySourcePath,
    documentsSourcePath: documentsSourcePath ?? "",
    metadataUploadPath: metadataSourcePath ?? "",
    aiSummaryUploadPath: aiSummarySourcePath,
    documentsUploadPath: documentsSourcePath ?? "",
    metadataSha256: metadataSha256 ?? "",
    aiSummarySha256,
    documentsSha256: documentsSha256 ?? "",
    aiSummaryAvailable: Boolean(aiSummarySourcePath),
    uploadPaths,
    tempDir: null,
  };
}

/** Remove a per-tender OS temp upload directory if one was created. */
export function cleanupTenderTempUpload(
  tempDir: string | null | undefined,
  logger?: Logger,
): void {
  if (!tempDir) {
    return;
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    logger?.info("CHATGPT_TEMP_UPLOAD_CLEANED");
  } catch (error) {
    logger?.warn(
      `CHATGPT_TEMP_UPLOAD_CLEANUP_FAILED=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Delete stale .gpt-upload folders under each T247-* tender day folder. */
export function cleanupStaleGptUploadFolders(
  dateFolder: string,
  logger: Logger,
): void {
  if (!fs.existsSync(dateFolder)) {
    return;
  }
  let removed = 0;
  for (const name of fs.readdirSync(dateFolder)) {
    if (!/^T247-\d+$/i.test(name)) {
      continue;
    }
    const gptUpload = path.join(dateFolder, name, ".gpt-upload");
    if (!fs.existsSync(gptUpload)) {
      continue;
    }
    try {
      fs.rmSync(gptUpload, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      logger.warn(
        `Failed to remove ${gptUpload}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (removed > 0) {
    logger.info(`CHATGPT_STALE_GPT_UPLOAD_REMOVED count=${removed}`);
  }
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Upload files into the ChatGPT Project Home composer (does not upload the master PDF).
 * Click project composer +, then prefer direct file input; fall back to filechooser.
 */
export type TenderUploadSession = {
  filesAssigned: boolean;
  uploadAttemptCount: number;
  attachmentsLocked: boolean;
};

export function createTenderUploadSession(): TenderUploadSession {
  return { filesAssigned: false, uploadAttemptCount: 0, attachmentsLocked: false };
}

/** Hard guard: after ATTACHMENTS_LOCKED, refuse upload/clear mutations. */
export function assertAttachmentsUnlocked(
  session: TenderUploadSession,
  action: string,
): void {
  if (session.attachmentsLocked) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_BLOCKED_LOCKED",
      `CHATGPT_UPLOAD_BLOCKED_LOCKED=true action=${action} — attachmentsLocked=true; refusing ${action}`,
    );
  }
}

export async function uploadFilesToComposer(options: {
  page: Page;
  filePaths: string[];
  logger: Logger;
  batchSize?: number;
  /** Optional overall upload wait budget (chips/settle); separate from response timeout */
  timeoutMs?: number;
  /** When set, require tender-prefixed attachment chips after upload */
  t247Id?: string;
  /** Whether AI Summary was included in this upload */
  expectAiSummary?: boolean;
  /** Per-tender upload session — mutated to prevent duplicate uploads */
  session?: TenderUploadSession;
  /** When true, never reuse a prior draft — always assign files */
  forceFreshUpload?: boolean;
  /** Archive basename for BidAssist / Tender247 chip matching */
  expectedArchiveFileName?: string;
  /** Hard cap for Tender247 top-level attachments (metadata + optional AI + zip). */
  expectedAttachmentCount?: number;
  composerToken?: string;
  tender247Manifest?: Tender247ExpectedManifest;
}): Promise<TenderUploadSession> {
  const { page, logger, t247Id } = options;
  const batchSize = Math.max(1, options.batchSize ?? 10);
  const expectAiSummary = options.expectAiSummary ?? false;
  const session = options.session ?? createTenderUploadSession();
  const forceFreshUpload = options.forceFreshUpload === true;
  const expectedArchiveFileName = options.expectedArchiveFileName;
  const expectedAttachmentCount = options.expectedAttachmentCount;

  await assertNotRateLimited(page, logger);

  logger.info("CHATGPT_UPLOAD_START");

  try {
    const { isGlobalChatGptRateLimited } = await import(
      "./globalChatGptRateLimit.js"
    );
    if (isGlobalChatGptRateLimited()) {
      throw new AutomationError(
        "CHATGPT_RATE_LIMITED",
        "Global ChatGPT rate limit active — upload paused",
      );
    }
  } catch (error) {
    if (error instanceof AutomationError && error.code === "CHATGPT_RATE_LIMITED") {
      throw error;
    }
  }

  const validFiles = await validateUploadFiles(options.filePaths, logger);
  try {
    const { recordGlobalUploadAttempt } = await import(
      "./globalChatGptRateLimit.js"
    );
    recordGlobalUploadAttempt(validFiles.length);
  } catch {
    // non-fatal accounting
  }
  if (
    typeof expectedAttachmentCount === "number" &&
    validFiles.length !== expectedAttachmentCount
  ) {
    throw new AutomationError(
      "CHATGPT_ATTACHMENT_SET_INVALID",
      `CHATGPT_ATTACHMENT_SET_INVALID=true CHATGPT_ATTACHMENT_COUNT=${validFiles.length} expected=${expectedAttachmentCount}`,
    );
  }
  if (
    typeof expectedAttachmentCount === "number" &&
    expectedAttachmentCount > 3
  ) {
    throw new AutomationError(
      "CHATGPT_ATTACHMENT_SET_INVALID",
      `CHATGPT_ATTACHMENT_SET_INVALID=true CHATGPT_ATTACHMENT_COUNT=${expectedAttachmentCount}`,
    );
  }
  logger.info(`CHATGPT_UPLOAD_FILES_COUNT=${validFiles.length}`);
  for (const filePath of validFiles) {
    logger.info(`CHATGPT_UPLOAD_FILE=${path.basename(filePath)}`);
  }

  try {
    if (session.attachmentsLocked) {
      assertAttachmentsUnlocked(session, "uploadFilesToComposer");
    }
    if (t247Id && !forceFreshUpload) {
      const draft = await inspectComposerDraft(page, t247Id, logger);
      if (draft.isStaleOtherTender) {
        logger.warn(
          `CHATGPT_STALE_DRAFT_OTHER_TENDER=${draft.draftTenderId || "unknown"} — clearing`,
        );
        await clearComposerDraft(page, logger);
      } else if (draft.isCurrentTenderDraft && draft.hasAttachments) {
        // Only reuse when live chips match the files we intend to upload
        const presence = await detectComposerAttachments(page, {
          expectedArchiveFileName:
            expectedArchiveFileName ||
            path.basename(
              validFiles.find((f) => /\.zip$/i.test(f)) || "",
            ),
        });
        const metaOk =
          !validFiles.some((f) => /metadata\.json$/i.test(path.basename(f))) ||
          presence.metadataAttached;
        const zipOk =
          !validFiles.some((f) => /\.zip$/i.test(path.basename(f))) ||
          presence.documentsAttached;
        const aiOk =
          !expectAiSummary || presence.aiSummaryAttached;
        if (metaOk && zipOk && aiOk) {
          logger.info("CHATGPT_EXISTING_DRAFT_DETECTED");
          logger.info("CHATGPT_EXISTING_ATTACHMENTS_REUSED");
          session.filesAssigned = true;
          await dismissDuplicateUploadDialog(page, logger);
          await waitForAttachmentChips(page, validFiles, logger, session, t247Id);
          const metadataRequired = validFiles.some((f) =>
            /metadata\.json$/i.test(path.basename(f)),
          );
          const tenderArchiveRequired = validFiles.some((f) =>
            /\.zip$/i.test(path.basename(f)),
          );
          await assertTenderAttachmentsVerified(page, t247Id, logger, {
            expectAiSummary,
            expectedArchiveFileName,
            metadataRequired,
            tenderArchiveRequired,
          });
          await waitForSendEnabled(page, logger);
          logger.info("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");
          logger.info("CHATGPT_ALL_ATTACHMENTS_READY");
          logger.info("CHATGPT_UPLOAD_COMPLETE");
          return session;
        }
        logger.warn(
          "CHATGPT_EXISTING_DRAFT_INCOMPLETE — clearing and uploading fresh files",
        );
        await clearComposerDraft(page, logger);
      }
    } else if (forceFreshUpload) {
      // Pre-upload cleanup is the caller's responsibility — no re-assign here.
      logger.info("CHATGPT_FORCE_FRESH_UPLOAD=true");
    }

    if (session.attachmentsLocked) {
      assertAttachmentsUnlocked(session, "setInputFiles");
    } else if (session.filesAssigned || session.uploadAttemptCount >= 1) {
      logger.info(
        "CHATGPT_UPLOAD_SKIPPED_ALREADY_ASSIGNED — waiting for stable cards",
      );
      await dismissDuplicateUploadDialog(page, logger);
      if (options.tender247Manifest && options.composerToken) {
        await waitForStableComposerAttachments(page, {
          composerToken: options.composerToken,
          manifest: options.tender247Manifest,
          logger,
          // Attachment DOM validation — not the longer upload assign timeout.
          timeoutMs: getAttachmentValidationTimeoutMs(),
        });
      } else {
        await waitForAttachmentChips(page, validFiles, logger, session, t247Id, {
          composerToken: options.composerToken,
        });
      }
    } else {
      const batch = validFiles.slice(0, Math.min(batchSize, validFiles.length));
      logger.info(
        `CHATGPT_UPLOAD_BATCH start=1 end=${batch.length} total=${validFiles.length}`,
      );
      await assignFilesToComposer(page, batch, logger, session, {
        expectedArchiveFileName,
        composerToken: options.composerToken,
      });
      await dismissDuplicateUploadDialog(page, logger);
      if (options.tender247Manifest && options.composerToken) {
        await waitForStableComposerAttachments(page, {
          composerToken: options.composerToken,
          manifest: options.tender247Manifest,
          logger,
          timeoutMs: getAttachmentValidationTimeoutMs(),
        });
        session.attachmentsLocked = true;
        logger.info("CHATGPT_ATTACHMENTS_LOCKED=true");
        console.log("CHATGPT_ATTACHMENTS_LOCKED=true");
      } else {
        await waitForAttachmentChips(page, batch, logger, session, t247Id, {
          composerToken: options.composerToken,
        });
      }
      await waitForUploadsSettled(page, logger);
    }

    if (t247Id) {
      const metadataRequired = validFiles.some((f) =>
        /metadata\.json$/i.test(path.basename(f)),
      );
      const tenderArchiveRequired = validFiles.some((f) =>
        /\.zip$/i.test(path.basename(f)),
      );
      await assertTenderAttachmentsVerified(page, t247Id, logger, {
        expectAiSummary,
        expectedArchiveFileName,
        metadataRequired,
        tenderArchiveRequired,
      });
    }

    await waitForSendEnabled(page, logger);
    logger.info("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");
    logger.info("CHATGPT_ALL_ATTACHMENTS_READY");
    logger.info("CHATGPT_UPLOAD_COMPLETE");
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error(`CHATGPT_UPLOAD_FAILED=${message}`);
    if (stack) {
      logger.error(stack);
    }
    throw error instanceof AutomationError
      ? error
      : new AutomationError("CHATGPT_UPLOAD_FAILED", message);
  }
}

async function validateUploadFiles(
  filePaths: string[],
  logger: Logger,
): Promise<string[]> {
  const validFiles: string[] = [];
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    const base = path.basename(absolutePath).toLowerCase();
    const normalized = absolutePath.replace(/\\/g, "/");
    // Never upload company master PDF or outer T247-{ID}.zip
    if (
      base.includes("consolidated siyana") ||
      /^t247-\d+\.zip$/i.test(base)
    ) {
      logger.warn(
        `CHATGPT_UPLOAD_REJECTED_FORBIDDEN=${path.basename(absolutePath)}`,
      );
      continue;
    }
    if (/\/documents\/extracted\//i.test(normalized)) {
      logger.warn(
        `CHATGPT_UPLOAD_REJECTED_ZIP_CONTENT=${path.basename(absolutePath)}`,
      );
      continue;
    }
    if (
      /\/documents\//i.test(normalized) &&
      !/^tender_all_documents/i.test(base)
    ) {
      logger.warn(
        `CHATGPT_UPLOAD_REJECTED_INDIVIDUAL_DOC=${path.basename(absolutePath)}`,
      );
      continue;
    }
    try {
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile() || stat.size <= 0) {
        logger.warn(`CHATGPT_UPLOAD_FILE_INVALID=${absolutePath}`);
        continue;
      }
      validFiles.push(absolutePath);
    } catch {
      logger.warn(`CHATGPT_UPLOAD_FILE_INVALID=${absolutePath}`);
    }
  }

  if (validFiles.length === 0) {
    throw new AutomationError(
      "CHATGPT_NO_VALID_UPLOAD_FILES",
      "No valid non-empty files available for ChatGPT upload",
    );
  }
  return validFiles;
}

async function assignFilesToComposer(
  page: Page,
  files: string[],
  logger: Logger,
  session: TenderUploadSession,
  _options?: {
    expectedArchiveFileName?: string;
    composerToken?: string;
  },
): Promise<void> {
  void _options;
  assertAttachmentsUnlocked(session, "assignFilesToComposer/setInputFiles");
  if (session.filesAssigned || session.uploadAttemptCount >= 1) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_BLOCKED_SECOND_ATTEMPT",
      "CHATGPT_UPLOAD_BLOCKED_SECOND_ATTEMPT=true — files already assigned this tender",
    );
  }

  // Validate paths before clicking the UI
  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_FILE_INVALID",
        `Upload path missing or empty: ${absolutePath}`,
      );
    }
  }

  logger.info(`CHATGPT_FILES_ASSIGNED_COUNT=${files.length}`);
  console.log(`CHATGPT_FILES_ASSIGNED_COUNT=${files.length}`);

  // Prefer a direct composer file input when present (conversation chat overlay
  // often intercepts normal + button clicks).
  const directInput = page
    .locator('form input[type="file"], [data-testid*="composer" i] input[type="file"], input[type="file"]')
    .first();
  if (await directInput.count().catch(() => 0)) {
    try {
      await directInput.setInputFiles(files, { timeout: 8_000 });
      session.uploadAttemptCount += 1;
      session.filesAssigned = true;
      logger.info("CHATGPT_FILES_ASSIGNED_VIA_DIRECT_INPUT");
      logger.info("CHATGPT_FILES_ASSIGNED");
      console.log("CHATGPT_FILES_ASSIGNED_VIA_DIRECT_INPUT=true");
      await dismissDuplicateUploadDialog(page, logger);
      return;
    } catch (directError) {
      logger.warn(
        `CHATGPT_DIRECT_INPUT_UPLOAD_FAILED=${
          directError instanceof Error ? directError.message : String(directError)
        }`,
      );
    }
  }

  const plusButton =
    (await findProjectComposerPlusButton(page)) ||
    page.locator('[data-testid="composer-plus-btn"]').first();
  if (!plusButton) {
    throw new AutomationError(
      "CHATGPT_PLUS_BUTTON_MISSING",
      "Could not find the composer + / attach button",
    );
  }
  if (!(await plusButton.isVisible().catch(() => false))) {
    throw new AutomationError(
      "CHATGPT_PLUS_BUTTON_MISSING",
      "Composer + / attach button is not visible",
    );
  }

  logger.info("CHATGPT_PROJECT_PLUS_BUTTON_VISIBLE");
  await plusButton.scrollIntoViewIfNeeded().catch(() => undefined);
  await plusButton.click({ timeout: 8_000, force: true });
  await page.waitForTimeout(500);
  logger.info("CHATGPT_PLUS_MENU_OPENED");

  const addPhotosAndFiles = page
    .getByText(/Add photos\s*&\s*files/i)
    .or(page.getByText(/Upload from computer/i))
    .or(page.getByText(/Add files/i))
    .last();

  await addPhotosAndFiles
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => undefined);

  if (!(await addPhotosAndFiles.isVisible().catch(() => false))) {
    throw new AutomationError(
      "CHATGPT_ADD_FILES_MENU_MISSING",
      'Tools menu opened but "Add photos & files" was not found',
    );
  }

  const beforeFingerprints = await snapshotFileInputs(page);

  logger.info("CHATGPT_FILE_CHOOSER_WAIT_START");
  const chooserPromise = page.waitForEvent("filechooser", {
    timeout: 15_000,
  });

  await addPhotosAndFiles.click({ timeout: 8_000, force: true });

  try {
    const chooser = await chooserPromise;
    logger.info("CHATGPT_FILE_CHOOSER_OPENED");
    await chooser.setFiles(files);
    session.uploadAttemptCount += 1;
    session.filesAssigned = true;
    logger.info("CHATGPT_FILES_ASSIGNED_VIA_CHOOSER");
    logger.info("CHATGPT_FILES_ASSIGNED");
    await dismissDuplicateUploadDialog(page, logger);
    return;
  } catch (error) {
    logger.warn(
      `Filechooser wait failed after Add photos click: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const activeFileInput = await findActiveComposerFileInput(
    page,
    beforeFingerprints,
  );
  if (!activeFileInput) {
    const dismissed = await dismissDuplicateUploadDialog(page, logger);
    if (dismissed) {
      session.filesAssigned = true;
      return;
    }
    throw new AutomationError(
      "CHATGPT_FILE_INPUT_MISSING",
      "No filechooser and no newly active composer file input after Add photos & files",
    );
  }

  await activeFileInput.setInputFiles(files);
  session.uploadAttemptCount += 1;
  session.filesAssigned = true;
  logger.info("CHATGPT_FILES_ASSIGNED_VIA_INPUT");
  logger.info("CHATGPT_FILES_ASSIGNED");
  await dismissDuplicateUploadDialog(page, logger);
}

async function snapshotFileInputs(page: Page): Promise<string[]> {
  return page
    .locator('input[type="file"]')
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const el = node as HTMLInputElement;
        return [
          index,
          el.id || "",
          el.name || "",
          el.disabled ? "1" : "0",
          el.accept || "",
          el.multiple ? "1" : "0",
        ].join("|");
      }),
    )
    .catch(() => []);
}

async function findActiveComposerFileInput(
  page: Page,
  beforeFingerprints: string[],
): Promise<Locator | null> {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  if (count <= 0) {
    return null;
  }

  // Prefer a newly appeared input
  if (count > beforeFingerprints.length) {
    return inputs.nth(count - 1);
  }

  // Prefer a newly enabled / changed input near the composer
  const afterFingerprints = await snapshotFileInputs(page);
  for (let i = afterFingerprints.length - 1; i >= 0; i -= 1) {
    const after = afterFingerprints[i]!;
    const before = beforeFingerprints[i];
    if (before !== after) {
      return inputs.nth(i);
    }
  }

  // Last resort: last input near the project composer container (never blindly first)
  const composerScoped = page
    .locator(
      '[contenteditable="true"][aria-label*="New chat in"], [contenteditable="true"]#prompt-textarea',
    )
    .first()
    .locator('xpath=ancestor::*[.//input[@type="file"]][1]//input[@type="file"]')
    .last();

  if ((await composerScoped.count().catch(() => 0)) > 0) {
    return composerScoped;
  }

  return inputs.last();
}

/**
 * Dismiss ChatGPT duplicate-upload modal ("You've already uploaded this file")
 * and legacy "Upload anyway" prompts. Returns true if a dialog was handled.
 */
async function dismissDuplicateUploadDialog(
  page: Page,
  logger: Logger,
): Promise<boolean> {
  let dismissed = false;

  for (let i = 0; i < 6; i += 1) {
    const alreadyUploaded = page
      .getByText(/You've already uploaded this file/i)
      .first();
    if (await alreadyUploaded.isVisible().catch(() => false)) {
      const ok = page
        .getByRole("button", { name: /^OK$/i })
        .or(page.locator('button:has-text("OK")'))
        .first();
      await ok.click({ timeout: 5_000 }).catch(() => undefined);
      logger.info("CHATGPT_DUPLICATE_UPLOAD_MODAL_DISMISSED");
      dismissed = true;
      await page.waitForTimeout(400);
      continue;
    }

    const uploadAnyway = page
      .getByRole("button", { name: /^Upload anyway$/i })
      .or(page.getByText(/^Upload anyway$/i))
      .first();
    if (await uploadAnyway.isVisible().catch(() => false)) {
      await uploadAnyway.click({ timeout: 5_000 }).catch(() => undefined);
      logger.info("CHATGPT_UPLOAD_ANYWAY_CLICKED");
      dismissed = true;
      await page.waitForTimeout(400);
      continue;
    }

    break;
  }

  return dismissed;
}

/** Strip ChatGPT display suffixes: metadata(3).json / metadata(20260812-084008).json → metadata.json */
export function normalizeAttachmentName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\([^)]*\)(?=\.[^.]+$)/, "")
    .toLowerCase();
}

export type ComposerAttachmentPresence = {
  metadataAttached: boolean;
  aiSummaryAttached: boolean;
  documentsAttached: boolean;
  visibleCardCount: number;
  candidates: string[];
  signals: string[];
};

/**
 * Visible Project composer editor (not used as the attachment scope).
 */
export function getComposerEditor(page: Page): Locator {
  return page
    .locator(
      '[contenteditable="true"], textarea, .ProseMirror, #prompt-textarea',
    )
    .filter({ visible: true })
    .last();
}

/**
 * Complete composer form/wrapper: attachments + editor + plus + Send.
 * Prefer resolveComposerShell — this is a sync-ish locator fallback.
 */
export function getActiveComposerContainer(page: Page): Locator {
  const editor = getComposerEditor(page);
  const form = editor.locator("xpath=ancestor::form[1]");
  const withSend = editor.locator(
    'xpath=ancestor::*[.//button[@data-testid="send-button"] or .//button[contains(translate(@aria-label,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"send")]][1]',
  );
  const withButtons = editor.locator(
    "xpath=ancestor::*[.//button][count(.//button)>=2][1]",
  );
  // Prefer broader ancestors so sibling attachment rows are included.
  return withSend.or(form).or(withButtons).first();
}

async function isVisibleText(page: Page, pattern: RegExp): Promise<boolean> {
  const candidates = page.getByText(pattern);
  const count = await candidates.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    if (
      await candidates
        .nth(i)
        .isVisible()
        .catch(() => false)
    ) {
      return true;
    }
  }
  return false;
}

async function isVisibleTextInLocator(
  root: Locator,
  pattern: RegExp,
): Promise<boolean> {
  const candidates = root.getByText(pattern);
  const count = await candidates.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    if (
      await candidates
        .nth(i)
        .isVisible()
        .catch(() => false)
    ) {
      return true;
    }
  }
  return false;
}

async function collectAttrCandidatesInLocator(root: Locator): Promise<string[]> {
  return root
    .locator("[title], [aria-label]")
    .evaluateAll((nodes) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const node of nodes) {
        const el = node as HTMLElement;
        for (const value of [
          el.getAttribute("title") || "",
          el.getAttribute("aria-label") || "",
        ]) {
          const trimmed = value.replace(/\s+/g, " ").trim();
          if (!trimmed || seen.has(trimmed)) {
            continue;
          }
          if (/^remove file\b/i.test(trimmed) || /^delete file\b/i.test(trimmed)) {
            continue;
          }
          seen.add(trimmed);
          out.push(trimmed);
        }
      }
      return out;
    })
    .catch(() => [] as string[]);
}

async function collectPageAttrCandidates(page: Page): Promise<string[]> {
  return page
    .locator("[title], [aria-label]")
    .evaluateAll((nodes) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const node of nodes) {
        const el = node as HTMLElement;
        for (const value of [
          el.getAttribute("title") || "",
          el.getAttribute("aria-label") || "",
        ]) {
          const trimmed = value.replace(/\s+/g, " ").trim();
          if (!trimmed || seen.has(trimmed)) {
            continue;
          }
          if (/^remove file\b/i.test(trimmed) || /^delete file\b/i.test(trimmed)) {
            continue;
          }
          seen.add(trimmed);
          out.push(trimmed);
        }
      }
      return out;
    })
    .catch(() => [] as string[]);
}

const UPLOAD_LIMIT_WARNING_RE =
  /You can upload up to 20 files at a time/i;

/** Detect ChatGPT's 20-file upload warning in the composer. */
export async function detectUploadLimitWarning(page: Page): Promise<boolean> {
  return page
    .getByText(UPLOAD_LIMIT_WARNING_RE)
    .first()
    .isVisible()
    .catch(() => false);
}

/** Parse filename from ChatGPT Remove-file button aria-label. */
export function parseRemoveFileButtonLabel(ariaLabel: string): string | null {
  const trimmed = ariaLabel.replace(/\s+/g, " ").trim();
  const match = trimmed.match(
    /(?:Remove|Delete)\s+file(?:\s+\d+)?:?\s*(.+)$/i,
  );
  return match?.[1]?.trim() || null;
}

/** Drop Remove-file labels from attachment name lists. */
export function filterComposerAttachmentDisplayNames(names: string[]): string[] {
  return names
    .map((name) => name.trim())
    .filter((name) => name && !/^(?:Remove|Delete)\s+file\b/i.test(name));
}

export type ComposerAttachmentCountSnapshot = {
  pageCount: number;
  /** @deprecated Structural Remove-button count — diagnostics only. */
  composerCount: number;
  displayedNames: string[];
  /** Authoritative logical attachment count for expected types. */
  logicalAttachmentCount: number;
  logicalMetadata: boolean;
  logicalAiSummary: boolean;
  logicalDocumentsZip: boolean;
  structuralRemoveButtonCount: number;
};

async function resolveComposerRoot(
  page: Page,
  composerToken?: string,
): Promise<Locator> {
  const resolution = await resolveComposerShell(page, { composerToken });
  if (resolution.shellFound) {
    return resolution.shell;
  }
  if (composerToken) {
    const marked = page.locator(
      `[${COMPOSER_TOKEN_ATTR}="${composerToken}"]`,
    );
    if ((await marked.count().catch(() => 0)) > 0) {
      return marked.first();
    }
  }
  return getActiveComposerContainer(page);
}

/** Page-wide attachment-like controls (debug only — not authoritative). */
export async function countPageAttachmentCards(page: Page): Promise<number> {
  return page
    .locator(
      'button[aria-label*="Remove file" i], button[aria-label*="Delete file" i]',
    )
    .filter({ visible: true })
    .count()
    .catch(() => 0);
}

/**
 * Count / discover attachments scoped to composerShell.
 * Logical filenames are authoritative; Remove-button count is diagnostic.
 */
export async function countComposerAttachmentCards(
  page: Page,
  options?: { composerToken?: string; aiSummaryRequired?: boolean },
): Promise<ComposerAttachmentCountSnapshot> {
  const pageCount = await countPageAttachmentCards(page);
  const discovered = await discoverComposerAttachments(page, {
    composerToken: options?.composerToken,
    aiSummaryRequired: options?.aiSummaryRequired,
  });

  const matching =
    typeof options?.aiSummaryRequired === "boolean"
      ? discovered.matchingExpectedCount
      : discovered.logicalAttachmentCount;

  return {
    pageCount,
    composerCount: matching,
    displayedNames: filterComposerAttachmentDisplayNames(discovered.filenames),
    logicalAttachmentCount: matching,
    logicalMetadata: discovered.logicalTypes.metadata,
    logicalAiSummary: discovered.logicalTypes.aiSummary,
    logicalDocumentsZip: discovered.logicalTypes.documentsZip,
    structuralRemoveButtonCount: discovered.structuralRemoveButtonCount,
  };
}

/**
 * @deprecated Prefer countComposerAttachmentCards — returns composer-scoped count only.
 */
export async function countVisibleComposerAttachmentCards(
  page: Page,
  options?: { composerToken?: string },
): Promise<{ count: number; displayedNames: string[] }> {
  const snapshot = await countComposerAttachmentCards(page, options);
  return {
    count: snapshot.composerCount,
    displayedNames: snapshot.displayedNames,
  };
}

function logAttachmentCountSnapshot(
  snapshot: ComposerAttachmentCountSnapshot,
  logger: Logger,
): void {
  logger.info(`CHATGPT_PAGE_ATTACHMENT_COUNT=${snapshot.pageCount}`);
  console.log(`CHATGPT_PAGE_ATTACHMENT_COUNT=${snapshot.pageCount}`);
  logger.info(`CHATGPT_COMPOSER_ATTACHMENT_COUNT=${snapshot.composerCount}`);
  console.log(`CHATGPT_COMPOSER_ATTACHMENT_COUNT=${snapshot.composerCount}`);
  // Legacy alias — composer count is authoritative
  logger.info(`CHATGPT_EXISTING_ATTACHMENT_COUNT=${snapshot.composerCount}`);
  console.log(`CHATGPT_EXISTING_ATTACHMENT_COUNT=${snapshot.composerCount}`);
}

/**
 * Remove stale composer attachment cards before uploading a new tender.
 * Clears attachment cards (not just draft text).
 */
export async function clearStaleComposerAttachments(
  page: Page,
  logger: Logger,
  options?: { composerToken?: string; config?: AppConfig },
): Promise<{
  existingCount: number;
  cleared: boolean;
  pageCount: number;
}> {
  const before = await countComposerAttachmentCards(page, options);
  logAttachmentCountSnapshot(before, logger);

  if (before.logicalAttachmentCount === 0) {
    return {
      existingCount: 0,
      cleared: false,
      pageCount: before.pageCount,
    };
  }

  logger.info(
    `CHATGPT_STALE_ATTACHMENTS_FOUND=${before.logicalAttachmentCount}`,
  );
  console.log(
    `CHATGPT_STALE_ATTACHMENTS_FOUND=${before.logicalAttachmentCount}`,
  );

  const cleanup = options?.config
    ? await ensureCleanComposerForNewTender({
        page,
        logger,
        composerToken: options.composerToken,
        config: options.config,
      })
    : await clearCurrentComposer(page, {
        composerToken: options?.composerToken,
        logger,
      });

  const after = await countComposerAttachmentCards(page, options);
  logAttachmentCountSnapshot(after, logger);
  const cleared = after.logicalAttachmentCount === 0;
  if (cleared) {
    logger.info("CHATGPT_STALE_ATTACHMENTS_CLEARED=true");
    console.log("CHATGPT_STALE_ATTACHMENTS_CLEARED=true");
  } else {
    logger.warn(
      `CHATGPT_STALE_ATTACHMENTS_REMAIN=${after.logicalAttachmentCount} names=${after.displayedNames.join("; ")}`,
    );
  }

  return {
    existingCount: cleanup.beforeCount,
    cleared,
    pageCount: before.pageCount,
  };
}

/**
 * Hard gate: composer must be empty before assigning new files.
 */
export async function ensureComposerCleanBeforeUpload(
  page: Page,
  logger: Logger,
  options: { composerToken: string; config?: AppConfig },
): Promise<{ beforeCount: number; cleared: boolean; pageCount: number }> {
  const before = await countComposerAttachmentCards(page, {
    composerToken: options.composerToken,
  });
  logger.info(
    `CHATGPT_COMPOSER_ATTACHMENT_COUNT_BEFORE_UPLOAD=${before.logicalAttachmentCount}`,
  );
  console.log(
    `CHATGPT_COMPOSER_ATTACHMENT_COUNT_BEFORE_UPLOAD=${before.logicalAttachmentCount}`,
  );
  logAttachmentCountSnapshot(before, logger);

  if (before.logicalAttachmentCount === 0) {
    logger.info("CHATGPT_COMPOSER_CLEAN=true");
    console.log("CHATGPT_COMPOSER_CLEAN=true");
    return {
      beforeCount: 0,
      cleared: false,
      pageCount: before.pageCount,
    };
  }

  const cleanup = await clearStaleComposerAttachments(page, logger, {
    composerToken: options.composerToken,
    config: options.config,
  });
  const after = await countComposerAttachmentCards(page, {
    composerToken: options.composerToken,
  });

  if (after.logicalAttachmentCount !== 0) {
    logger.error("CHATGPT_COMPOSER_NOT_CLEAN=true");
    logger.error("CHATGPT_UPLOAD_BLOCKED=true");
    console.log("CHATGPT_COMPOSER_NOT_CLEAN=true");
    console.log("CHATGPT_UPLOAD_BLOCKED=true");
    throw new AutomationError(
      "CHATGPT_COMPOSER_NOT_CLEAN",
      `Composer still has ${after.logicalAttachmentCount} attachment(s) after cleanup; stale=${cleanup.existingCount}`,
    );
  }

  return {
    beforeCount: before.logicalAttachmentCount,
    cleared: cleanup.cleared,
    pageCount: before.pageCount,
  };
}

export async function detectComposerAttachments(
  page: Page,
  options?: {
    expectedArchiveFileName?: string;
    composerToken?: string;
    aiSummaryRequired?: boolean;
  },
): Promise<ComposerAttachmentPresence> {
  const discovered = await discoverComposerAttachments(page, {
    composerToken: options?.composerToken,
    aiSummaryRequired: options?.aiSummaryRequired,
  });

  // Prefer shell-scoped discovery. Fall back to legacy text checks only when
  // shell resolution failed (should be rare).
  if (discovered.resolution.shellFound) {
    const metadataAttached = discovered.logicalTypes.metadata;
    const aiSummaryAttached = discovered.logicalTypes.aiSummary;
    let documentsAttached = discovered.logicalTypes.documentsZip;
    if (!documentsAttached && options?.expectedArchiveFileName) {
      const expected = options.expectedArchiveFileName.replace(/\s+/g, "");
      documentsAttached = discovered.filenames.some((name) =>
        name.replace(/\s+/g, "").toLowerCase().includes(
          expected.toLowerCase().replace(/\.zip$/i, ""),
        ),
      );
    }
    return {
      metadataAttached,
      aiSummaryAttached,
      documentsAttached,
      visibleCardCount:
        Number(metadataAttached) +
        Number(aiSummaryAttached) +
        Number(documentsAttached),
      candidates: discovered.filenames,
      signals: discovered.filenames,
    };
  }

  const scope = getActiveComposerContainer(page);
  const pageWide = !options?.composerToken;

  // Accept timestamped/suffixed display names: metadata(20260812-084008).json etc.
  const metadataAttached = pageWide
    ? await isVisibleText(page, /metadata\S*\.json/i)
    : await isVisibleTextInLocator(scope, /metadata\S*\.json/i);
  const aiSummaryAttached = pageWide
    ? await isVisibleText(page, /AI[_\s-]*Summary\S*\.pdf/i)
    : await isVisibleTextInLocator(scope, /AI[_\s-]*Summary\S*\.pdf/i);

  const attrCandidates = pageWide
    ? await collectPageAttrCandidates(page)
    : await collectAttrCandidatesInLocator(scope);
  const expectedZip = options?.expectedArchiveFileName?.trim();
  const attrHasDocuments = attrCandidates.some((value) => {
    if (/Tender[_\s-]*All[_\s-]*Documents/i.test(value)) {
      return true;
    }
    if (expectedZip) {
      const stripDup = (name: string): string =>
        name.replace(/\([^)]*\)(?=\.[^.]+$)/, "");
      return (
        stripDup(value).toLowerCase().includes(
          stripDup(expectedZip).toLowerCase().replace(/\.zip$/i, ""),
        ) || /Zip Archive/i.test(value)
      );
    }
    return false;
  });

  let documentsAttached = pageWide
    ? (await isVisibleText(
        page,
        /Tender[_\s-]*All[_\s-]*Documents\S*\.zip/i,
      )) ||
      (await isVisibleText(page, /Tender[_\s-]*All[_\s-]*Doc/i)) ||
      attrHasDocuments
    : (await isVisibleTextInLocator(
        scope,
        /Tender[_\s-]*All[_\s-]*Documents\S*\.zip/i,
      )) ||
      (await isVisibleTextInLocator(scope, /Tender[_\s-]*All[_\s-]*Doc/i)) ||
      attrHasDocuments;

  if (!documentsAttached && expectedZip) {
    const escaped = expectedZip
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\.zip$/i, "")
      .replace(/\\\([^)]*\\\)/g, "");
    const zipRe = new RegExp(`${escaped}(?:\\([^)]*\\))?\\.zip`, "i");
    documentsAttached = pageWide
      ? (await isVisibleText(page, zipRe)) ||
        attrCandidates.some((value) => zipRe.test(value))
      : (await isVisibleTextInLocator(scope, zipRe)) ||
        attrCandidates.some((value) => zipRe.test(value));
  }

  // Truncated ZIP: type label "Zip Archive" plus Tender cue in attrs/text
  if (!documentsAttached) {
    const zipLabel = pageWide
      ? await isVisibleText(page, /^Zip Archive$/i)
      : await isVisibleTextInLocator(scope, /^Zip Archive$/i);
    if (zipLabel && (attrHasDocuments || metadataAttached || aiSummaryAttached)) {
      documentsAttached = true;
    }
  }

  const candidates: string[] = [];
  if (metadataAttached) {
    candidates.push("metadata.json");
  }
  if (aiSummaryAttached) {
    candidates.push("AI_Summary.pdf");
  }
  if (documentsAttached) {
    candidates.push(expectedZip || "Tender_All_Documents.zip");
  }
  for (const value of attrCandidates) {
    if (
      /metadata|AI[_\s-]*Summary|Tender[_\s-]*All|Zip Archive|\.json|\.pdf|\.zip/i.test(
        value,
      )
    ) {
      candidates.push(value);
    }
  }

  const visibleCardCount =
    Number(metadataAttached) +
    Number(aiSummaryAttached) +
    Number(documentsAttached);

  return {
    metadataAttached,
    aiSummaryAttached,
    documentsAttached,
    visibleCardCount,
    candidates,
    signals: [...candidates, ...attrCandidates],
  };
}

type ComposerDraftInspection = {
  hasAttachments: boolean;
  hasPrompt: boolean;
  sendEnabled: boolean;
  isCurrentTenderDraft: boolean;
  isStaleOtherTender: boolean;
  draftTenderId: string | null;
};

async function readComposerPromptText(page: Page): Promise<string> {
  const editor = getComposerEditor(page);
  return (await editor.innerText().catch(() => "")) || "";
}

async function inspectComposerDraft(
  page: Page,
  t247Id: string,
  logger: Logger,
): Promise<ComposerDraftInspection> {
  await dismissDuplicateUploadDialog(page, logger);
  const presence = await detectComposerAttachments(page);
  const promptText = await readComposerPromptText(page);
  const hasPrompt = /Evaluate this tender for Siyana/i.test(promptText);
  const sendEnabled = await isComposerSendEnabled(page);
  const currentMarker = new RegExp(`T247-${t247Id}\\b|\\b${t247Id}\\b`, "i");
  const anyTender = promptText.match(/T247-(\d+)/i);
  const draftTenderId = anyTender?.[1] ?? null;
  const isCurrentTenderDraft = hasPrompt && currentMarker.test(promptText);
  const isStaleOtherTender = Boolean(
    hasPrompt &&
      draftTenderId &&
      draftTenderId !== t247Id &&
      !currentMarker.test(promptText),
  );
  const hasAttachments =
    presence.visibleCardCount > 0 ||
    presence.metadataAttached ||
    presence.documentsAttached ||
    presence.aiSummaryAttached;

  return {
    hasAttachments,
    hasPrompt,
    sendEnabled,
    isCurrentTenderDraft,
    isStaleOtherTender,
    draftTenderId,
  };
}

async function clearComposerDraft(
  page: Page,
  logger: Logger,
  options?: { composerToken?: string },
): Promise<void> {
  // Attachment cards + prompt text (not text-only).
  await clearCurrentComposer(page, {
    composerToken: options?.composerToken,
    logger,
  });
  logger.info("CHATGPT_STALE_DRAFT_CLEARED=true");
  console.log("CHATGPT_STALE_DRAFT_CLEARED=true");
}

async function isComposerSendEnabled(page: Page): Promise<boolean> {
  const send = await locateComposerSendButton(page).catch(() => null);
  if (!send) {
    return false;
  }
  const disabled = await send.isDisabled().catch(() => true);
  return !disabled;
}

async function hasVisibleUploadError(page: Page): Promise<boolean> {
  // Duplicate-upload modal is not an upload failure
  if (
    await page
      .getByText(/You've already uploaded this file/i)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return false;
  }
  const shell = getActiveComposerContainer(page);
  return shell
    .getByText(
      /failed to upload|couldn't upload|could not upload|upload failed|error uploading/i,
    )
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Poll composerShell logical filenames until expected set is stable (2 polls).
 * Structural Remove-button count is diagnostic only — never blocks when logical set is complete.
 */
export async function waitForStableComposerAttachments(
  page: Page,
  options: {
    composerToken: string;
    manifest: Tender247ExpectedManifest;
    logger: Logger;
    timeoutMs?: number;
  },
): Promise<{
  composerCount: number;
  displayedNames: string[];
  validation: ReturnType<typeof evaluateAttachmentStabilityPoll>["validation"];
}> {
  const { composerToken, manifest, logger } = options;
  const timeoutMs =
    options.timeoutMs ?? getAttachmentValidationTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  const aiSummaryRequired = manifest.aiSummaryRequired;

  let consecutiveStablePolls = 0;
  let previousStableCount: number | null = null;
  let lastSnapshot = await countComposerAttachmentCards(page, {
    composerToken,
    aiSummaryRequired,
  });
  let lastValidation = evaluateAttachmentStabilityPoll({
    composerCount: lastSnapshot.logicalAttachmentCount,
    logicalAttachmentCount: lastSnapshot.logicalAttachmentCount,
    displayedNames: lastSnapshot.displayedNames,
    manifest,
    previousStableCount,
    consecutiveStablePolls,
  }).validation;

  const logPoll = (snapshot: ComposerAttachmentCountSnapshot) => {
    logger.info(
      `CHATGPT_UPLOAD_STABILITY_POLL composerCount=${snapshot.structuralRemoveButtonCount} expected=${manifest.expectedCount} logical=${snapshot.logicalAttachmentCount}`,
    );
    console.log(
      `CHATGPT_UPLOAD_STABILITY_POLL composerCount=${snapshot.structuralRemoveButtonCount} expected=${manifest.expectedCount} logical=${snapshot.logicalAttachmentCount}`,
    );
    console.log(
      `CHATGPT_COMPOSER_ATTACHMENT_FILENAMES=${JSON.stringify(snapshot.displayedNames)}`,
    );
    logger.info(
      `CHATGPT_COMPOSER_ATTACHMENT_FILENAMES=${JSON.stringify(snapshot.displayedNames)}`,
    );
    console.log(
      `CHATGPT_LOGICAL_METADATA_PRESENT=${snapshot.logicalMetadata}`,
    );
    console.log(
      `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${snapshot.logicalAiSummary}`,
    );
    console.log(
      `CHATGPT_LOGICAL_DOCUMENTS_ZIP_PRESENT=${snapshot.logicalDocumentsZip}`,
    );
    console.log(
      `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${snapshot.logicalAttachmentCount}`,
    );
    logger.info(
      `CHATGPT_LOGICAL_METADATA_PRESENT=${snapshot.logicalMetadata}`,
    );
    logger.info(
      `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${snapshot.logicalAiSummary}`,
    );
    logger.info(
      `CHATGPT_LOGICAL_DOCUMENTS_ZIP_PRESENT=${snapshot.logicalDocumentsZip}`,
    );
    logger.info(
      `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${snapshot.logicalAttachmentCount}`,
    );
  };

  while (Date.now() < deadline) {
    await dismissDuplicateUploadDialog(page, logger);

    if (await detectUploadLimitWarning(page)) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_LIMIT_WARNING",
        "CHATGPT_UPLOAD_LIMIT_WARNING=true",
      );
    }
    if (await hasVisibleUploadError(page)) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_FAILED",
        "Visible upload error in composer attachment cards",
      );
    }

    const resolution = await resolveComposerShell(page, { composerToken });
    console.log(
      `CHATGPT_COMPOSER_EDITOR_FOUND=${resolution.editorFound}`,
    );
    console.log(`CHATGPT_COMPOSER_SHELL_FOUND=${resolution.shellFound}`);
    logger.info(
      `CHATGPT_COMPOSER_EDITOR_FOUND=${resolution.editorFound}`,
    );
    logger.info(`CHATGPT_COMPOSER_SHELL_FOUND=${resolution.shellFound}`);

    lastSnapshot = await countComposerAttachmentCards(page, {
      composerToken,
      aiSummaryRequired,
    });
    logPoll(lastSnapshot);

    const poll = evaluateAttachmentStabilityPoll({
      composerCount: lastSnapshot.logicalAttachmentCount,
      logicalAttachmentCount: lastSnapshot.logicalAttachmentCount,
      displayedNames: lastSnapshot.displayedNames,
      manifest,
      previousStableCount,
      consecutiveStablePolls,
    });
    lastValidation = poll.validation;
    consecutiveStablePolls = poll.consecutiveStablePolls;
    previousStableCount = lastSnapshot.logicalAttachmentCount;

    if (poll.stable) {
      logger.info("CHATGPT_ATTACHMENT_STATE_STABLE=true");
      console.log("CHATGPT_ATTACHMENT_STATE_STABLE=true");
      if (lastValidation.ok) {
        logger.info("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
        console.log("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
        for (const entry of manifest.entries) {
          logger.info(`CHATGPT_ATTACHMENT_READY=${entry.expectedFileName}`);
          console.log(`CHATGPT_ATTACHMENT_READY=${entry.expectedFileName}`);
        }
      }
      return {
        composerCount: lastSnapshot.logicalAttachmentCount,
        displayedNames: lastSnapshot.displayedNames,
        validation: lastValidation,
      };
    }

    await page.waitForTimeout(STABLE_ATTACHMENT_POLL_MS);
  }

  await saveAttachmentValidationFailureDiagnostics({
    page,
    logger,
    composerToken,
    snapshot: lastSnapshot,
  });

  throw new AutomationError(
    "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
    `Attachments not stable within timeout expected=${manifest.expectedCount} logical=${lastSnapshot.logicalAttachmentCount} structural=${lastSnapshot.structuralRemoveButtonCount} reason=${lastValidation.failureReason || "timeout"}`,
  );
}

export function getAttachmentValidationTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(
    env.CHATGPT_ATTACHMENT_VALIDATION_TIMEOUT_MS || "60000",
    10,
  );
  return Number.isFinite(n) && n >= 5_000 ? n : 60_000;
}

async function saveAttachmentValidationFailureDiagnostics(options: {
  page: Page;
  logger: Logger;
  composerToken: string;
  snapshot: ComposerAttachmentCountSnapshot;
}): Promise<void> {
  const { page, logger, composerToken, snapshot } = options;
  try {
    const dir = path.join(
      process.cwd(),
      "screenshots",
      "chatgpt-attachment-validation",
    );
    fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, "attachment-validation-failure.png");
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    const htmlPath = path.join(dir, "chatgpt-composer-shell.html");
    const resolution = await resolveComposerShell(page, { composerToken });
    const shellHtml = resolution.shellFound
      ? await resolution.shell.evaluate((el) => el.outerHTML.slice(0, 200_000))
      : "";
    fs.writeFileSync(htmlPath, shellHtml || (await page.content()), "utf8");
    const diagPath = path.join(dir, "attachment-dom-diagnostics.json");
    fs.writeFileSync(
      diagPath,
      JSON.stringify(
        {
          composerToken,
          editorFound: resolution.editorFound,
          shellFound: resolution.shellFound,
          filenames: snapshot.displayedNames,
          logicalMetadata: snapshot.logicalMetadata,
          logicalAiSummary: snapshot.logicalAiSummary,
          logicalDocumentsZip: snapshot.logicalDocumentsZip,
          logicalAttachmentCount: snapshot.logicalAttachmentCount,
          structuralRemoveButtonCount: snapshot.structuralRemoveButtonCount,
          pageAttachmentCount: snapshot.pageCount,
        },
        null,
        2,
      ),
      "utf8",
    );
    logger.error(`CHATGPT_ATTACHMENT_VALIDATION_SCREENSHOT=${shot}`);
    logger.error(`CHATGPT_ATTACHMENT_VALIDATION_HTML=${htmlPath}`);
    logger.error(`CHATGPT_ATTACHMENT_VALIDATION_DIAGNOSTICS=${diagPath}`);
  } catch (error) {
    logger.warn(
      `CHATGPT_ATTACHMENT_VALIDATION_DIAGNOSTICS_FAILED=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Wait until attachment cards are detected for every expected file.
 * sendEnabled alone is never treated as proof that attachments are ready.
 */
async function waitForAttachmentChips(
  page: Page,
  files: string[],
  logger: Logger,
  session?: TenderUploadSession,
  _t247Id?: string,
  options?: { composerToken?: string },
): Promise<void> {
  const expectedCount = files.length;
  const expected = {
    metadata: files.some((f) =>
      /metadata\.json$/i.test(path.basename(f)),
    ),
    aiSummary: files.some((f) =>
      /ai[_\s-]*summary\.pdf$/i.test(path.basename(f)),
    ),
    documents: files.some(
      (f) =>
        /tender[_\s-]*all[_\s-]*documents/i.test(path.basename(f)) ||
        /\.zip$/i.test(path.basename(f)),
    ),
  };

  logger.info(`CHATGPT_EXPECTED_ATTACHMENT_COUNT=${expectedCount}`);

  // Short settle after setFiles — do not wait minutes
  if (session?.filesAssigned) {
    await page.waitForTimeout(3_000);
  }

  let lastPresence: ComposerAttachmentPresence | null = null;
  let candidatesLogged = false;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const dup = await dismissDuplicateUploadDialog(page, logger);
    if (dup && session) {
      session.filesAssigned = true;
    }

    lastPresence = await detectComposerAttachments(page, {
      expectedArchiveFileName: files.find((f) =>
        /\.zip$/i.test(path.basename(f)),
      )
        ? path.basename(files.find((f) => /\.zip$/i.test(path.basename(f)))!)
        : undefined,
      composerToken: options?.composerToken,
    });
    if (!candidatesLogged && lastPresence.candidates.length > 0) {
      for (const candidate of lastPresence.candidates.slice(0, 12)) {
        logger.info(`CHATGPT_ATTACHMENT_CANDIDATE=${candidate}`);
      }
      candidatesLogged = true;
    }

    const sendEnabled = await isComposerSendEnabled(page);
    const uploadError = await hasVisibleUploadError(page);

    const metaOk = !expected.metadata || lastPresence.metadataAttached;
    const zipOk = !expected.documents || lastPresence.documentsAttached;
    const aiOk = !expected.aiSummary || lastPresence.aiSummaryAttached;
    const requiredAttachmentsDetected = metaOk && zipOk && aiOk;

    logger.info(
      `CHATGPT_UPLOAD_WAIT expectedCards=${expectedCount} visibleCards=${lastPresence.visibleCardCount} metadata=${lastPresence.metadataAttached} aiSummary=${lastPresence.aiSummaryAttached} documents=${lastPresence.documentsAttached} sendEnabled=${sendEnabled}`,
    );

    if (uploadError) {
      throw new AutomationError(
        "CHATGPT_UPLOAD_FAILED",
        "Visible upload error in composer attachment cards",
      );
    }

    if (requiredAttachmentsDetected) {
      if (lastPresence.metadataAttached) {
        logger.info("CHATGPT_ATTACHMENT_READY=metadata.json");
      }
      if (expected.aiSummary) {
        if (lastPresence.aiSummaryAttached) {
          logger.info("CHATGPT_ATTACHMENT_READY=AI_Summary.pdf");
        }
      } else {
        logger.info("CHATGPT_AI_SUMMARY_NOT_AVAILABLE");
      }
      if (lastPresence.documentsAttached) {
        const zipName =
          files.find((f) => /\.zip$/i.test(path.basename(f))) ||
          "Tender_All_Documents.zip";
        logger.info(`CHATGPT_ATTACHMENT_READY=${path.basename(zipName)}`);
      }

      logger.info(
        `CHATGPT_ATTACHMENT_COUNT=${Math.max(
          lastPresence.visibleCardCount,
          expectedCount,
        )}`,
      );

      if (sendEnabled) {
        logger.info("CHATGPT_SEND_BUTTON_ENABLED");
      }

      for (const filePath of files) {
        logger.info(
          `CHATGPT_ATTACHMENT_VISIBLE=${path.basename(filePath)}`,
        );
      }
      logger.info("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");
      return;
    }

    await page.waitForTimeout(1_000);
  }

  if (lastPresence) {
    logger.warn(
      `CHATGPT_UPLOAD_WAIT_TIMEOUT expectedCards=${expectedCount} visibleCards=${lastPresence.visibleCardCount} metadata=${lastPresence.metadataAttached} aiSummary=${lastPresence.aiSummaryAttached} documents=${lastPresence.documentsAttached}`,
    );
  }

  const missing: string[] = [];
  if (expected.metadata && !lastPresence?.metadataAttached) {
    missing.push("metadata.json");
  }
  if (expected.aiSummary && !lastPresence?.aiSummaryAttached) {
    missing.push("AI_Summary.pdf");
  }
  if (expected.documents && !lastPresence?.documentsAttached) {
    missing.push(
      path.basename(
        files.find((f) => /\.zip$/i.test(path.basename(f))) ||
          "Tender_All_Documents.zip",
      ),
    );
  }
  throw new AutomationError(
    "CHATGPT_ATTACHMENT_NOT_VISIBLE",
    `Attachment chip not visible for ${missing.join(", ") || "expected files"} within timeout`,
  );
}

export async function assertTenderAttachmentsVerified(
  page: Page,
  t247Id: string,
  logger: Logger,
  options?: {
    expectAiSummary?: boolean;
    expectedArchiveFileName?: string;
    sourcePortal?: "TENDER247" | "BIDASSIST";
    metadataRequired?: boolean;
    tenderArchiveRequired?: boolean;
  },
): Promise<void> {
  const expectAiSummary = options?.expectAiSummary ?? false;
  const sourcePortal = options?.sourcePortal ?? "TENDER247";
  const metadataRequired = options?.metadataRequired ?? false;
  const tenderArchiveRequired = options?.tenderArchiveRequired ?? false;
  const presence = await detectComposerAttachments(page, {
    expectedArchiveFileName: options?.expectedArchiveFileName,
  });

  const metadataDetected = presence.metadataAttached;
  const tenderArchiveDetected = presence.documentsAttached;
  const bidassistArchiveDetected = presence.documentsAttached;
  const aiSummaryDetected = presence.aiSummaryAttached;

  assertRequiredAttachmentsReady({
    sourcePortal,
    sourceTenderId: t247Id,
    metadataDetected,
    tenderArchiveDetected,
    bidassistArchiveDetected,
    aiSummaryDetected,
    aiSummaryRequired: expectAiSummary,
    metadataRequired,
    tenderArchiveRequired,
  });

  if (!presence.aiSummaryAttached) {
    logger.info("CHATGPT_AI_SUMMARY_NOT_AVAILABLE");
  }

  logger.info("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");
  logger.info(`CHATGPT_ATTACHMENT_VERIFIED_FOR_TENDER=${sourcePortal}-${t247Id}`);
}

async function waitForSendEnabled(page: Page, logger: Logger): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isComposerSendEnabled(page)) {
      logger.info("CHATGPT_SEND_BUTTON_ENABLED");
      return;
    }
    await page.waitForTimeout(400);
  }
  logger.warn("CHATGPT_SEND_BUTTON_WAIT_TIMEOUT — continuing");
}

async function waitForUploadsSettled(page: Page, logger: Logger): Promise<void> {
  // Soft settle only: explicit uploading text, max 8s.
  // Do NOT wait for decorative SVG/spinner DOM that ChatGPT may retain.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    await dismissDuplicateUploadDialog(page, logger);

    if (await isComposerSendEnabled(page)) {
      return;
    }

    const uploading = await getActiveComposerContainer(page)
      .getByText(/\b(uploading|processing file|scanning)\b/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!uploading) {
      return;
    }
    await page.waitForTimeout(400);
  }
  logger.warn("Upload settle wait timed out; continuing");
}

export async function typeComposerPrompt(
  page: Page,
  prompt: string,
  logger?: Logger,
): Promise<void> {
  const composer = getProjectComposerLocator(page);

  if (!(await composer.isVisible().catch(() => false))) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_MISSING",
      "ChatGPT composer not found",
    );
  }

  logger?.info(`CHATGPT_PROMPT_INSERT_START length=${prompt.length}`);
  console.log(`CHATGPT_PROMPT_INSERT_START length=${prompt.length}`);

  const clearComposerText = async (): Promise<void> => {
    await composer.click({ timeout: 10_000 });
    await page.keyboard.press("Control+A").catch(() => undefined);
    await page.keyboard.press("Backspace").catch(() => undefined);
    // Collapse any leftover selection so the UI is not stuck highlighted.
    await page.keyboard.press("ArrowRight").catch(() => undefined);
    await page
      .evaluate(() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) sel.collapseToEnd();
      })
      .catch(() => undefined);
  };

  const readLength = async (): Promise<number> =>
    (await composer.innerText().catch(() => "")).trim().length;

  /** Bulk insert for long Phase-1 prompts — keyboard.insertText hangs at 10k+ chars. */
  const insertViaDom = async (): Promise<boolean> => {
    const ok = await page
      .evaluate((text) => {
        const el =
          (document.querySelector(
            '#prompt-textarea, [contenteditable="true"][data-virtualkeyboard], div[contenteditable="true"]',
          ) as HTMLElement | null) ||
          (document.querySelector('[contenteditable="true"]') as HTMLElement | null);
        if (!el) return false;
        el.focus();
        try {
          document.execCommand("selectAll", false);
          const inserted = document.execCommand("insertText", false, text);
          if (inserted) {
            el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
            return (el.innerText || "").trim().length >= Math.min(80, text.length);
          }
        } catch {
          // fall through
        }
        // Last-resort ProseMirror-unfriendly path; still better than hanging insertText.
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
        return (el.innerText || "").trim().length >= Math.min(80, text.length);
      }, prompt)
      .catch(() => false);
    return ok;
  };

  const insertViaClipboard = async (): Promise<boolean> => {
    try {
      await page.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
      }, prompt);
      await composer.click({ timeout: 5_000 });
      await page.keyboard.press("Control+A").catch(() => undefined);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(300);
      return (await readLength()) >= 80;
    } catch {
      return false;
    }
  };

  const insertViaKeyboard = async (): Promise<boolean> => {
    // Only for short prompts — long insertText freezes Playwright on Windows.
    if (prompt.length > 2_500) return false;
    await composer.click({ timeout: 10_000 });
    await page.keyboard.press("Control+A").catch(() => undefined);
    await page.keyboard.insertText(prompt);
    return (await readLength()) >= 80;
  };

  await clearComposerText();

  let method = "none";
  let length = 0;

  // Prefer clipboard for long Phase-1 prompts (ProseMirror handles paste; insertText hangs).
  if (prompt.length > 2_500) {
    if (await insertViaClipboard()) {
      method = "clipboard_paste";
      length = await readLength();
    } else if (await insertViaDom()) {
      method = "dom_insertText";
      length = await readLength();
    }
  } else if (await insertViaDom()) {
    method = "dom_insertText";
    length = await readLength();
  } else if (await insertViaClipboard()) {
    method = "clipboard_paste";
    length = await readLength();
  } else if (await insertViaKeyboard()) {
    method = "keyboard_insertText";
    length = await readLength();
  }

  if (method === "none") {
    if (await insertViaClipboard()) {
      method = "clipboard_paste";
    } else if (await insertViaDom()) {
      method = "dom_insertText";
    } else if (await insertViaKeyboard()) {
      method = "keyboard_insertText";
    }
    length = await readLength();
  }

  // Ensure selection is collapsed (fixes "text selected, Send does nothing").
  await page.keyboard.press("Escape").catch(() => undefined);
  await page
    .evaluate(() => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) sel.collapseToEnd();
    })
    .catch(() => undefined);
  await composer.click({ position: { x: 20, y: 20 } }).catch(() => undefined);
  await page.keyboard.press("End").catch(() => undefined);

  length = await readLength();
  logger?.info(`CHATGPT_PROMPT_INSERT_METHOD=${method}`);
  console.log(`CHATGPT_PROMPT_INSERT_METHOD=${method}`);
  logger?.info(`CHATGPT_PROMPT_INSERT_LENGTH=${length}`);
  console.log(`CHATGPT_PROMPT_INSERT_LENGTH=${length}`);

  if (length < 80) {
    throw new AutomationError(
      "CHATGPT_PROMPT_ENTER_FAILED",
      `Screening prompt did not remain in the composer (length=${length} method=${method})`,
    );
  }

  logger?.info("CHATGPT_PROMPT_ENTERED");
  console.log("CHATGPT_PROMPT_ENTERED");
}

/** Read current composer text length / presence for prompt verification. */
export async function readComposerPromptPresence(
  page: Page,
  expectedSnippet: RegExp = /Evaluate this tender for Siyana|SIYANA DAILY TENDER SCREENING|Evaluate the attached tender Excel|Run correlation ID:\s*RUN-\d{4}-\d{2}-\d{2}/i,
): Promise<{ present: boolean; length: number; text: string }> {
  const composer = getProjectComposerLocator(page);
  const text = (await composer.innerText().catch(() => "")).trim();
  const length = text.length;
  const present =
    expectedSnippet.test(text) &&
    length >= 80 &&
    !/^New chat in/i.test(text);
  return { present, length, text };
}

/**
 * True only for real ChatGPT upload-progress UI — never match the word
 * "scanning" inside the Phase-1 prompt body (Scanning / Digitization).
 */
async function isComposerAttachmentUploadInProgress(page: Page): Promise<boolean> {
  const scope = getActiveComposerContainer(page);
  const progress = scope
    .locator(
      [
        '[data-testid*="upload" i]',
        '[aria-label*="Uploading" i]',
        '[aria-label*="upload progress" i]',
        '[class*="upload" i][class*="progress" i]',
      ].join(", "),
    )
    .first();
  if (await progress.isVisible().catch(() => false)) {
    return true;
  }
  // Phrase-level only. Do NOT use bare /\bscanning\b/ — the screening prompt
  // contains "Scanning / Digitization" and would block Send forever.
  return scope
    .getByText(/\b(uploading(\.\.\.|…)?|processing file|scanning file)\b/i)
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Block Send until the run workbook is registered on the composer.
 * Prevents "required input file is not available" when the chip is visible
 * but ChatGPT has not finished attachment registration.
 */
export async function waitForRunExcelScreeningAttachmentReady(
  page: Page,
  options: {
    expectedWorkbookName: string;
    composerToken?: string;
    logger?: Logger;
    timeoutMs?: number;
  },
): Promise<{
  presence: Awaited<ReturnType<typeof detectComposerAttachments>>;
  matchedNames: string[];
  attachmentCount: number;
  attachmentName: string;
}> {
  const expected = options.expectedWorkbookName || "Tender247.xlsx";
  const expectedStem = expected.replace(/\.xlsx$/i, "");
  const timeoutMs =
    options.timeoutMs ??
    Number(process.env.CHATGPT_RUN_SCREENING_ATTACHMENT_WAIT_MS || 90_000);
  const logger = options.logger;

  logger?.info("CHATGPT_ATTACHMENT_WAIT_START");
  console.log("CHATGPT_ATTACHMENT_WAIT_START");

  const deadline = Date.now() + Math.max(5_000, timeoutMs);
  let lastPresence = await detectComposerAttachments(page, {
    composerToken: options.composerToken,
  });
  let lastCount = 0;
  let lastName = "";

  while (Date.now() < deadline) {
    const uploading = await isComposerAttachmentUploadInProgress(page);

    const presence = await detectComposerAttachments(page, {
      composerToken: options.composerToken,
    });

    if (
      !presence.candidates.some((name) =>
        isRunWorkbookFileName(name, expected),
      )
    ) {
      const visibleName = await page
        .getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
        .first()
        .isVisible()
        .catch(() => false);
      const removeBtn = await page
        .getByRole("button", {
          name: new RegExp(
            `Remove file:.*${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            "i",
          ),
        })
        .first()
        .isVisible()
        .catch(() => false);
      if (visibleName || removeBtn) {
        presence.candidates.push(expected);
      }
    }

    const matchedNames = [
      ...new Set(findRunWorkbookMatches(presence, expected)),
    ];
    const attachmentName = matchedNames[0] || "";
    const attachmentCount = matchedNames.length;
    const nameOk =
      Boolean(attachmentName) &&
      (isRunWorkbookFileName(attachmentName, expected) ||
        attachmentName.toLowerCase().includes(expectedStem.toLowerCase()));
    const ready = !uploading && attachmentCount === 1 && nameOk;

    lastPresence = presence;
    lastCount = attachmentCount;
    lastName = attachmentName;

    logger?.info(`CHATGPT_ATTACHMENT_COUNT=${attachmentCount}`);
    console.log(`CHATGPT_ATTACHMENT_COUNT=${attachmentCount}`);
    logger?.info(`CHATGPT_ATTACHMENT_NAME=${attachmentName || "(none)"}`);
    console.log(`CHATGPT_ATTACHMENT_NAME=${attachmentName || "(none)"}`);
    logger?.info(`CHATGPT_ATTACHMENT_READY=${ready}`);
    console.log(`CHATGPT_ATTACHMENT_READY=${ready}`);
    if (uploading) {
      logger?.info("CHATGPT_ATTACHMENT_UPLOADING=true");
      console.log("CHATGPT_ATTACHMENT_UPLOADING=true");
    }

    if (ready) {
      return {
        presence,
        matchedNames,
        attachmentCount,
        attachmentName,
      };
    }

    await page.waitForTimeout(500);
  }

  logger?.error(
    `CHATGPT_ATTACHMENT_READY=false CHATGPT_ATTACHMENT_COUNT=${lastCount} CHATGPT_ATTACHMENT_NAME=${lastName || "(none)"}`,
  );
  console.log("CHATGPT_SEND_ALLOWED=false");
  logger?.error("CHATGPT_SEND_ALLOWED=false");
  throw new AutomationError(
    "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
    `Cannot submit run Excel screening: workbook attachment not ready (expected=${expected} count=${lastCount} name=${lastName || "(none)"} candidates=${lastPresence.candidates.join(",")})`,
  );
}

const COMPOSER_SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  '[data-testid="send-button"]',
  'button[data-testid="fruitjuice-send-button"]',
  'button[aria-label*="Send message" i]',
  'button[aria-label^="Send" i]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
] as const;

function isExcludedComposerControl(attrs: {
  ariaLabel: string;
  title: string;
  testId: string;
}): boolean {
  const haystack = `${attrs.ariaLabel} ${attrs.title} ${attrs.testId}`.toLowerCase();
  return /mic|voice|dictat|speech|listen|model|gpt-|o1|o3|o4|chooser|attach|plus|add files|upload|photo|tool|search|web|stop|cancel|audio/i.test(
    haystack,
  );
}

export type ComposerSendButtonDiagnostics = {
  found: boolean;
  visible: boolean;
  enabled: boolean;
  count: number;
  locator: Locator | null;
};

/**
 * Locate the Project composer Send button (including unlabeled upward-arrow).
 * Always scoped to the active composer shell — never page-wide nth().
 */
export async function locateComposerSendButton(
  page: Page,
  logger?: Logger,
  options?: { composerToken?: string },
): Promise<Locator | null> {
  const diag = await resolveComposerSendButton(page, logger, options);
  return diag.locator;
}

export async function resolveComposerSendButton(
  page: Page,
  logger?: Logger,
  options?: { composerToken?: string },
): Promise<ComposerSendButtonDiagnostics> {
  const shell = options?.composerToken
    ? await resolveComposerRoot(page, options.composerToken)
    : getActiveComposerContainer(page);

  const allButtons = shell.locator("button");
  const count = await allButtons.count().catch(() => 0);

  for (const selector of COMPOSER_SEND_BUTTON_SELECTORS) {
    const group = shell.locator(selector);
    const groupCount = await group.count().catch(() => 0);
    for (let i = 0; i < Math.min(groupCount, 6); i += 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const ariaLabel =
        (await candidate.getAttribute("aria-label").catch(() => null)) || "";
      const title =
        (await candidate.getAttribute("title").catch(() => null)) || "";
      const testId =
        (await candidate.getAttribute("data-testid").catch(() => null)) || "";
      if (
        isExcludedComposerControl({
          ariaLabel,
          title,
          testId,
        })
      ) {
        continue;
      }
      const disabled = await candidate.isDisabled().catch(() => true);
      return {
        found: true,
        visible: true,
        enabled: !disabled,
        count,
        locator: candidate,
      };
    }
  }

  // Bottom-right upward-arrow / circular Send fallback inside composer only.
  const shellBox = await shell.boundingBox().catch(() => null);
  if (!shellBox) {
    logger?.warn("CHATGPT_SEND_BUTTON_MISSING — composer shell has no box");
    return {
      found: false,
      visible: false,
      enabled: false,
      count,
      locator: null,
    };
  }

  const buttons = shell.locator("button");
  const btnCount = await buttons.count().catch(() => 0);
  type Candidate = {
    index: number;
    ariaLabel: string;
    title: string;
    testId: string;
    disabled: boolean;
    hasSvg: boolean;
    circular: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const candidates: Candidate[] = [];

  for (let i = 0; i < btnCount; i += 1) {
    const btn = buttons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) {
      continue;
    }
    const box = await btn.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
      continue;
    }
    const disabled = await btn.isDisabled().catch(() => true);
    const ariaLabel =
      (await btn.getAttribute("aria-label").catch(() => null)) || "";
    const title = (await btn.getAttribute("title").catch(() => null)) || "";
    const testId =
      (await btn.getAttribute("data-testid").catch(() => null)) || "";
    const hasSvg = (await btn.locator("svg").count().catch(() => 0)) > 0;
    const ratio =
      Math.min(box.width, box.height) / Math.max(box.width, box.height);
    const circular = ratio >= 0.75 && box.width <= 72 && box.height <= 72;
    candidates.push({
      index: i,
      ariaLabel,
      title,
      testId,
      disabled,
      hasSvg,
      circular,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }

  logger?.info(
    `CHATGPT_SEND_CANDIDATES=${JSON.stringify(
      candidates.map((c) => ({
        index: c.index,
        ariaLabel: c.ariaLabel,
        title: c.title,
        testId: c.testId,
        disabled: c.disabled,
        hasSvg: c.hasSvg,
        circular: c.circular,
        x: Math.round(c.x),
        y: Math.round(c.y),
      })),
    )}`,
  );

  const rightThreshold = shellBox.x + shellBox.width * 0.7;
  const bottomThreshold = shellBox.y + shellBox.height * 0.55;

  const ranked = candidates
    .filter((c) => {
      if (c.disabled) {
        return false;
      }
      if (
        isExcludedComposerControl({
          ariaLabel: c.ariaLabel,
          title: c.title,
          testId: c.testId,
        })
      ) {
        return false;
      }
      const cx = c.x + c.width / 2;
      const cy = c.y + c.height / 2;
      if (!(cx >= rightThreshold && cy >= bottomThreshold)) {
        return false;
      }
      // Prefer icon/circular send; skip wide text buttons.
      return c.hasSvg || c.circular || /send|submit/i.test(c.ariaLabel);
    })
    .sort((a, b) => {
      // Prefer explicit send testid/aria, then circular+svg, then rightmost/bottommost.
      const score = (c: Candidate): number => {
        let s = 0;
        if (/send-button/i.test(c.testId)) s += 100;
        if (/^send/i.test(c.ariaLabel)) s += 50;
        if (c.circular && c.hasSvg) s += 30;
        if (c.hasSvg) s += 10;
        s += (c.x + c.width / 2) / 1000;
        s += (c.y + c.height / 2) / 10000;
        return s;
      };
      return score(b) - score(a);
    });

  if (ranked.length === 0) {
    logger?.warn(
      "CHATGPT_SEND_BUTTON_MISSING — no bottom-right composer button matched",
    );
    return {
      found: false,
      visible: false,
      enabled: false,
      count,
      locator: null,
    };
  }

  const best = ranked[0]!;
  logger?.info(
    `CHATGPT_SEND_BUTTON_FALLBACK_ARROW index=${best.index} aria="${best.ariaLabel}" title="${best.title}" testid="${best.testId}" circular=${best.circular}`,
  );
  const locator = buttons.nth(best.index);
  return {
    found: true,
    visible: true,
    enabled: !best.disabled,
    count,
    locator,
  };
}

function logSendButtonDiagnostics(diag: ComposerSendButtonDiagnostics): void {
  console.log(`CHATGPT_SEND_BUTTON_FOUND=${diag.found}`);
  console.log(`CHATGPT_SEND_BUTTON_VISIBLE=${diag.visible}`);
  console.log(`CHATGPT_SEND_BUTTON_ENABLED=${diag.enabled}`);
  console.log(`CHATGPT_SEND_BUTTON_COUNT=${diag.count}`);
}

export type MessageBaseline = {
  assistantCountBefore: number;
  userCountBefore: number;
  capturedAt: string;
};

export type SendComposerResult = {
  chatUrl: string;
  baseline: MessageBaseline;
  submissionConfirmed: true;
  /** When duplicate-prompt was blocked and existing assistant text was found. */
  existingResponseText?: string;
  existingValidJson?: boolean;
};

export async function captureMessageBaseline(page: Page): Promise<MessageBaseline> {
  const assistantCountBefore = await page
    .locator('[data-message-author-role="assistant"]')
    .count()
    .catch(() => 0);
  const userCountBefore = await page
    .locator('[data-message-author-role="user"]')
    .count()
    .catch(() => 0);
  return {
    assistantCountBefore,
    userCountBefore,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Click Send in the Project composer and verify a real conversation was created.
 * Captures assistant/user message counts immediately before Send.
 * Logs CHATGPT_SEND_CLICKED immediately; CHATGPT_PROMPT_SUBMITTED only after
 * a new user message AND a /c/ conversation URL are confirmed.
 * Composer/attachment clearing is diagnostic only — never a hard failure.
 */
export async function sendComposerMessage(
  page: Page,
  logger?: Logger,
  options?: {
    /** Require a new /c/ conversation URL (Project Home submissions). */
    requireNewConversation?: boolean;
    userMessagePattern?: RegExp;
    /** Current tender id — used to bind the new user message. */
    expectedT247Id?: string;
    /**
     * Required for Project Home new-conversation submits.
     * Without this object, prompt-only Send is refused.
     */
    confirmedAttachments?: {
      requiredAttachmentsConfirmed: true;
      sourcePortal: "TENDER247" | "BIDASSIST";
      sourceTenderId: string;
      fileNames: string[];
      composerIdentity: string;
      aiSummaryRequired?: boolean;
    };
    /**
     * When true, caller already acquired the shared Send slot
     * (legacy — prefer letting sendComposerMessage own withGlobalSendSlot).
     */
    sendSlotAlreadyHeld?: boolean;
    workerId?: number;
    /** Run-level Excel screening attaches a single workbook. */
    minAttachmentCount?: number;
    /**
     * Explicit submission mode. Defaults to single-tender qualification.
     * Never inferred from filenames.
     */
    submissionKind?: ChatGptSubmissionKind;
  },
): Promise<SendComposerResult> {
  const requireNewConversation = options?.requireNewConversation ?? true;
  const submissionKind: ChatGptSubmissionKind =
    options?.submissionKind ?? "TENDER_QUALIFICATION";
  const userMessagePattern =
    options?.userMessagePattern ??
    /Evaluate this tender for Siyana Info Solutions Pvt\. Ltd\./i;
  const expectedT247Id = options?.expectedT247Id;
  const confirmed = options?.confirmedAttachments;
  const sendSlotAlreadyHeld = options?.sendSlotAlreadyHeld === true;
  const workerId = options?.workerId;

  await assertNotRateLimited(page, logger);

  if (requireNewConversation) {
    const isTextMode = submissionKind === "DOCUMENT_TEXT_QUALIFICATION";
    const minAttachments = isTextMode
      ? 0
      : (options?.minAttachmentCount ?? 2);
    if (
      !isTextMode &&
      (!confirmed ||
        confirmed.requiredAttachmentsConfirmed !== true ||
        !Array.isArray(confirmed.fileNames) ||
        confirmed.fileNames.length < minAttachments)
    ) {
      throw new AutomationError(
        "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
        "sendComposerMessage refused: ConfirmedAttachmentState required for new conversation",
      );
    }
    if (
      isTextMode &&
      (!confirmed || confirmed.requiredAttachmentsConfirmed !== true)
    ) {
      throw new AutomationError(
        "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
        "sendComposerMessage refused: DOCUMENT_TEXT_QUALIFICATION requires confirmedAttachments with requiredAttachmentsConfirmed=true (fileNames may be empty)",
      );
    }
  }

  const scheduler = getSharedChatGptSubmissionScheduler();

  logger?.info(`CHATGPT_SUBMISSION_KIND=${submissionKind}`);
  console.log(`CHATGPT_SUBMISSION_KIND=${submissionKind}`);

  // Global mutex: wait for interval + hold through Send confirmation, then release.
  // Do NOT hold during response wait (released before return to caller).
  // RUN_EXCEL_SCREENING still takes the lock (no duplicate Send) but skips the
  // multi-minute individual-tender interval.
  let sendSlotHeld = sendSlotAlreadyHeld;
  if (!sendSlotAlreadyHeld) {
    // Rolling 65/3h safety budget (detail qualification only) — wait, never fail.
    if (
      submissionKind === "TENDER_QUALIFICATION" ||
      submissionKind === "DOCUMENT_TEXT_QUALIFICATION"
    ) {
      await awaitDetailChatGptSubmissionSlot({ logger: logger ?? undefined });
    }
    await scheduler.acquireSendSlot({ logger, workerId, submissionKind });
    sendSlotHeld = true;
  } else if (submissionKind === "RUN_EXCEL_SCREENING") {
    logger?.info("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
    console.log("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
  } else if (submissionKind === "DOCUMENT_TEXT_QUALIFICATION") {
    logger?.info("CHATGPT_DOCUMENT_TEXT_MODE_SEND=true");
    console.log("CHATGPT_DOCUMENT_TEXT_MODE_SEND=true");
    logger?.info("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
    console.log("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
    logger?.info("CHATGPT_DOCUMENT_TEXT_SKIP_ATTACHMENT_BUFFER=true");
    console.log("CHATGPT_DOCUMENT_TEXT_SKIP_ATTACHMENT_BUFFER=true");
  }

  const recordDetailRateIfNeeded = async (): Promise<void> => {
    if (
      submissionKind !== "TENDER_QUALIFICATION" &&
      submissionKind !== "DOCUMENT_TEXT_QUALIFICATION"
    ) {
      return;
    }
    const tenderId =
      confirmed?.sourceTenderId || expectedT247Id || "unknown";
    await recordDetailSubmission({
      tenderId: String(tenderId),
      mode:
        submissionKind === "DOCUMENT_TEXT_QUALIFICATION"
          ? "TEXT_MODE"
          : "UPLOAD",
      correlationId: `QUALIFICATION-siyana-${tenderId}`,
      logger: logger ?? undefined,
    });
  };

  const releaseSendSlotSafe = (success: boolean): void => {
    if (!sendSlotHeld) return;
    sendSlotHeld = false;
    if (success) {
      scheduler.noteSuccess();
    }
    scheduler.releaseSendSlot();
  };

  try {
  // Soft settle only — do not block on decorative spinner DOM
  const softDeadline = Date.now() + 3_000;
  while (Date.now() < softDeadline) {
    if (await isComposerSendEnabled(page)) {
      break;
    }
    const uploading = await getActiveComposerContainer(page)
      .getByText(/\b(uploading|processing file|scanning)\b/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!uploading) {
      break;
    }
    await page.waitForTimeout(250);
  }

  if (requireNewConversation && submissionKind === "TENDER_QUALIFICATION") {
    const archiveName =
      confirmed!.fileNames.find((n) => /\.zip$/i.test(n)) || undefined;
    const presence = await detectComposerAttachments(page, {
      expectedArchiveFileName: archiveName,
      composerToken: confirmed!.composerIdentity,
      aiSummaryRequired: confirmed!.aiSummaryRequired === true,
    });
    const aiRequired = confirmed!.aiSummaryRequired === true;
    logger?.info(
      `CHATGPT_PRE_SEND_LOGICAL_RECHECK metadata=${presence.metadataAttached} zip=${presence.documentsAttached} ai=${presence.aiSummaryAttached} aiRequired=${aiRequired}`,
    );
    console.log(
      `CHATGPT_PRE_SEND_LOGICAL_RECHECK metadata=${presence.metadataAttached} zip=${presence.documentsAttached} ai=${presence.aiSummaryAttached} aiRequired=${aiRequired}`,
    );
    try {
      assertTenderQualificationPreSend(presence, aiRequired);
    } catch (error) {
      if (!presence.metadataAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
        logger?.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
      }
      if (!presence.documentsAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents");
        logger?.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents");
      }
      if (aiRequired && !presence.aiSummaryAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=ai_summary");
        logger?.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=ai_summary");
      }
      throw error;
    }
  }

  if (requireNewConversation && submissionKind === "RUN_EXCEL_SCREENING") {
    const expectedWorkbookName = confirmed!.fileNames[0] || "Tender247.xlsx";
    logger?.info("CHATGPT_RUN_SCREENING_PRE_SEND_CHECK");
    console.log("CHATGPT_RUN_SCREENING_PRE_SEND_CHECK");

    const attachmentReady = await waitForRunExcelScreeningAttachmentReady(page, {
      expectedWorkbookName,
      composerToken: confirmed!.composerIdentity,
      logger,
    });

    const promptCheck = await readComposerPromptPresence(page, userMessagePattern);
    logger?.info(
      `CHATGPT_RUN_SCREENING_PROMPT_CHECK present=${promptCheck.present} length=${promptCheck.length} snippet=${JSON.stringify(promptCheck.text.slice(0, 120))}`,
    );
    console.log(
      `CHATGPT_RUN_SCREENING_PROMPT_CHECK present=${promptCheck.present} length=${promptCheck.length}`,
    );
    const sendEnabled = await isComposerSendEnabled(page);
    assertRunExcelScreeningPreSend({
      presence: attachmentReady.presence,
      expectedWorkbookName,
      promptPresent: promptCheck.present,
      sendEnabled,
      requireSendEnabled: false,
    });
    logger?.info("CHATGPT_RUN_SCREENING_WORKBOOK_READY=true");
    console.log("CHATGPT_RUN_SCREENING_WORKBOOK_READY=true");
    logger?.info("CHATGPT_SEND_ALLOWED=true");
    console.log("CHATGPT_SEND_ALLOWED=true");
  }

  // Baseline MUST be captured immediately before Send
  const baseline = await captureMessageBaseline(page);
  logger?.info(
    `CHATGPT_MESSAGE_BASELINE assistants=${baseline.assistantCountBefore} users=${baseline.userCountBefore}`,
  );

  const sendDiag = await resolveComposerSendButton(page, logger, {
    composerToken: confirmed?.composerIdentity,
  });
  logSendButtonDiagnostics(sendDiag);
  logger?.info(`CHATGPT_SEND_BUTTON_FOUND=${sendDiag.found}`);
  logger?.info(`CHATGPT_SEND_BUTTON_VISIBLE=${sendDiag.visible}`);
  logger?.info(`CHATGPT_SEND_BUTTON_ENABLED=${sendDiag.enabled}`);
  logger?.info(`CHATGPT_SEND_BUTTON_COUNT=${sendDiag.count}`);

  const sendButton = sendDiag.locator;
  let usedEnterFallback = false;

  if (sendButton) {
    if (!sendDiag.enabled) {
      // Brief wait for enablement (max ~8s) — do not stall for minutes.
      const enableDeadline = Date.now() + 8_000;
      let enabled = false;
      while (Date.now() < enableDeadline) {
        const disabled = await sendButton.isDisabled().catch(() => true);
        if (!disabled) {
          enabled = true;
          break;
        }
        await page.waitForTimeout(250);
      }
      if (!enabled) {
        throw new AutomationError(
          "CHATGPT_SEND_BUTTON_DISABLED",
          "Project composer Send button is disabled",
        );
      }
    }
    logger?.info("CHATGPT_SEND_BUTTON_ENABLED");
    logger?.info("CHATGPT_SEND_BUTTON_ENABLED=true");
    console.log("CHATGPT_SEND_BUTTON_ENABLED=true");
    if (submissionKind === "RUN_EXCEL_SCREENING") {
      logger?.info("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
      console.log("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0");
      // Final gate: attachment must still be registered with the prompt payload.
      const expectedWorkbookName =
        confirmed?.fileNames[0] || "Tender247.xlsx";
      await waitForRunExcelScreeningAttachmentReady(page, {
        expectedWorkbookName,
        composerToken: confirmed?.composerIdentity,
        logger,
        timeoutMs: 30_000,
      });
      logger?.info("CHATGPT_SEND_ALLOWED=true");
      console.log("CHATGPT_SEND_ALLOWED=true");
    }
    console.log("CHATGPT_SEND_CLICK_START");
    logger?.info("CHATGPT_SEND_CLICK_START");
    await sendButton.scrollIntoViewIfNeeded().catch(() => undefined);
    await sendButton.click({ timeout: 10_000, force: true });
    console.log("CHATGPT_SEND_CLICKED=true");
    logger?.info("CHATGPT_SEND_CLICKED=true");
    logger?.info("CHATGPT_SEND_CLICKED");
  } else {
    const promptReady = await composerStillHasPromptText(page);
    const presence = await detectComposerAttachments(page, {
      composerToken: confirmed?.composerIdentity,
    });
    const attachmentsReady =
      !requireNewConversation ||
      submissionKind === "DOCUMENT_TEXT_QUALIFICATION" ||
      (submissionKind === "RUN_EXCEL_SCREENING"
        ? presence.candidates.some((name) => /\.xlsx$/i.test(name))
        : presence.metadataAttached && presence.documentsAttached);
    if (!promptReady || !attachmentsReady) {
      throw new AutomationError(
        "CHATGPT_SEND_BUTTON_MISSING",
        "Could not find the Project composer Send button",
      );
    }
    logger?.warn(
      "CHATGPT_SEND_BUTTON_MISSING — using single Enter keyboard fallback",
    );
    console.log("CHATGPT_SEND_CLICK_START");
    logger?.info("CHATGPT_SEND_CLICK_START");
    const composer = getProjectComposerLocator(page);
    await composer.click({ timeout: 5_000 }).catch(() => undefined);
    await page.keyboard.up("Shift").catch(() => undefined);
    await composer.press("Enter");
    usedEnterFallback = true;
    console.log("CHATGPT_SEND_CLICKED=true");
    logger?.info("CHATGPT_SEND_CLICKED=true");
    logger?.info("CHATGPT_SEND_CLICKED");
  }

  const verifyOpts = {
    requireNewConversation,
    userMessagePattern,
    timeoutMs: 30_000,
    logger,
    baseline,
    expectedT247Id,
  };

  const submitted = await waitForPromptSubmissionVerified(page, verifyOpts);

  if (submitted) {
    logger?.info("CHATGPT_PROMPT_SUBMITTED=true");
    console.log("CHATGPT_PROMPT_SUBMITTED=true");
    logger?.info("CHATGPT_PROMPT_SUBMITTED");
    logger?.info("CHATGPT_MESSAGE_SUBMITTED=true");
    console.log("CHATGPT_MESSAGE_SUBMITTED=true");
    if (confirmed) {
      scheduler.markSubmissionSuccess({
        sourcePortal: confirmed.sourcePortal,
        sourceTenderId: confirmed.sourceTenderId,
        force: true,
      });
    }
    await recordDetailRateIfNeeded();
    const url = page.url();
    if (!isConversationUrl(url)) {
      throw new AutomationError(
        "CHATGPT_PROMPT_NOT_SUBMITTED",
        `Submission verified but URL is not a conversation: ${url}`,
      );
    }
    console.log(`CHATGPT_CONVERSATION_URL=${url}`);
    logger?.info(`CHATGPT_CONVERSATION_URL=${url}`);
    if (expectedT247Id) {
      logger?.info(
        `CHATGPT_CURRENT_USER_MESSAGE_CONFIRMED=T247-${expectedT247Id}`,
      );
    }
    releaseSendSlotSafe(true);
    return { chatUrl: url, baseline, submissionConfirmed: true };
  }

  // Authoritative last check: never fail when new user message + /c/ already exist
  // (stale Project Home composer DOM must not override this).
  const authoritative = await isAuthoritativePromptSubmission(page, {
    baseline,
    userMessagePattern,
    expectedT247Id,
  });
  if (authoritative) {
    logger?.info("CHATGPT_PROMPT_SUBMITTED=true");
    console.log("CHATGPT_PROMPT_SUBMITTED=true");
    logger?.info("CHATGPT_PROMPT_SUBMITTED");
    logger?.info("CHATGPT_MESSAGE_SUBMITTED=true");
    console.log("CHATGPT_MESSAGE_SUBMITTED=true");
    if (confirmed) {
      scheduler.markSubmissionSuccess({
        sourcePortal: confirmed.sourcePortal,
        sourceTenderId: confirmed.sourceTenderId,
        force: true,
      });
    }
    await recordDetailRateIfNeeded();
    console.log(`CHATGPT_CONVERSATION_URL=${page.url()}`);
    logger?.info(`CHATGPT_CONVERSATION_URL=${page.url()}`);
    if (expectedT247Id) {
      logger?.info(
        `CHATGPT_CURRENT_USER_MESSAGE_CONFIRMED=T247-${expectedT247Id}`,
      );
    }
    releaseSendSlotSafe(true);
    return { chatUrl: page.url(), baseline, submissionConfirmed: true };
  }

  // Reused daily screening chat: Send cleared the composer and we are on /c/ —
  // treat as submitted and wait for the response Excel (do not close early).
  if (
    submissionKind === "RUN_EXCEL_SCREENING" &&
    !requireNewConversation &&
    isConversationUrl(page.url())
  ) {
    const userCount = await page
      .locator('[data-message-author-role="user"]')
      .count()
      .catch(() => 0);
    const promptGone = !(await composerStillHasPromptText(page));
    if (promptGone && userCount > baseline.userCountBefore) {
      logger?.info("CHATGPT_PROMPT_SUBMITTED=true");
      console.log("CHATGPT_PROMPT_SUBMITTED=true");
      logger?.info("CHATGPT_RUN_SCREENING_SUBMIT_ACCEPTED_REUSED_CHAT=true");
      console.log("CHATGPT_RUN_SCREENING_SUBMIT_ACCEPTED_REUSED_CHAT=true");
      logger?.info("CHATGPT_MESSAGE_SUBMITTED=true");
      console.log("CHATGPT_MESSAGE_SUBMITTED=true");
      if (confirmed) {
        scheduler.markSubmissionSuccess({
          sourcePortal: confirmed.sourcePortal,
          sourceTenderId: confirmed.sourceTenderId,
          force: true,
        });
      }
      releaseSendSlotSafe(true);
      return { chatUrl: page.url(), baseline, submissionConfirmed: true };
    }
  }

  const stillOnProject = /\/project(?:\/|$|\?|#)/i.test(page.url());
  const promptStillInComposer = await composerStillHasPromptText(page);
  const anyMatchingUser = await page
    .locator('[data-message-author-role="user"]')
    .filter({ hasText: userMessagePattern })
    .last()
    .isVisible()
    .catch(() => false);

  if (
    !usedEnterFallback &&
    !anyMatchingUser &&
    !isConversationUrl(page.url()) &&
    stillOnProject &&
    promptStillInComposer
  ) {
    logger?.warn("CHATGPT_SEND_NOT_CONFIRMED");
    console.log("CHATGPT_SEND_NOT_CONFIRMED");
    logger?.warn("CHATGPT_SEND_RETRY_ENTER");
    const composer = getProjectComposerLocator(page);
    await composer.click({ timeout: 5_000 }).catch(() => undefined);
    await page.keyboard.up("Shift").catch(() => undefined);
    await composer.press("Enter");

    const retryOk = await waitForPromptSubmissionVerified(page, verifyOpts);
    if (retryOk || (await isAuthoritativePromptSubmission(page, {
      baseline,
      userMessagePattern,
      expectedT247Id,
    }))) {
      logger?.info("CHATGPT_PROMPT_SUBMITTED");
      logger?.info("CHATGPT_MESSAGE_SUBMITTED=true");
      console.log("CHATGPT_MESSAGE_SUBMITTED=true");
      if (confirmed) {
        scheduler.markSubmissionSuccess({
          sourcePortal: confirmed.sourcePortal,
          sourceTenderId: confirmed.sourceTenderId,
          force: true,
        });
      }
      await recordDetailRateIfNeeded();
      const url = page.url();
      if (!isConversationUrl(url)) {
        throw new AutomationError(
          "CHATGPT_PROMPT_NOT_SUBMITTED",
          `Submission verified but URL is not a conversation: ${url}`,
        );
      }
      if (expectedT247Id) {
        logger?.info(
          `CHATGPT_CURRENT_USER_MESSAGE_CONFIRMED=T247-${expectedT247Id}`,
        );
      }
      releaseSendSlotSafe(true);
      return { chatUrl: url, baseline, submissionConfirmed: true };
    }
  }

  if (anyMatchingUser) {
    logger?.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
  }

  throw new AutomationError(
    "CHATGPT_PROMPT_NOT_SUBMITTED",
    "Prompt was not submitted: no new user message and/or no /c/ conversation URL after Send",
  );
  } catch (error) {
    releaseSendSlotSafe(false);
    throw error;
  }
}

async function composerStillHasPromptText(page: Page): Promise<boolean> {
  const composer = getProjectComposerLocator(page);
  const text = (await composer.innerText().catch(() => "")).trim();
  if (!text) {
    return false;
  }
  if (/^New chat in/i.test(text)) {
    return false;
  }
  return (
    /Evaluate this tender for Siyana/i.test(text) ||
    /SIYANA DAILY TENDER SCREENING/i.test(text) ||
    /Evaluate the attached tender Excel for Phase-1 screening/i.test(text) ||
    /\bRUN-\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /Your previous status value|not valid JSON|ONE JSON object only/i.test(
      text,
    )
  );
}

async function composerStillHasAttachmentChips(page: Page): Promise<boolean> {
  const presence = await detectComposerAttachments(page);
  return (
    presence.metadataAttached ||
    presence.documentsAttached ||
    presence.aiSummaryAttached
  );
}

/**
 * Authoritative submission success: new user message (after baseline) + /c/ URL.
 * Composer / attachment clearing is ignored.
 */
export async function isAuthoritativePromptSubmission(
  page: Page,
  options: {
    baseline: MessageBaseline;
    userMessagePattern: RegExp;
    expectedT247Id?: string;
  },
): Promise<boolean> {
  if (!isConversationUrl(page.url())) {
    return false;
  }
  const match = await findSubmittedUserMessage(page, options);
  return match !== null;
}

/** Detect submission without a baseline (post-uncertain Send). */
export async function detectSubmissionSignals(
  page: Page,
  options?: {
    expectedT247Id?: string;
    userMessagePattern?: RegExp;
  },
): Promise<{
  conversationUrl: boolean;
  userPromptVisible: boolean;
  submitted: boolean;
  url: string;
}> {
  const url = page.url();
  const conversationUrl = isConversationUrl(url);
  const pattern =
    options?.userMessagePattern ??
    /Evaluate this tender for Siyana Info Solutions Pvt\. Ltd\./i;
  const match = await findSubmittedUserMessage(page, {
    baseline: {
      assistantCountBefore: 0,
      userCountBefore: 0,
      capturedAt: new Date(0).toISOString(),
    },
    userMessagePattern: pattern,
    expectedT247Id: options?.expectedT247Id,
  });
  const userPromptVisible = match !== null;
  return {
    conversationUrl,
    userPromptVisible,
    submitted: conversationUrl && userPromptVisible,
    url,
  };
}

async function findSubmittedUserMessage(
  page: Page,
  options: {
    baseline: MessageBaseline;
    userMessagePattern: RegExp;
    expectedT247Id?: string;
  },
): Promise<{ index: number; text: string } | null> {
  const { baseline, userMessagePattern, expectedT247Id } = options;
  const userMessages = page.locator('[data-message-author-role="user"]');
  const userCount = await userMessages.count().catch(() => 0);

  const textMatchesTender = (text: string): boolean => {
    if (!userMessagePattern.test(text)) {
      return false;
    }
    if (!expectedT247Id) {
      return true;
    }
    // Daily Excel screening uses RUN-YYYY-MM-DD (not T247-...).
    if (/^RUN-\d{4}-\d{2}-\d{2}$/i.test(expectedT247Id)) {
      const runDate = expectedT247Id.slice(4);
      return (
        new RegExp(`\\b${expectedT247Id}\\b`, "i").test(text) ||
        new RegExp(`Run correlation ID:\\s*${expectedT247Id}\\b`, "i").test(
          text,
        ) ||
        new RegExp(`Run date:\\s*${runDate}\\b`, "i").test(text)
      );
    }
    return (
      new RegExp(`T247-${expectedT247Id}\\b`, "i").test(text) ||
      new RegExp(`\\b${expectedT247Id}\\b`).test(text)
    );
  };

  // Prefer the message at the baseline index (the one created by this Send)
  if (userCount > baseline.userCountBefore) {
    const index = baseline.userCountBefore;
    const submitted = userMessages.nth(index);
    const text = (await submitted.innerText().catch(() => "")) || "";
    const visible = await submitted.isVisible().catch(() => false);
    if (visible && textMatchesTender(text)) {
      return { index, text };
    }
    // Text may be partially virtualized — still accept if pattern matches
    if (textMatchesTender(text)) {
      return { index, text };
    }
  }

  // Fallback: latest matching user bubble (SPA remount / virtualization)
  for (let i = userCount - 1; i >= 0; i -= 1) {
    const text = (await userMessages.nth(i).innerText().catch(() => "")) || "";
    if (textMatchesTender(text)) {
      const visible = await userMessages
        .nth(i)
        .isVisible()
        .catch(() => false);
      if (visible || i >= baseline.userCountBefore) {
        return { index: i, text };
      }
    }
  }

  return null;
}

async function waitForPromptSubmissionVerified(
  page: Page,
  options: {
    requireNewConversation: boolean;
    userMessagePattern: RegExp;
    timeoutMs: number;
    logger?: Logger;
    baseline: MessageBaseline;
    expectedT247Id?: string;
  },
): Promise<boolean> {
  const {
    requireNewConversation,
    userMessagePattern,
    timeoutMs,
    logger,
    baseline,
    expectedT247Id,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let userLogged = false;
  let urlLogged = false;
  let composerClearedLogged = false;
  let attachmentsClearedLogged = false;

  // Kick URL wait in parallel with polling (never accept /project)
  const urlWait = page
    .waitForURL((url) => isConversationUrl(url.toString()), {
      timeout: timeoutMs,
    })
    .then(() => true)
    .catch(() => false);

  while (Date.now() < deadline) {
    await assertNotRateLimited(page, logger);

    const urlOk = isConversationUrl(page.url());
    const submittedUser = await findSubmittedUserMessage(page, {
      baseline,
      userMessagePattern,
      expectedT247Id,
    });
    const userVisible = submittedUser !== null;

    // Diagnostic only — never gate success on these
    const promptCleared = !(await composerStillHasPromptText(page));
    const attachmentsCleared = requireNewConversation
      ? !(await composerStillHasAttachmentChips(page))
      : true;

    if (userVisible && !userLogged) {
      logger?.info("CHATGPT_USER_MESSAGE_VISIBLE");
      userLogged = true;
    }
    if (urlOk && !urlLogged) {
      logger?.info("CHATGPT_CONVERSATION_URL_CREATED");
      urlLogged = true;
    }
    if (promptCleared && !composerClearedLogged) {
      logger?.info("CHATGPT_COMPOSER_CLEARED_OBSERVED");
      composerClearedLogged = true;
    }
    if (attachmentsCleared && !attachmentsClearedLogged) {
      logger?.info("CHATGPT_ATTACHMENTS_REMOVED_OBSERVED");
      attachmentsClearedLogged = true;
    }

    // Success rule: new user message + /c/ URL only
    if (userVisible && urlOk) {
      await urlWait.catch(() => undefined);
      return true;
    }

    await page.waitForTimeout(400);
  }

  await urlWait.catch(() => undefined);

  // Final authoritative check after timeout
  return isAuthoritativePromptSubmission(page, {
    baseline,
    userMessagePattern,
    expectedT247Id,
  });
}

/**
 * Wait until the URL contains /c/<id>. Never returns a /project URL.
 */
export async function waitForConversationUrl(options: {
  page: Page;
  timeoutMs?: number;
  logger: Logger;
}): Promise<string> {
  const { page } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = page.url();
    if (isConversationUrl(url)) {
      return url;
    }
    await page.waitForTimeout(500);
  }

  throw new AutomationError(
    "CHATGPT_CONVERSATION_URL_MISSING",
    `Conversation URL with /c/ was not created within ${timeoutMs}ms (current=${page.url()})`,
  );
}

/** @deprecated Prefer isConversationUrl — Project Home URLs are never conversations. */
export function isLikelyConversationUrl(url: string): boolean {
  return isConversationUrl(url);
}

export type AssistantWaitResult =
  | { status: "complete"; text: string; reason?: string; outputFilename?: string }
  | { status: "pending_timeout"; text: string; uiState: string }
  | { status: "stalled"; text: string; uiState: string };

export type ResponseBinding = {
  assistantCountBefore: number;
  userCountBefore: number;
};

/**
 * Resolve which assistant-message index boundary belongs to the current tender.
 * Prefer saved baseline; otherwise derive from the matching user prompt in the DOM.
 */
export async function resolveResponseBinding(
  page: Page,
  expectedT247Id: string,
  saved?: Partial<ResponseBinding> | null,
): Promise<ResponseBinding> {
  if (
    typeof saved?.assistantCountBefore === "number" &&
    saved.assistantCountBefore >= 0
  ) {
    return {
      assistantCountBefore: saved.assistantCountBefore,
      userCountBefore:
        typeof saved.userCountBefore === "number" ? saved.userCountBefore : 0,
    };
  }

  const derived = await page
    .evaluate((t247Id) => {
      const nodes = Array.from(
        document.querySelectorAll("[data-message-author-role]"),
      );
      let userDomIndex = -1;
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const role = nodes[i]!.getAttribute("data-message-author-role");
        if (role !== "user") {
          continue;
        }
        const text = (nodes[i] as HTMLElement).innerText || "";
        if (
          /Evaluate this tender for Siyana Info Solutions/i.test(text) &&
          (new RegExp(`T247-${t247Id}\\b`, "i").test(text) ||
            new RegExp(`\\b${t247Id}\\b`).test(text))
        ) {
          userDomIndex = i;
          break;
        }
      }
      if (userDomIndex < 0) {
        return null;
      }
      let assistantsBefore = 0;
      let usersBeforeOrAt = 0;
      for (let i = 0; i <= userDomIndex; i += 1) {
        const role = nodes[i]!.getAttribute("data-message-author-role");
        if (role === "assistant") {
          assistantsBefore += 1;
        }
        if (role === "user") {
          usersBeforeOrAt += 1;
        }
      }
      // assistantsBefore here = assistants with DOM index < user (strict)
      let strictAssistantsBefore = 0;
      for (let i = 0; i < userDomIndex; i += 1) {
        if (nodes[i]!.getAttribute("data-message-author-role") === "assistant") {
          strictAssistantsBefore += 1;
        }
      }
      return {
        assistantCountBefore: strictAssistantsBefore,
        userCountBefore: usersBeforeOrAt,
      };
    }, expectedT247Id)
    .catch(() => null);

  if (derived) {
    return derived;
  }

  const baseline = await captureMessageBaseline(page);
  return {
    assistantCountBefore: baseline.assistantCountBefore,
    userCountBefore: baseline.userCountBefore,
  };
}

export async function currentUserPromptMatchesTender(
  page: Page,
  expectedT247Id: string,
): Promise<boolean> {
  const users = page.locator('[data-message-author-role="user"]');
  const count = await users.count().catch(() => 0);
  const idRe = new RegExp(`T247-${expectedT247Id}\\b|\\b${expectedT247Id}\\b`, "i");
  for (let i = count - 1; i >= 0; i -= 1) {
    const text = (await users.nth(i).innerText().catch(() => "")) || "";
    if (!idRe.test(text)) {
      continue;
    }
    // Qualification prompt or a correction that references this tender
    if (
      /Evaluate this tender for Siyana Info Solutions/i.test(text) ||
      /ONE JSON object only|previous status|not valid JSON|For tender T247-/i.test(
        text,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function getAssistantMessageTextAt(
  page: Page,
  index: number,
): Promise<string> {
  const assistantMessages = page.locator(
    '[data-message-author-role="assistant"]',
  );
  const count = await assistantMessages.count().catch(() => 0);
  if (index < 0 || index >= count) {
    return "";
  }
  const message = assistantMessages.nth(index);
  const text = await message
    .evaluate((el) => {
      const root = el.cloneNode(true) as HTMLElement;
      const removeSelectors = [
        "details",
        "summary",
        "button",
        '[role="button"]',
        "nav",
        '[data-testid*="copy"]',
        '[data-testid*="share"]',
        '[data-testid*="regen"]',
        '[data-testid*="feedback"]',
        '[class*="citation"]',
        '[class*="sources"]',
      ];
      for (const sel of removeSelectors) {
        root.querySelectorAll(sel).forEach((node) => node.remove());
      }
      root.querySelectorAll("*").forEach((node) => {
        const t = (node.textContent || "").trim();
        if (
          /^Worked for\b/i.test(t) ||
          /^Show (more|less)$/i.test(t) ||
          /^Thinking\b/i.test(t) ||
          /^Searching\b/i.test(t) ||
          /^Working\b/i.test(t)
        ) {
          if (t.length < 80) {
            node.remove();
          }
        }
      });
      const markdown = root.querySelector(
        '.markdown, .prose, [class*="markdown"], [data-message-content]',
      );
      return (markdown?.textContent || root.textContent || "").trim();
    })
    .catch(() => "");
  return cleanAssistantAnswerText(text);
}

/**
 * Active generation for the *current* response only — not historical Thinking text.
 */
export async function hasActiveGenerationControl(
  page: Page,
  currentAssistantIndex?: number,
): Promise<boolean> {
  const stopVisible =
    (await page
      .getByRole("button", {
        name: /stop generating|stop response|^stop$/i,
      })
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  if (stopVisible) {
    return true;
  }

  const stopAria =
    (await page
      .locator(
        'button[aria-label*="Stop generating" i], button[aria-label*="Stop response" i], button[data-testid*="stop" i]',
      )
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  if (stopAria) {
    return true;
  }

  const assistantMessages = page.locator(
    '[data-message-author-role="assistant"]',
  );
  const count = await assistantMessages.count().catch(() => 0);
  if (count <= 0) {
    return false;
  }

  const index =
    typeof currentAssistantIndex === "number" && currentAssistantIndex >= 0
      ? currentAssistantIndex
      : count - 1;
  if (index < 0 || index >= count) {
    return false;
  }

  const current = assistantMessages.nth(index);
  const streaming =
    (await current
      .locator(
        '[data-testid*="streaming" i], .result-streaming, [class*="result-streaming"], [aria-busy="true"]',
      )
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  if (streaming) {
    return true;
  }

  const progress =
    (await current
      .locator('[role="progressbar"]')
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  if (progress) {
    return true;
  }

  // Active thinking label only on the current assistant bubble (not page-wide)
  const thinkingOnCurrent =
    (await current
      .getByText(/^(Thinking|Searching|Working|Reading documents|Analysing|Analyzing)\b/i)
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  return thinkingOnCurrent;
}

export async function captureResponseActivitySnapshot(
  page: Page,
  assistantCountBefore: number,
): Promise<ResponseActivitySnapshot> {
  const assistantMessages = page.locator(
    '[data-message-author-role="assistant"]',
  );
  const assistantCount = await assistantMessages.count().catch(() => 0);
  const currentIndex =
    assistantCount > assistantCountBefore ? assistantCountBefore : -1;
  const answerText =
    currentIndex >= 0
      ? await getAssistantMessageTextAt(page, currentIndex)
      : "";
  const stopVisible =
    (await page
      .getByRole("button", {
        name: /stop generating|stop response|^stop$/i,
      })
      .filter({ visible: true })
      .count()
      .catch(() => 0)) > 0;
  const active =
    stopVisible ||
    (await hasActiveGenerationControl(
      page,
      currentIndex >= 0 ? currentIndex : undefined,
    ));
  let generationLabel = "idle";
  if (active) {
    if (stopVisible) generationLabel = "stop";
    else if (/thinking/i.test(answerText)) generationLabel = "thinking";
    else if (/search/i.test(answerText)) generationLabel = "searching";
    else generationLabel = "generating";
    // Prefer live status chips on current bubble when present
    if (currentIndex >= 0) {
      const current = assistantMessages.nth(currentIndex);
      const labelText =
        (await current
          .getByText(
            /^(Thinking|Searching|Working|Generating|Reading documents|Analysing|Analyzing)\b/i,
          )
          .filter({ visible: true })
          .first()
          .innerText()
          .catch(() => "")) || "";
      if (/thinking/i.test(labelText)) generationLabel = "thinking";
      else if (/search/i.test(labelText)) generationLabel = "searching";
      else if (/generat/i.test(labelText)) generationLabel = "generating";
      else if (/working|reading|analys/i.test(labelText))
        generationLabel = "working";
    }
  }
  return {
    assistantCount,
    textLength: answerText.length,
    textFingerprint: crypto
      .createHash("sha1")
      .update(answerText.slice(0, 4000))
      .digest("hex")
      .slice(0, 12),
    active,
    generationLabel,
    stopVisible,
  };
}

/**
 * Wait for the assistant response that belongs to the just-submitted tender prompt.
 * Poll loop is non-blocking (~1–2s/iteration). Never uses long Playwright waits.
 * Stall = no meaningful activity for CHATGPT_RESPONSE_STALL_TIMEOUT_MS (fallback only).
 */
export async function waitForAssistantResponse(options: {
  page: Page;
  timeoutMs: number;
  logger: Logger;
  expectedT247Id: string;
  assistantCountBefore?: number;
  userCountBefore?: number;
  stallTimeoutMs?: number;
  /** qualification_json (default), generation_complete for XLSX, screening_json for Phase-1 decisions */
  completionMode?: "qualification_json" | "generation_complete" | "screening_json";
  /** Explicit mode. RUN_EXCEL_SCREENING completes on assistant XLSX, not JSON — unless screening_json. */
  submissionKind?: ChatGptSubmissionKind;
  inputWorkbookFileName?: string;
  onProgress?: (info: {
    elapsedSeconds: number;
    assistantCountCurrent: number;
    assistantCountBefore: number;
    processingState: string;
    lastResponseActivityAtMs: number;
  }) => void;
}): Promise<AssistantWaitResult> {
  const { page, timeoutMs, logger, expectedT247Id, onProgress } = options;
  const completionMode =
    options.completionMode ??
    (options.submissionKind === "RUN_EXCEL_SCREENING"
      ? "generation_complete"
      : "qualification_json");
  const submissionKind: ChatGptSubmissionKind =
    options.submissionKind ??
    (completionMode === "generation_complete"
      ? "RUN_EXCEL_SCREENING"
      : "TENDER_QUALIFICATION");
  // Phase-1 JSON decisions reuse the text/JSON wait path even when the workbook is attached.
  const isRunScreening =
    submissionKind === "RUN_EXCEL_SCREENING" &&
    completionMode === "generation_complete";
  const isScreeningJson = completionMode === "screening_json";
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const stallTimeoutMs =
    options.stallTimeoutMs ?? getResponseStallTimeoutMsFromEnv();
  let lastResponseActivityAt = startedAt;
  let previousSnap: ResponseActivitySnapshot | null = null;
  let responseActiveLogged = false;

  if (!isConversationUrl(page.url())) {
    throw new AutomationError(
      "CHATGPT_RESPONSE_WAIT_WITHOUT_SUBMISSION",
      `Cannot wait for a response without a /c/ conversation URL: ${page.url()}`,
    );
  }

  void mayNavigateAwayDuringResponseWait({
    promptSubmitted: true,
    conversationUrlValid: true,
    responseActive: true,
    responseComplete: false,
    pageBroken: false,
  });

  const assistantCountBefore =
    typeof options.assistantCountBefore === "number" &&
    options.assistantCountBefore >= 0
      ? options.assistantCountBefore
      : (
          await resolveResponseBinding(page, expectedT247Id, {
            assistantCountBefore: options.assistantCountBefore,
            userCountBefore: options.userCountBefore,
          }).catch(() => ({
            assistantCountBefore: 0,
            userCountBefore: 0,
          }))
        ).assistantCountBefore;

  logger.info("CHATGPT_RESPONSE_WAIT_START");
  console.log("CHATGPT_RESPONSE_WAIT_START");
  logger.info(`CHATGPT_RESPONSE_MODE=${submissionKind}`);
  console.log(`CHATGPT_RESPONSE_MODE=${submissionKind}`);
  logger.info(`CHATGPT_JSON_RESPONSE_REQUIRED=${!isRunScreening}`);
  console.log(`CHATGPT_JSON_RESPONSE_REQUIRED=${!isRunScreening}`);
  logger.info(
    `CHATGPT_RESPONSE_BASELINE assistantCountBefore=${assistantCountBefore}`,
  );
  logger.info(`CHATGPT_CONVERSATION_URL=${page.url()}`);
  console.log(`CHATGPT_CONVERSATION_URL=${page.url()}`);
  logger.info(`CHATGPT_RESPONSE_STALL_TIMEOUT_MS=${stallTimeoutMs}`);
  logger.info(`CHATGPT_RESPONSE_TIMEOUT_MS=${timeoutMs}`);

  let previousText = "";
  let previousTextHash = "";
  let stableChecks = 0;
  let textDetectedLogged = false;
  let newMessageLogged = false;
  let lastProcessingLogAt = 0;
  let lastHeartbeatAt = -1;
  let stallRecoveryAttempted = false;
  let jsonStability = createJsonStabilityState();
  let validJsonLogged = false;
  let schemaValidLogged = false;
  let jsonStableLogged = false;
  const postJsonGraceMs = getPostJsonUiGraceMs();
  if (!isRunScreening) {
    logger.info(`CHATGPT_POST_JSON_UI_GRACE_MS=${postJsonGraceMs}`);
  }
  if (!isRunScreening) {
    logger.info(
      `CHATGPT_RESPONSE_INSPECT_TIMEOUT_MS=${RESPONSE_INSPECT_TIMEOUT_MS}`,
    );
  }

  await page.keyboard.press("End").catch(() => undefined);
  await page
    .evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => undefined);

  while (Date.now() < deadline) {
    const loopStarted = Date.now();
    const elapsedMs = loopStarted - startedAt;

    if (await isRateLimitVisibleImmediate(page)) {
      throw new AutomationError(
        "CHATGPT_RATE_LIMITED",
        "ChatGPT temporarily limited requests",
      );
    }

    if (!isConversationUrl(page.url())) {
      throw new AutomationError(
        "CHATGPT_CONVERSATION_URL_LOST",
        `Left conversation URL during response wait: ${page.url()}`,
      );
    }

    if (isRunScreening) {
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const assistantCount = await countAssistantMessages(page);
      const generating = await isScreeningGenerationActive(page);
      const newAssistant = assistantCount > assistantCountBefore;
      const responseStarted = newAssistant || generating || assistantCount > 0;
      if (responseStarted && !responseActiveLogged) {
        responseActiveLogged = true;
        logger.info("CHATGPT_RESPONSE_STARTED=true");
        console.log("CHATGPT_RESPONSE_STARTED=true");
        logger.info("CHATGPT_RUN_SCREENING_STAGE=RESPONSE_STARTED");
        if (generating) {
          logger.info("CHATGPT_RUN_SCREENING_STAGE=RESPONSE_GENERATING");
        }
      }

      const { workbook, diagnostics } = await scanGeneratedScreeningOutput(page, {
        correlationId: expectedT247Id,
        inputFileName: options.inputWorkbookFileName,
        assistantCountBefore,
      });

      const generatedOutputFound = Boolean(workbook);
      const responseReady =
        (newAssistant || assistantCount > 0) &&
        !generating &&
        generatedOutputFound;

      const heartbeat = elapsedSec === 0 || elapsedSec % 10 === 0;
      if (heartbeat && !responseReady) {
        logger.info("CHATGPT_RUN_SCREENING_OUTPUT_SCAN_START");
        console.log("CHATGPT_RUN_SCREENING_OUTPUT_SCAN_START");
        const waitLine = `CHATGPT_RUN_SCREENING_WAIT elapsedSec=${elapsedSec} xlsx=${generatedOutputFound} generating=${generating}`;
        logger.info(waitLine);
        console.log(waitLine);
        logger.info(
          `[AI SCREENING] Waiting for generated XLSX... elapsed=${elapsedSec}s`,
        );
        console.log(
          `[AI SCREENING] Waiting for generated XLSX... elapsed=${elapsedSec}s`,
        );
        const emit = (message: string) => {
          logger.info(message);
          console.log(message);
        };
        logScreeningScanDiagnostics(diagnostics, emit);
      }

      if (responseReady && workbook) {
        logger.info("CHATGPT_RUN_SCREENING_OUTPUT_SCAN_START");
        console.log("CHATGPT_RUN_SCREENING_OUTPUT_SCAN_START");
        logScreeningScanDiagnostics(diagnostics, (message) => {
          logger.info(message);
          console.log(message);
        });
        if (workbook.linkFound) {
          logger.info("CHATGPT_SCREENING_DOWNLOAD_LINK_FOUND=true");
          console.log("CHATGPT_SCREENING_DOWNLOAD_LINK_FOUND=true");
          logger.info("CHATGPT_GENERATED_WORKBOOK_LINK_FOUND=true");
          console.log("CHATGPT_GENERATED_WORKBOOK_LINK_FOUND=true");
        }
        if (workbook.filenameFound || workbook.cardFound) {
          logger.info("CHATGPT_SCREENING_FILENAME_FOUND=true");
          console.log("CHATGPT_SCREENING_FILENAME_FOUND=true");
          logger.info(`CHATGPT_SCREENING_FILENAME=${workbook.filename}`);
          console.log(`CHATGPT_SCREENING_FILENAME=${workbook.filename}`);
          logger.info("CHATGPT_GENERATED_XLSX_FOUND=true");
          console.log("CHATGPT_GENERATED_XLSX_FOUND=true");
          logger.info(`CHATGPT_GENERATED_XLSX_FILENAME=${workbook.filename}`);
          console.log(`CHATGPT_GENERATED_XLSX_FILENAME=${workbook.filename}`);
        }
        if (workbook.cardFound) {
          logger.info("CHATGPT_SCREENING_FILE_CARD_FOUND=true");
          console.log("CHATGPT_SCREENING_FILE_CARD_FOUND=true");
          logger.info("CHATGPT_GENERATED_WORKBOOK_CARD_FOUND=true");
          console.log("CHATGPT_GENERATED_WORKBOOK_CARD_FOUND=true");
        }
        logger.info(`CHATGPT_GENERATION_INDICATOR_VISIBLE=${generating}`);
        console.log(`CHATGPT_GENERATION_INDICATOR_VISIBLE=${generating}`);
        logger.info("CHATGPT_RUN_SCREENING_STAGE=GENERATED_XLSX_DETECTED");
        logger.info("CHATGPT_RUN_SCREENING_RESPONSE_COMPLETE=true");
        console.log("CHATGPT_RUN_SCREENING_RESPONSE_COMPLETE=true");
        logger.info("CHATGPT_RESPONSE_COMPLETE=true");
        console.log("CHATGPT_RESPONSE_COMPLETE=true");
        logger.info("CHATGPT_RESPONSE_COMPLETE_REASON=SCREENING_XLSX");
        console.log("CHATGPT_RESPONSE_COMPLETE_REASON=SCREENING_XLSX");
        return {
          status: "complete",
          text: "",
          reason: "SCREENING_XLSX",
          outputFilename: workbook.filename,
        };
      }

      await page.waitForTimeout(1000);
      continue;
    }

    logger.info("CHATGPT_RESPONSE_INSPECT_START");
    console.log("CHATGPT_RESPONSE_INSPECT_START");

    let insp;
    try {
      logger.info("CHATGPT_RESPONSE_ASSISTANT_COUNT_START");
      console.log("CHATGPT_RESPONSE_ASSISTANT_COUNT_START");
      logger.info("CHATGPT_RESPONSE_TEXT_EXTRACT_START");
      console.log("CHATGPT_RESPONSE_TEXT_EXTRACT_START");
      insp = await inspectLatestAssistantBounded(
        page,
        assistantCountBefore,
        RESPONSE_INSPECT_TIMEOUT_MS,
      );
      logger.info(
        `CHATGPT_RESPONSE_ASSISTANT_COUNT_DONE=${insp.assistantCount}`,
      );
      console.log(
        `CHATGPT_RESPONSE_ASSISTANT_COUNT_DONE=${insp.assistantCount}`,
      );
      logger.info("CHATGPT_RESPONSE_TEXT_EXTRACT_DONE=true");
      console.log("CHATGPT_RESPONSE_TEXT_EXTRACT_DONE=true");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`CHATGPT_ASSISTANT_INSPECTION_TIMEOUT=${message}`);
      console.log(`CHATGPT_ASSISTANT_INSPECTION_TIMEOUT=${message}`);
      await page.waitForTimeout(1000);
      continue;
    }

    const snap = inspectionToActivitySnapshot(insp);
    const activity = updateLastResponseActivityAt({
      previous: previousSnap,
      next: snap,
      lastActivityAtMs: lastResponseActivityAt,
      nowMs: Date.now(),
    });
    lastResponseActivityAt = activity.lastActivityAtMs;
    if (activity.changed) {
      logger.info("CHATGPT_RESPONSE_ACTIVITY_DETECTED=true");
      console.log("CHATGPT_RESPONSE_ACTIVITY_DETECTED=true");
    }
    previousSnap = snap;

    if (snap.active && activity.changed && !responseActiveLogged) {
      logger.info("CHATGPT_RESPONSE_ACTIVE=true");
      console.log("CHATGPT_RESPONSE_ACTIVE=true");
      logger.info("CHATGPT_RESPONSE_GENERATING");
      console.log("CHATGPT_RESPONSE_GENERATING");
      responseActiveLogged = true;
    }

    const assistantCountCurrent = insp.assistantCount;
    const answerText = insp.latestText;
    const textHash = insp.textHash;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    logger.info("CHATGPT_RESPONSE_JSON_CHECK_START");
    console.log("CHATGPT_RESPONSE_JSON_CHECK_START");
    const quickJson = tryParseCanonicalQualificationJson(
      answerText,
      expectedT247Id,
    );
    logger.info("CHATGPT_RESPONSE_JSON_CHECK_DONE=true");
    console.log("CHATGPT_RESPONSE_JSON_CHECK_DONE=true");

    if (lastHeartbeatAt < 0 || elapsedMs - lastHeartbeatAt >= 5_000) {
      lastHeartbeatAt = elapsedMs;
      console.log("CHATGPT_RESPONSE_POLL_HEARTBEAT=true");
      logger.info("CHATGPT_RESPONSE_POLL_HEARTBEAT=true");
      console.log(`CHATGPT_RESPONSE_POLL_ELAPSED_MS=${elapsedMs}`);
      logger.info(`CHATGPT_RESPONSE_POLL_ELAPSED_MS=${elapsedMs}`);
      console.log(`CHATGPT_RESPONSE_CURRENT_URL=${page.url()}`);
      logger.info(`CHATGPT_RESPONSE_CURRENT_URL=${page.url()}`);
      console.log(`CHATGPT_ASSISTANT_MESSAGE_COUNT=${assistantCountCurrent}`);
      logger.info(`CHATGPT_ASSISTANT_MESSAGE_COUNT=${assistantCountCurrent}`);
      console.log(
        `CHATGPT_LATEST_ASSISTANT_TEXT_LENGTH=${answerText.length}`,
      );
      logger.info(
        `CHATGPT_LATEST_ASSISTANT_TEXT_LENGTH=${answerText.length}`,
      );
      console.log(`CHATGPT_VALID_JSON_DETECTED=${quickJson.ok}`);
      logger.info(`CHATGPT_VALID_JSON_DETECTED=${quickJson.ok}`);
      console.log(
        `CHATGPT_GENERATION_INDICATOR_VISIBLE=${insp.stopVisible || insp.active}`,
      );
      logger.info(
        `CHATGPT_GENERATION_INDICATOR_VISIBLE=${insp.stopVisible || insp.active}`,
      );
    }

    const meaningfullyActive = snap.active && activity.changed;
    const stalled = isResponseActivityStalled({
      lastActivityAtMs: lastResponseActivityAt,
      nowMs: Date.now(),
      stallMs: stallTimeoutMs,
      currentlyActive: meaningfullyActive,
      ignoreStickyActive: true,
    });

    if (stalled) {
      logger.warn("CHATGPT_RESPONSE_STALL_RECOVERY_START");
      console.log("CHATGPT_RESPONSE_STALL_RECOVERY_START");
      await page.keyboard.press("End").catch(() => undefined);
      if (assistantCountCurrent > assistantCountBefore && answerText.trim()) {
        logger.info(
          "CHATGPT_RESPONSE_STALL_RECOVERY=found_assistant_text — consuming",
        );
        lastResponseActivityAt = Date.now();
      } else if (!stallRecoveryAttempted) {
        stallRecoveryAttempted = true;
        lastResponseActivityAt = Date.now();
        await page.waitForTimeout(1000);
        continue;
      } else {
        logger.warn("CHATGPT_RESPONSE_STALLED=true");
        console.log("CHATGPT_RESPONSE_STALLED=true");
        return {
          status: "stalled",
          text: answerText,
          uiState: "stalled_no_activity",
        };
      }
    }

    if (assistantCountCurrent <= assistantCountBefore) {
      stableChecks = 0;
      previousText = "";
      previousTextHash = "";
      jsonStability = createJsonStabilityState();
      if (elapsedSeconds - lastProcessingLogAt >= 30) {
        logger.info(
          `CHATGPT_RESPONSE_STILL_PROCESSING t247Id=${expectedT247Id} elapsedSeconds=${elapsedSeconds} assistantCountBefore=${assistantCountBefore} assistantCountCurrent=${assistantCountCurrent}`,
        );
        lastProcessingLogAt = elapsedSeconds;
        onProgress?.({
          elapsedSeconds,
          assistantCountCurrent,
          assistantCountBefore,
          processingState: snap.active ? "thinking" : "waiting_for_assistant",
          lastResponseActivityAtMs: lastResponseActivityAt,
        });
      }
      await page.waitForTimeout(1000);
      continue;
    }

    if (!newMessageLogged) {
      logger.info("CHATGPT_NEW_ASSISTANT_MESSAGE_DETECTED=true");
      console.log("CHATGPT_NEW_ASSISTANT_MESSAGE_DETECTED=true");
      logger.info("CHATGPT_LATEST_ASSISTANT_MESSAGE_FOUND=true");
      console.log("CHATGPT_LATEST_ASSISTANT_MESSAGE_FOUND=true");
      logger.info(`CHATGPT_ASSISTANT_TEXT_LENGTH=${answerText.length}`);
      console.log(`CHATGPT_ASSISTANT_TEXT_LENGTH=${answerText.length}`);
      logger.info(
        `CHATGPT_LATEST_ASSISTANT_TEXT_LENGTH=${answerText.length}`,
      );
      console.log(
        `CHATGPT_LATEST_ASSISTANT_TEXT_LENGTH=${answerText.length}`,
      );
      newMessageLogged = true;
    }

    if (textHash !== previousTextHash && answerText.trim()) {
      logger.info("CHATGPT_ASSISTANT_TEXT_CHANGED=true");
      console.log("CHATGPT_ASSISTANT_TEXT_CHANGED=true");
      logger.info(`CHATGPT_ASSISTANT_TEXT_LENGTH=${answerText.length}`);
      console.log(`CHATGPT_ASSISTANT_TEXT_LENGTH=${answerText.length}`);
    }

    if (!answerText.trim()) {
      stableChecks = 0;
      previousText = "";
      previousTextHash = "";
      await page.waitForTimeout(1000);
      continue;
    }

    if (!textDetectedLogged) {
      logger.info("CHATGPT_RESPONSE_TEXT_DETECTED");
      textDetectedLogged = true;
    }

    const jsonTick = isScreeningJson
      ? tickScreeningJsonStability({
          text: answerText,
          textHash,
          previous: jsonStability,
          nowMs: Date.now(),
          stopStillVisible: insp.stopVisible || insp.active,
          postJsonUiGraceMs: postJsonGraceMs,
        })
      : tickCanonicalJsonStability({
          text: answerText,
          textHash,
          expectedT247Id,
          previous: jsonStability,
          nowMs: Date.now(),
          stopStillVisible: insp.stopVisible || insp.active,
          postJsonUiGraceMs: postJsonGraceMs,
        });
    jsonStability = jsonTick.state;

    if (jsonTick.validJson) {
      if (!validJsonLogged) {
        logger.info("CHATGPT_VALID_JSON_DETECTED=true");
        console.log("CHATGPT_VALID_JSON_DETECTED=true");
        validJsonLogged = true;
      }
      if (jsonTick.schemaValid && !schemaValidLogged) {
        logger.info("CHATGPT_VALID_JSON_SCHEMA_VALID=true");
        console.log("CHATGPT_VALID_JSON_SCHEMA_VALID=true");
        schemaValidLogged = true;
      }
      logger.info(
        `CHATGPT_VALID_JSON_STABLE_POLLS=${jsonStability.stablePolls}`,
      );
      console.log(
        `CHATGPT_VALID_JSON_STABLE_POLLS=${jsonStability.stablePolls}`,
      );

      if (jsonTick.stable && !jsonStableLogged) {
        logger.info("CHATGPT_VALID_JSON_STABLE=true");
        console.log("CHATGPT_VALID_JSON_STABLE=true");
        jsonStableLogged = true;
      }

      if (jsonTick.shouldComplete && completionMode !== "generation_complete") {
        if (jsonTick.ignoreStaleStop) {
          logger.info("CHATGPT_STALE_GENERATION_INDICATOR_IGNORED=true");
          console.log("CHATGPT_STALE_GENERATION_INDICATOR_IGNORED=true");
        }
        logger.info("CHATGPT_RESPONSE_COMPLETE=true");
        console.log("CHATGPT_RESPONSE_COMPLETE=true");
        logger.info(
          "CHATGPT_RESPONSE_COMPLETE_REASON=CANONICAL_JSON_STABLE",
        );
        console.log(
          "CHATGPT_RESPONSE_COMPLETE_REASON=CANONICAL_JSON_STABLE",
        );
        logger.info(`CHATGPT_RESPONSE_LENGTH=${answerText.length}`);
        console.log(`CHATGPT_RESPONSE_LENGTH=${answerText.length}`);
        return {
          status: "complete",
          text: answerText,
          reason: "CANONICAL_JSON_STABLE",
        };
      }

      previousText = answerText;
      previousTextHash = textHash;
      const spent = Date.now() - loopStarted;
      await page.waitForTimeout(Math.max(200, 1000 - spent));
      continue;
    }

    const activeGeneration = snap.active;
    if (answerText === previousText && !activeGeneration) {
      stableChecks += 1;
      logger.info(`CHATGPT_RESPONSE_STABILITY_CHECK=${stableChecks}/3`);
    } else if (answerText !== previousText) {
      stableChecks = 0;
      previousText = answerText;
      previousTextHash = textHash;
      const spent = Date.now() - loopStarted;
      await page.waitForTimeout(Math.max(200, 1000 - spent));
      continue;
    }

    previousText = answerText;
    previousTextHash = textHash;

    if (stableChecks >= 3 && !activeGeneration) {
      logger.info("CHATGPT_RESPONSE_COMPLETE=true");
      console.log("CHATGPT_RESPONSE_COMPLETE=true");
      logger.info("CHATGPT_RESPONSE_COMPLETE_REASON=TEXT_STABLE");
      console.log("CHATGPT_RESPONSE_COMPLETE_REASON=TEXT_STABLE");
      return {
        status: "complete",
        text: answerText,
        reason: "TEXT_STABLE",
      };
    }

    const spent = Date.now() - loopStarted;
    await page.waitForTimeout(Math.max(200, 1000 - spent));
  }

  try {
    if (isRunScreening) {
      const workbook = (
        await scanGeneratedScreeningOutput(page, {
          correlationId: expectedT247Id,
          inputFileName: options.inputWorkbookFileName,
          assistantCountBefore,
        })
      ).workbook;
      if (workbook) {
        logger.info("CHATGPT_GENERATED_XLSX_FOUND=true");
        logger.info(`CHATGPT_GENERATED_XLSX_FILENAME=${workbook.filename}`);
        logger.info("CHATGPT_RUN_SCREENING_RESPONSE_COMPLETE=true");
        return {
          status: "complete",
          text: "",
          reason: "SCREENING_XLSX",
          outputFilename: workbook.filename,
        };
      }
      throw new AutomationError(
        "SCREENING_OUTPUT_MISSING",
        "SCREENING_OUTPUT_MISSING: response wait timed out without an assistant Excel workbook",
      );
    }
    const finalInsp = await inspectLatestAssistantBounded(
      page,
      assistantCountBefore,
      RESPONSE_INSPECT_TIMEOUT_MS,
    );
    const lastChance = tryParseCanonicalQualificationJson(
      finalInsp.latestText,
      expectedT247Id,
    );
    if (lastChance.ok && completionMode !== "generation_complete") {
      logger.info("CHATGPT_VALID_JSON_DETECTED=true");
      logger.info("CHATGPT_RESPONSE_COMPLETE=true");
      console.log("CHATGPT_RESPONSE_COMPLETE=true");
      logger.info(
        "CHATGPT_RESPONSE_COMPLETE_REASON=CANONICAL_JSON_AT_TIMEOUT",
      );
      return {
        status: "complete",
        text: finalInsp.latestText,
        reason: "CANONICAL_JSON_AT_TIMEOUT",
      };
    }
    logger.warn("CHATGPT_RESPONSE_TIMEOUT_PENDING");
    return {
      status: "pending_timeout",
      text: finalInsp.latestText,
      uiState: "timeout",
    };
  } catch (error) {
    if (error instanceof AutomationError && error.code === "SCREENING_OUTPUT_MISSING") {
      throw error;
    }
    logger.warn("CHATGPT_RESPONSE_TIMEOUT_PENDING");
    return { status: "pending_timeout", text: "", uiState: "timeout" };
  }
}

/** @deprecated Prefer hasActiveGenerationControl */
export async function isGeneratingOrSearching(page: Page): Promise<boolean> {
  return hasActiveGenerationControl(page);
}

export async function isComposerAvailableForReply(page: Page): Promise<boolean> {
  const composer = page
    .locator(
      [
        '[contenteditable="true"]#prompt-textarea',
        '[contenteditable="true"][aria-label*="Message" i]',
        '[contenteditable="true"][aria-label*="chat" i]',
        '[contenteditable="true"]',
      ].join(","),
    )
    .filter({ visible: true })
    .first();
  return composer.isVisible().catch(() => false);
}

export async function describeGenerationUiState(page: Page): Promise<string> {
  if (await hasActiveGenerationControl(page)) {
    return "stop_or_streaming";
  }
  return "idle";
}

/**
 * Final answer text from the latest assistant message only.
 * Prefer waitForAssistantResponse with a baseline for tender qualification.
 */
export async function getLatestAssistantFinalAnswer(
  page: Page,
): Promise<string> {
  const assistantMessages = page.locator(
    '[data-message-author-role="assistant"]',
  );
  const count = await assistantMessages.count().catch(() => 0);
  if (count <= 0) {
    return "";
  }
  return getAssistantMessageTextAt(page, count - 1);
}

export async function readLastAssistantMessage(page: Page): Promise<string> {
  return getLatestAssistantFinalAnswer(page);
}

function cleanAssistantAnswerText(text: string): string {
  return text
    .replace(/\bWorked for\s+\d+[hm]?(?:\s*\d+[sm])?\b/gi, "")
    .replace(/\bShow (more|less)\b/gi, "")
    .replace(/\bThinking(?:\s+for\s+[\d.]+s)?\b/gi, "")
    .replace(/\bSearching\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function looksLikeCompleteQualificationJson(
  text: string,
  expectedT247Id?: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith("}")) {
    return false;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return false;
  }

  const slice = trimmed.slice(start, end + 1);
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]!;
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
  }
  if (depth !== 0) {
    return false;
  }

  if (
    !/"status"\s*:\s*"(GO|CONDITIONAL_GO|PARTNER_BID|VERIFY|NO_GO|WILL_BID|NO_BID|PARTNERSHIP|MAY_BID)"/i.test(
      slice,
    )
  ) {
    return false;
  }

  if (expectedT247Id) {
    const idPattern = new RegExp(
      `"t247Id"\\s*:\\s*"${expectedT247Id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      "i",
    );
    if (!idPattern.test(slice) && !slice.includes(expectedT247Id)) {
      return false;
    }
  }

  return true;
}

export function assertMasterPdfExists(masterPdfPath: string): string {
  const resolved = path.resolve(masterPdfPath);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).size <= 0) {
    throw new AutomationError(
      "SIYANA_MASTER_PDF_MISSING",
      `Siyana master PDF not found or empty: ${resolved}`,
    );
  }
  return resolved;
}

/**
 * Phase 1 uploads: metadata.json + optional AI_Summary.pdf + Tender_All_Documents.zip.
 * Never upload Consolidated Siyana Docs or outer T247-{ID}.zip.
 */
export function selectUploadFilesForChatGpt(options: {
  orderedFiles: string[];
  metadataPath: string | null;
  aiSummaryPath: string | null;
  documentZipPath?: string | null;
  maxFiles: number;
  logger: Logger;
}): string[] {
  const { metadataPath, aiSummaryPath, documentZipPath, logger } = options;
  void options.orderedFiles;
  const maxFiles = options.maxFiles > 0 ? options.maxFiles : 3;

  const selected: string[] = [];
  const seen = new Set<string>();

  const push = (p: string | null | undefined): void => {
    if (!p) {
      return;
    }
    const abs = path.resolve(p);
    if (seen.has(abs.toLowerCase())) {
      return;
    }
    if (!fs.existsSync(abs) || fs.statSync(abs).size <= 0) {
      return;
    }
    const base = path.basename(abs).toLowerCase();
    if (
      base.includes("consolidated siyana") ||
      /^t247-\d+\.zip$/i.test(base)
    ) {
      logger.warn(`CHATGPT_UPLOAD_SKIP_FORBIDDEN=${path.basename(abs)}`);
      return;
    }
    seen.add(abs.toLowerCase());
    selected.push(abs);
  };

  // Order: metadata → optional AI Summary → documents
  push(metadataPath);
  push(aiSummaryPath);
  push(documentZipPath);

  if (selected.length < 2 || selected.length > maxFiles) {
    throw new AutomationError(
      "CHATGPT_PHASE1_UPLOAD_INCOMPLETE",
      `Phase 1 requires metadata.json + Tender_All_Documents.zip (+ optional AI_Summary.pdf); got ${selected.length}: ${selected
        .map((p) => path.basename(p))
        .join(", ")}`,
    );
  }

  const hasMeta = selected.some((p) =>
    /metadata\.json$/i.test(path.basename(p)),
  );
  const hasDocs = selected.some(
    (p) =>
      /tender_all_documents/i.test(path.basename(p)) ||
      /\.zip$/i.test(path.basename(p)),
  );
  if (!hasMeta || !hasDocs) {
    throw new AutomationError(
      "CHATGPT_PHASE1_UPLOAD_INCOMPLETE",
      `Phase 1 requires metadata + document archive (got: ${selected
        .map((p) => path.basename(p))
        .join(", ")})`,
    );
  }

  logger.info(`CHATGPT_TENDER_UPLOAD_COUNT=${selected.length}`);
  for (const p of selected) {
    logger.info(`CHATGPT_UPLOAD_FILE=${path.basename(p)}`);
  }
  return selected;
}

export async function saveUploadFailureDiagnostics(options: {
  page: Page;
  screenshotRoot: string;
  t247Id: string;
  logger: Logger;
}): Promise<void> {
  const { page, screenshotRoot, t247Id, logger } = options;
  try {
    const dir = screenshotDirForToday(screenshotRoot);
    ensureDir(dir);
    const stamp = getLocalTimestamp();
    const shot = path.join(dir, `chatgpt_upload_fail_T247-${t247Id}_${stamp}.png`);
    const htmlPath = path.join(
      dir,
      `chatgpt_upload_fail_T247-${t247Id}_${stamp}.html`,
    );
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    const html = await page.content().catch(() => "");
    if (html) {
      fs.writeFileSync(htmlPath, html, "utf8");
    }
    logger.info(`CHATGPT_UPLOAD_FAILURE_SCREENSHOT=${shot}`);
    logger.info(`CHATGPT_UPLOAD_FAILURE_HTML=${htmlPath}`);
  } catch (error) {
    logger.warn(
      `Failed to save upload diagnostics: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
