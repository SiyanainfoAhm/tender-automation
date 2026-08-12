import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { requestedDateFromDateFolder } from "../tender247Batch/tender247RunContext.js";
import {
  isResumablePendingState,
  hasInvalidPendingChatUrl,
  invalidatePendingChatWithoutAttachments,
  loadChatGptTenderState,
  saveChatGptTenderState,
  upsertQualificationManifestEntry,
} from "./chatgptState.js";
import {
  cleanupTenderTempUpload,
  handleRateLimitModal,
  isConversationUrl,
  prepareTenderSpecificUploadFiles,
  saveUploadFailureDiagnostics,
  sendComposerMessage,
  typeComposerPrompt,
  waitForAssistantResponse,
  type MessageBaseline,
} from "./chatInteraction.js";
import {
  assertTender247BundleComplete,
  enterPromptAndSendWithConfirmedAttachments,
  logAttachmentBundle,
  uploadQualificationAttachments,
  writeAttachmentManifestAuditFile,
} from "./uploadQualificationAttachments.js";
import {
  advanceCandidateStage,
  createCandidateTxnState,
  getMaxChatgptCandidateAttempts,
  type ChatGptCandidateTxnState,
} from "./candidateTxnState.js";
import { saveCandidateFailureAudit } from "./candidateFailureAudit.js";
import crypto from "node:crypto";
import {
  ensureProjectHome,
  logProjectHomeDiagnostics,
  assertProjectHomeOpen,
} from "./openProject.js";
import {
  buildQualificationPrompt,
  buildStatusCorrectionPrompt,
  claimsMandatoryUploadsUnavailable,
  isValidSavedQualificationResult,
  parseAndValidateQualificationResponse,
  withUploadedEvidenceFiles,
} from "./qualificationSchema.js";
import {
  getMissingPhase1Files,
  tryResolvePhase1TenderUploadFiles,
} from "./readiness.js";
import { assertPrescreenAllowsChatgpt } from "../prescreen/chatgptGate.js";
import type { QualificationResult } from "./types.js";
import { persistValidatedQualificationToSupabase } from "../supabase/persistQualification.js";
import { resolveQualificationFiles } from "./sourceDocumentResolver.js";

export interface QualifyTenderOutcome {
  t247Id: string;
  status:
    | "completed"
    | "skipped"
    | "failed"
    | "response_pending"
    | "not_ready"
    | "rate_limited";
  resultPath: string | null;
  responsePath: string | null;
  qualification: QualificationResult | null;
  chatUrl: string | null;
  error: string | null;
  missingFiles?: string[];
  retryAfterMs?: number;
  /** Epoch ms when the qualification prompt was successfully submitted (this run). */
  submittedAt?: number;
  /** Candidate attempt number (1 = first, 2 = controlled retry). */
  attempt?: number;
  /** True when another controlled attempt is allowed. */
  retryable?: boolean;
  /** Last known transaction stage for failure isolation. */
  failureStage?: string | null;
}

/**
 * Qualify one tender: local recovery → pending resume → new Project chat.
 */
export async function qualifySingleTender(options: {
  page: Page;
  dateFolder: string;
  t247Id: string;
  config: AppConfig;
  logger: Logger;
  /** Optional batch totals written into the day manifest */
  manifestTotals?: {
    expectedTender247: number;
    readyForChatGpt: number;
    selected: number;
  };
  /** When true, ignore saved qualification results and rerun ChatGPT from scratch. */
  forceReprocess?: boolean;
}): Promise<QualifyTenderOutcome> {
  const { page, dateFolder, t247Id, config, logger } = options;
  const forceReprocess = options.forceReprocess === true;
  // Source/run date comes from the caller's date folder — never system today.
  const dateIso = requestedDateFromDateFolder(dateFolder);
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  ensureDir(tenderFolder);
  const resultPath = path.join(tenderFolder, "qualification-result.json");
  const responsePath = path.join(tenderFolder, "qualification-response.txt");
  const totals = options.manifestTotals;
  const maxAttempts = getMaxChatgptCandidateAttempts();
  const priorAttempt = loadChatGptTenderState(tenderFolder)?.retryCount ?? 0;
  const attempt = Math.min(priorAttempt + 1, maxAttempts);
  const txn: ChatGptCandidateTxnState = createCandidateTxnState(attempt);

  if (!forceReprocess && isValidSavedQualificationResult(resultPath)) {
    logger.info(`CHATGPT_QUALIFICATION_ALREADY_COMPLETE_SKIP=T247-${t247Id}`);
    const qualification = JSON.parse(
      fs.readFileSync(resultPath, "utf8"),
    ) as QualificationResult;
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "skipped",
        qualificationStatus: qualification.status,
        chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
        resultPath,
        responsePath: fs.existsSync(responsePath) ? responsePath : null,
        updatedAt: new Date().toISOString(),
        error: null,
      },
      totals,
    );
    return {
      t247Id,
      status: "skipped",
      resultPath,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification,
      chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
      error: null,
    };
  }

  // ---- Local raw-response recovery (no ChatGPT / no re-upload) ----
  if (!forceReprocess) {
    const localRecovery = tryRecoverFromExistingRawResponse({
      t247Id,
      tenderFolder,
      dateFolder,
      dateIso,
      resultPath,
      responsePath,
      logger,
      totals,
    });
    if (localRecovery) {
      return localRecovery;
    }
  } else {
    logger.info(`QUALIFICATION_REPROCESSED=true T247-${t247Id}`);
    console.log(`QUALIFICATION_REPROCESSED=true T247-${t247Id}`);
  }

  const prescreenGate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderId: t247Id,
    logger,
  });
  if (!prescreenGate.allowed) {
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "skipped",
        qualificationStatus: null,
        chatUrl: null,
        resultPath: null,
        responsePath: null,
        updatedAt: new Date().toISOString(),
        error: `prescreen:${prescreenGate.reasonCode ?? "BLOCKED"}`,
      },
      totals,
    );
    return {
      t247Id,
      status: "skipped",
      resultPath: null,
      responsePath: null,
      qualification: null,
      chatUrl: null,
      error: `prescreen:${prescreenGate.reasonCode ?? "BLOCKED"}`,
    };
  }

  const existingState = loadChatGptTenderState(tenderFolder);

  if (
    existingState?.status === "failed" &&
    !isConversationUrl(existingState.chatUrl || "")
  ) {
    logger.info(
      `CHATGPT_FAILED_STATE_RETRY=T247-${t247Id} (no valid chatUrl — not skipped)`,
    );
  }

  try {
    if (hasInvalidPendingChatUrl(existingState)) {
      logger.warn(
        `CHATGPT_INVALID_PENDING_CHAT_URL=${existingState?.chatUrl ?? ""}`,
      );
      // Treat as unsubmitted; keep invalid state until a verified /c/ URL is saved.
    }

    // ---- Resume pending / rate-limited / failed-with-/c/ chat ----
    if (
      existingState &&
      !isResumablePendingState(existingState) &&
      isConversationUrl(existingState.chatUrl || "") &&
      existingState.requiredAttachmentsConfirmed !== true
    ) {
      invalidatePendingChatWithoutAttachments(
        tenderFolder,
        "Existing /c/ chat missing requiredAttachmentsConfirmed — will start fresh",
      );
      logger.warn(
        `CHATGPT_PENDING_CHAT_INVALIDATED=T247-${t247Id} reason=attachments_not_confirmed`,
      );
    }

    if (isResumablePendingState(existingState)) {
      logger.info(`CHATGPT_PENDING_CHAT_RESUME=T247-${t247Id}`);
      await page.goto(existingState.chatUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2500);

      const rateLimited = await handleRateLimitModal(page, logger);
      if (rateLimited) {
        const retryCount = (existingState.retryCount || 0) + 1;
        const retryAfter = new Date(
          Date.now() + config.chatgptRateLimitInitialBackoffMs,
        ).toISOString();
        const statusWithUrl = isConversationUrl(existingState.chatUrl)
          ? ("rate_limited" as const)
          : ("response_pending" as const);
        saveChatGptTenderState(tenderFolder, {
          ...existingState,
          t247Id,
          chatUrl: existingState.chatUrl,
          status: statusWithUrl,
          updatedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
          retryCount,
          retryAfter,
          error: "ChatGPT temporarily limited requests",
        });
        logger.info(
          `CHATGPT_RATE_LIMIT_BACKOFF_SECONDS=${Math.round(
            config.chatgptRateLimitInitialBackoffMs / 1000,
          )}`,
        );
        return {
          t247Id,
          status: "rate_limited",
          resultPath: null,
          responsePath: fs.existsSync(responsePath) ? responsePath : null,
          qualification: null,
          chatUrl: existingState.chatUrl,
          error: "ChatGPT temporarily limited requests",
          retryAfterMs: config.chatgptRateLimitInitialBackoffMs,
        };
      }

      logger.info("CHATGPT_PENDING_CHAT_OPENED");
      logger.info(`CHATGPT_CHAT_URL_SAVED=${existingState.chatUrl}`);

      return await waitParseAndPersist({
        page,
        t247Id,
        tenderFolder,
        dateFolder,
        dateIso,
        resultPath,
        responsePath,
        chatUrl: existingState.chatUrl,
        config,
        logger,
        allowCorrectionPrompt: true,
        totals,
        baseline: {
          assistantCountBefore: existingState.assistantCountBefore ?? 0,
          userCountBefore: existingState.userCountBefore ?? 0,
          capturedAt:
            existingState.promptSubmittedAt || existingState.updatedAt,
        },
        submissionConfirmed:
          existingState.submissionConfirmed === true ||
          Boolean(existingState.promptSubmittedAt),
        uploadedEvidenceFiles: existingState.uploadedEvidenceFiles || [],
      });
    }

    const missingFiles = getMissingPhase1Files(dateFolder, t247Id);
    if (
      missingFiles.length > 0 ||
      !tryResolvePhase1TenderUploadFiles(dateFolder, t247Id, logger)
    ) {
      logger.warn(
        `CHATGPT_TENDER_NOT_READY=T247-${t247Id} missing=${missingFiles.join(",")}`,
      );
      saveChatGptTenderState(tenderFolder, {
        t247Id,
        chatUrl: null,
        status: "not_ready",
        updatedAt: new Date().toISOString(),
        missingFiles,
        error: `Missing: ${missingFiles.join(", ")}`,
      });
      upsertQualificationManifestEntry(
        dateFolder,
        dateIso,
        {
          t247Id,
          status: "not_ready",
          missingFiles,
          updatedAt: new Date().toISOString(),
          error: `Missing: ${missingFiles.join(", ")}`,
        },
        totals,
      );
      return {
        t247Id,
        status: "not_ready",
        resultPath: null,
        responsePath: null,
        qualification: null,
        chatUrl: null,
        error: null,
        missingFiles,
      };
    }

    // Resolve + validate attachments BEFORE Project Home / conversation
    // Reset per-tender attachment confirmation — never carry from prior tender
    let requiredAttachmentsConfirmed = false;
    let attachmentFileNames: string[] = [];
    let attachmentHashes: string[] = [];
    let composerIdentity: string | null = null;
    let submissionConfirmed = false;

    const attachmentBundle = await resolveQualificationFiles(
      "TENDER247",
      t247Id,
      tenderFolder,
    );

    assertTender247BundleComplete(
      attachmentBundle.files,
      t247Id,
      attachmentBundle.aiSummaryAvailable,
    );
    logAttachmentBundle("TENDER247", t247Id, attachmentBundle.files, logger);

    try {
      await ensureProjectHome({
        page,
        projectName: config.chatgptProjectName,
        projectMatch: config.chatgptProjectMatch,
        projectUrl: config.chatgptProjectUrl,
        config,
        logger,
      });
      assertProjectHomeOpen(page);

      logger.info(`CHATGPT_CHAT_TITLE_HINT=T247-${t247Id} Qualification`);

      const prepared = prepareTenderSpecificUploadFiles({
        t247Id,
        tenderFolder,
        metadataPath: attachmentBundle.metadataPath,
        aiSummaryPath: attachmentBundle.aiSummaryPath,
        documentZipPath: attachmentBundle.documentArchivePath,
        logger,
      });

      try {
        const prompt = buildQualificationPrompt("TENDER247", t247Id, {
          aiSummaryAvailable:
            prepared.aiSummaryAvailable || attachmentBundle.aiSummaryAvailable,
        });
        fs.writeFileSync(
          path.join(tenderFolder, "qualification-prompt.txt"),
          prompt,
          "utf8",
        );

        const confirmed = await uploadQualificationAttachments({
          page,
          sourcePortal: "TENDER247",
          sourceTenderId: t247Id,
          files: attachmentBundle.files,
          logger,
          config,
        });
        requiredAttachmentsConfirmed = true;
        attachmentFileNames = confirmed.fileNames;
        attachmentHashes = confirmed.attachmentHashes;
        composerIdentity = confirmed.composerIdentity;

        if (confirmed.attachmentManifest) {
          const keptPipelineAuditDir = path.join(
            dateFolder,
            "kept-pipeline-test",
          );
          const manifestPath = writeAttachmentManifestAuditFile({
            tenderFolder,
            audit: confirmed.attachmentManifest,
            keptPipelineAuditDir: fs.existsSync(keptPipelineAuditDir)
              ? keptPipelineAuditDir
              : null,
          });
          logger.info(`CHATGPT_ATTACHMENT_MANIFEST_SAVED=${manifestPath}`);
        }

        saveChatGptTenderState(tenderFolder, {
          t247Id,
          sourcePortal: "TENDER247",
          sourceTenderId: t247Id,
          chatUrl: null,
          status: "attachments_confirmed",
          submissionConfirmed: false,
          requiredAttachmentsConfirmed: true,
          attachmentFileNames,
          attachmentCount: attachmentFileNames.length,
          attachmentHashes,
          attachmentConfirmedAt: new Date().toISOString(),
          composerIdentity,
          phase: "FILES_UPLOADED",
          updatedAt: new Date().toISOString(),
          error: null,
          metadataSha256: prepared.metadataSha256,
          aiSummarySha256: prepared.aiSummarySha256,
          tenderDocumentsSha256: prepared.documentsSha256,
          metadataUploaded: true,
          aiSummaryAvailable: prepared.aiSummaryAvailable,
          aiSummaryUploaded: prepared.aiSummaryAvailable,
          documentArchiveUploaded: true,
          uploadedEvidenceFiles: attachmentFileNames,
        });

        Object.assign(
          txn,
          advanceCandidateStage(txn, "FILES_LOCKED"),
        );
        console.log("CHATGPT_ATTACHMENTS_LOCKED=true");
        logger.info("CHATGPT_ATTACHMENTS_LOCKED=true");

        const submitted = await enterPromptAndSendWithConfirmedAttachments({
          page,
          prompt,
          logger,
          confirmed,
          txn,
        });
        submissionConfirmed = true;
        const chatUrl = submitted.chatUrl;
        const baseline = submitted.baseline;
        const submittedAt = Date.now();
        const promptHash = crypto
          .createHash("sha256")
          .update(prompt)
          .digest("hex")
          .slice(0, 16);

        if (!isConversationUrl(chatUrl)) {
          throw new AutomationError(
            "CHATGPT_PROMPT_NOT_SUBMITTED",
            `Verified submission missing /c/ conversation URL (got ${chatUrl})`,
          );
        }

        // Persist pending state — merge onto attachment evidence (do not drop fields)
        const evidenceFiles = attachmentFileNames;
        saveChatGptTenderState(tenderFolder, {
          t247Id,
          sourcePortal: "TENDER247",
          sourceTenderId: t247Id,
          chatUrl,
          submittedChatUrl: chatUrl,
          status: "response_pending",
          submissionConfirmed: true,
          requiredAttachmentsConfirmed: true,
          attachmentFileNames: evidenceFiles,
          attachmentCount: evidenceFiles.length,
          attachmentHashes,
          attachmentConfirmedAt: new Date().toISOString(),
          composerIdentity,
          phase: "CONVERSATION_URL_CONFIRMED",
          promptSubmittedAt: new Date(submittedAt).toISOString(),
          lastObservedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assistantCountBefore: baseline.assistantCountBefore,
          userCountBefore: baseline.userCountBefore,
          promptHash,
          latestAssistantText: null,
          uiState: "submitted",
          processingState: "waiting",
          error: null,
          metadataSha256: prepared.metadataSha256,
          aiSummarySha256: prepared.aiSummarySha256,
          tenderDocumentsSha256: prepared.documentsSha256,
          metadataUploaded: true,
          aiSummaryAvailable: prepared.aiSummaryAvailable,
          aiSummaryUploaded: prepared.aiSummaryAvailable,
          documentArchiveUploaded: true,
          uploadedEvidenceFiles: evidenceFiles,
        });
        void requiredAttachmentsConfirmed;
        void submissionConfirmed;
        upsertQualificationManifestEntry(
          dateFolder,
          dateIso,
          {
            t247Id,
            status: "response_pending",
            chatUrl,
            resultPath: null,
            updatedAt: new Date().toISOString(),
            error: null,
          },
          totals,
        );
        logger.info(`CHATGPT_CHAT_URL_SAVED=${chatUrl}`);
        logger.info("CHATGPT_RESPONSE_PENDING");
        console.log(`Chat URL: ${chatUrl}`);

        const outcome = await waitParseAndPersist({
          page,
          t247Id,
          tenderFolder,
          dateFolder,
          dateIso,
          resultPath,
          responsePath,
          chatUrl,
          config,
          logger,
          allowCorrectionPrompt: true,
          totals,
          baseline,
          submissionConfirmed: true,
          uploadedEvidenceFiles: evidenceFiles,
        });
        return { ...outcome, submittedAt };
      } finally {
        cleanupTenderTempUpload(prepared.tempDir, logger);
        // Always remove any accidental tender-local .gpt-upload leftovers
        const localGptUpload = path.join(tenderFolder, ".gpt-upload");
        if (fs.existsSync(localGptUpload)) {
          try {
            fs.rmSync(localGptUpload, { recursive: true, force: true });
            logger.info("CHATGPT_TEMP_UPLOAD_CLEANED");
          } catch {
            // non-fatal
          }
        }
      }
    } finally {
      attachmentBundle.cleanup();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AutomationError ? error.code : "";
    const stack = error instanceof Error ? error.stack : undefined;

    // Rate limit is never a hard tender failure when a /c/ URL exists
    if (
      code === "CHATGPT_RATE_LIMITED" ||
      /temporarily limited requests|Too many requests|RATE_LIMIT/i.test(
        `${code} ${message}`,
      )
    ) {
      const prior = loadChatGptTenderState(tenderFolder);
      const chatUrl =
        (prior?.chatUrl && isConversationUrl(prior.chatUrl)
          ? prior.chatUrl
          : null) ||
        (isConversationUrl(page.url()) ? page.url() : null);
      const retryCount = (prior?.retryCount || 0) + 1;
      saveChatGptTenderState(tenderFolder, {
        ...(prior || {
          t247Id,
          chatUrl,
          status: "rate_limited",
          updatedAt: new Date().toISOString(),
        }),
        t247Id,
        chatUrl,
        status: "rate_limited",
        updatedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
        retryCount,
        retryAfter: new Date(
          Date.now() + config.chatgptRateLimitInitialBackoffMs,
        ).toISOString(),
        error: "ChatGPT temporarily limited requests",
      });
      logger.warn(
        `CHATGPT_RATE_LIMIT_DETECTED tender=T247-${t247Id} chatUrl=${chatUrl || "none"}`,
      );
      const submittedAt = prior?.promptSubmittedAt
        ? Date.parse(prior.promptSubmittedAt)
        : undefined;
      return {
        t247Id,
        status: "rate_limited",
        resultPath: fs.existsSync(resultPath) ? resultPath : null,
        responsePath: fs.existsSync(responsePath) ? responsePath : null,
        qualification: null,
        chatUrl,
        error: "ChatGPT temporarily limited requests",
        retryAfterMs: config.chatgptRateLimitInitialBackoffMs,
        submittedAt:
          submittedAt && !Number.isNaN(submittedAt) ? submittedAt : undefined,
      };
    }

    // Missing user-message locator with a valid /c/ URL → pending, not failed
    if (
      /no user message|USER_MESSAGE_NOT_VISIBLE|RESPONSE_WAIT_WITHOUT_SUBMISSION/i.test(
        `${code} ${message}`,
      )
    ) {
      const prior = loadChatGptTenderState(tenderFolder);
      const chatUrl =
        (prior?.chatUrl && isConversationUrl(prior.chatUrl)
          ? prior.chatUrl
          : null) ||
        (isConversationUrl(page.url()) ? page.url() : null);
      if (chatUrl) {
        saveChatGptTenderState(tenderFolder, {
          ...(prior || {
            t247Id,
            chatUrl,
            status: "response_pending",
            updatedAt: new Date().toISOString(),
          }),
          t247Id,
          chatUrl,
          status: "response_pending",
          updatedAt: new Date().toISOString(),
          lastObservedAt: new Date().toISOString(),
          error: "User message not yet visible — will resume",
        });
        logger.warn(
          `CHATGPT_RESPONSE_PENDING_NO_USER_MESSAGE=T247-${t247Id} — not marking failed`,
        );
        return {
          t247Id,
          status: "response_pending",
          resultPath: null,
          responsePath: fs.existsSync(responsePath) ? responsePath : null,
          qualification: null,
          chatUrl,
          error: null,
        };
      }
    }

    // Before reporting failure: rate-limit modal must not become a hard fail
    if (await handleRateLimitModal(page, logger)) {
      const prior = loadChatGptTenderState(tenderFolder);
      const chatUrl =
        (prior?.chatUrl && isConversationUrl(prior.chatUrl)
          ? prior.chatUrl
          : null) ||
        (isConversationUrl(page.url()) ? page.url() : null);
      const retryCount = (prior?.retryCount || 0) + 1;
      const status = chatUrl
        ? ("rate_limited" as const)
        : ("response_pending" as const);
      saveChatGptTenderState(tenderFolder, {
        ...(prior || {
          t247Id,
          chatUrl,
          status,
          updatedAt: new Date().toISOString(),
        }),
        t247Id,
        chatUrl,
        status,
        updatedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
        retryCount,
        retryAfter: new Date(
          Date.now() + config.chatgptRateLimitInitialBackoffMs,
        ).toISOString(),
        error: "ChatGPT temporarily limited requests",
      });
      logger.warn(
        `CHATGPT_RATE_LIMIT_DETECTED tender=T247-${t247Id} chatUrl=${chatUrl || "none"} — not marking failed`,
      );
      return {
        t247Id,
        status: "rate_limited",
        resultPath: fs.existsSync(resultPath) ? resultPath : null,
        responsePath: fs.existsSync(responsePath) ? responsePath : null,
        qualification: null,
        chatUrl,
        error: "ChatGPT temporarily limited requests",
        retryAfterMs: config.chatgptRateLimitInitialBackoffMs,
        submittedAt: prior?.promptSubmittedAt
          ? Date.parse(prior.promptSubmittedAt)
          : undefined,
      };
    }

    logger.error(`CHATGPT_QUALIFICATION_FAILED=T247-${t247Id}: ${message}`);
    if (stack) {
      logger.error(stack);
    }
    if (
      /upload|filechooser|attachment|files_assigned|plus_button|add_files|project_home|ATTACHMENT_VALIDATION|UPLOAD_LIMIT/i.test(
        `${code} ${message}`,
      )
    ) {
      logger.error(`CHATGPT_UPLOAD_FAILED=${message}`);
      await saveUploadFailureDiagnostics({
        page,
        screenshotRoot: config.screenshotRoot,
        t247Id,
        logger,
      });
    } else if (/PROJECT_HOME/i.test(`${code} ${message}`)) {
      await logProjectHomeDiagnostics(page, config.chatgptProjectName, logger);
      await saveUploadFailureDiagnostics({
        page,
        screenshotRoot: config.screenshotRoot,
        t247Id,
        logger,
      });
    } else if (
      /parse|JSON|control character|SyntaxError/i.test(`${code} ${message}`)
    ) {
      logger.warn(`CHATGPT_RESPONSE_PARSE_FAILED=${message}`);
    }

    const chatUrlRaw =
      loadChatGptTenderState(tenderFolder)?.chatUrl ?? page.url() ?? null;
    const chatUrl = chatUrlRaw && isConversationUrl(chatUrlRaw) ? chatUrlRaw : null;
    const errorCode =
      error instanceof AutomationError ? error.code : "CHATGPT_QUALIFICATION_FAILED";
    const failureStage = txn.stage || "FAILED";
    const retryable = attempt < maxAttempts;
    Object.assign(txn, advanceCandidateStage(txn, retryable ? "RETRY_PENDING" : "FAILED_FINAL"));
    txn.failureReason = message;
    txn.failureStage = failureStage as typeof txn.failureStage;

    await saveCandidateFailureAudit({
      dateFolder,
      tenderId: t247Id,
      attempt,
      stage: failureStage,
      reason: errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message,
      conversationUrl: chatUrl,
      promptSubmitted: txn.submitted || Boolean(chatUrl),
      filesLocked: txn.filesLocked,
      responseDetected: false,
      retryable,
      page,
      logger,
      workerEvents: [
        {
          stage: failureStage,
          promptEntryCount: txn.promptEntryCount,
          uploadAttemptCount: txn.uploadAttemptCount,
          sendAttemptCount: txn.sendAttemptCount,
        },
      ],
    });

    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl,
      status: "failed",
      updatedAt: new Date().toISOString(),
      retryCount: attempt,
      error: errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message,
    });
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "failed",
        chatUrl,
        resultPath: null,
        updatedAt: new Date().toISOString(),
        error:
          errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message,
      },
      totals,
    );

    console.log(`CHATGPT_CANDIDATE_FAILED=true`);
    console.log(`CHATGPT_CANDIDATE_FAILED_TENDER=${t247Id}`);
    console.log(`CHATGPT_FAILURE_STAGE=${failureStage}`);
    console.log(
      `CHATGPT_FAILURE_REASON=${(errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message).slice(0, 300)}`,
    );
    logger.info(`CHATGPT_CANDIDATE_FAILED=true tender=${t247Id} stage=${failureStage}`);

    return {
      t247Id,
      status: "failed",
      resultPath: fs.existsSync(resultPath) ? resultPath : null,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification: null,
      chatUrl,
      error:
        errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message,
      attempt,
      retryable,
      failureStage,
    };
  }
}

/**
 * Local-only recovery from qualification-response.txt (no browser).
 */
export function tryRecoverFromExistingRawResponse(options: {
  t247Id: string;
  tenderFolder: string;
  dateFolder: string;
  dateIso: string;
  resultPath: string;
  responsePath: string;
  logger: Logger;
  totals?: {
    expectedTender247: number;
    readyForChatGpt: number;
    selected: number;
  };
}): QualifyTenderOutcome | null {
  const {
    t247Id,
    tenderFolder,
    dateFolder,
    dateIso,
    resultPath,
    responsePath,
    logger,
    totals,
  } = options;

  if (!fs.existsSync(responsePath) || fs.statSync(responsePath).size <= 0) {
    return null;
  }

  const existingState = loadChatGptTenderState(tenderFolder);
  if (!existingState?.submissionConfirmed || !isConversationUrl(existingState.chatUrl || "")) {
    logger.warn(
      "CHATGPT_EXISTING_RAW_RESPONSE_SKIPPED — submission was never confirmed",
    );
    return null;
  }

  logger.info("CHATGPT_EXISTING_RAW_RESPONSE_PARSE_ATTEMPT");
  const responseText = fs.readFileSync(responsePath, "utf8");
  const parsed = parseAndValidateQualificationResponse(responseText, t247Id);
  if (!parsed.ok) {
    logger.warn(
      `CHATGPT_EXISTING_RAW_RESPONSE_PARSE_FAILED=${parsed.error}`,
    );
    return null;
  }

  // Local fallback JSON must never complete a tender
  if (parsed.fallback) {
    logger.warn(
      "CHATGPT_EXISTING_RAW_RESPONSE_FALLBACK_REJECTED — cannot complete from local fallback",
    );
    return null;
  }

  const withEvidence = withUploadedEvidenceFiles(
    parsed.result,
    existingState.uploadedEvidenceFiles || [],
  );

  if (
    claimsMandatoryUploadsUnavailable(
      withEvidence,
      existingState.uploadedEvidenceFiles || [],
    )
  ) {
    logger.warn(
      "CHATGPT_EXISTING_RAW_RESPONSE_FALSE_MISSING_DOCS — not marking completed",
    );
    return null;
  }

  logger.info(
    `CHATGPT_EXISTING_RAW_RESPONSE_PARSED status=${withEvidence.status}`,
  );
  fs.writeFileSync(
    resultPath,
    JSON.stringify(withEvidence, null, 2),
    "utf8",
  );
  if (!isValidSavedQualificationResult(resultPath)) {
    logger.warn(
      "CHATGPT_EXISTING_RAW_RESPONSE_RESULT_INVALID — not marking completed",
    );
    return null;
  }
  logger.info("CHATGPT_RESULT_VALIDATED");
  logger.info("CHATGPT_RESULT_SAVED");
  logger.info("CHATGPT_QUALIFICATION_COMPLETE");
  logger.info(`CHATGPT_RESULT_STATUS=${withEvidence.status}`);
  logger.info(
    `CHATGPT_RESULT_DECISION_LABEL=${withEvidence.decisionLabel}`,
  );
  logger.info(
    `CHATGPT_QUALIFICATION_SAVED=T247-${t247Id} status=${withEvidence.status}`,
  );

  const chatUrl = existingState.chatUrl;
  saveChatGptTenderState(tenderFolder, {
    ...existingState,
    t247Id,
    chatUrl,
    status: "completed",
    submissionConfirmed: true,
    phase: "COMPLETED",
    updatedAt: new Date().toISOString(),
    latestAssistantText: responseText,
    uiState: "completed_from_raw",
    error: null,
  });
  upsertQualificationManifestEntry(
    dateFolder,
    dateIso,
    {
      t247Id,
      status: "completed",
      qualificationStatus: withEvidence.status,
      chatUrl,
      resultPath,
      responsePath,
      updatedAt: new Date().toISOString(),
      error: null,
    },
    totals,
  );

  return {
    t247Id,
    status: "completed",
    resultPath,
    responsePath,
    qualification: withEvidence,
    chatUrl,
    error: null,
  };
}

async function waitParseAndPersist(options: {
  page: Page;
  t247Id: string;
  tenderFolder: string;
  dateFolder: string;
  dateIso: string;
  resultPath: string;
  responsePath: string;
  chatUrl: string;
  config: AppConfig;
  logger: Logger;
  allowCorrectionPrompt: boolean;
  totals?: {
    expectedTender247: number;
    readyForChatGpt: number;
    selected: number;
  };
  baseline?: MessageBaseline | null;
  submissionConfirmed?: boolean;
  uploadedEvidenceFiles?: string[];
}): Promise<QualifyTenderOutcome> {
  const {
    page,
    t247Id,
    tenderFolder,
    dateFolder,
    dateIso,
    resultPath,
    responsePath,
    chatUrl,
    config,
    logger,
    allowCorrectionPrompt,
    totals,
    baseline,
  } = options;

  const submissionConfirmed = options.submissionConfirmed === true;
  const uploadedEvidenceFiles = options.uploadedEvidenceFiles || [];

  if (!submissionConfirmed) {
    throw new AutomationError(
      "CHATGPT_RESULT_BEFORE_CONFIRMED_SUBMISSION",
      `Cannot wait/save result for T247-${t247Id} before confirmed Send + user message + /c/ URL`,
    );
  }
  if (!isConversationUrl(chatUrl) && !isConversationUrl(page.url())) {
    throw new AutomationError(
      "CHATGPT_RESULT_BEFORE_CONFIRMED_SUBMISSION",
      `Cannot save result without a /c/ conversation URL for T247-${t247Id}`,
    );
  }

  const existing = loadChatGptTenderState(tenderFolder);
  const assistantCountBefore =
    baseline?.assistantCountBefore ?? existing?.assistantCountBefore;
  const userCountBefore =
    baseline?.userCountBefore ?? existing?.userCountBefore;

  const heartbeat = (info: {
    elapsedSeconds: number;
    assistantCountCurrent: number;
    assistantCountBefore: number;
    processingState: string;
    lastResponseActivityAtMs: number;
  }) => {
    saveChatGptTenderState(tenderFolder, {
      ...(loadChatGptTenderState(tenderFolder) || {
        t247Id,
        chatUrl,
        status: "response_pending",
        updatedAt: new Date().toISOString(),
      }),
      t247Id,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      lastObservedAt: new Date().toISOString(),
      processingState: info.processingState,
      elapsedSeconds: info.elapsedSeconds,
      assistantCountBefore: info.assistantCountBefore,
      userCountBefore,
      updatedAt: new Date().toISOString(),
    });
  };

  const saveRawResponse = (text: string): void => {
    fs.writeFileSync(responsePath, text, "utf8");
    const stagedRaw = path.join(tenderFolder, "04-raw-chatgpt-response.txt");
    fs.writeFileSync(stagedRaw, text, "utf8");
    logger.info("CHATGPT_RAW_RESPONSE_SAVED=true");
    console.log("CHATGPT_RAW_RESPONSE_SAVED=true");
    logger.info(`CHATGPT_RAW_RESPONSE_PATH=${stagedRaw}`);
  };

  let waitResult = await waitForAssistantResponse({
    page,
    timeoutMs: config.chatgptResponseTimeoutMs,
    logger,
    expectedT247Id: t247Id,
    assistantCountBefore,
    userCountBefore,
    onProgress: heartbeat,
  });

  if (waitResult.status === "stalled") {
    logger.warn("CHATGPT_FAILURE_STAGE=WAITING_RESPONSE");
    console.log("CHATGPT_FAILURE_STAGE=WAITING_RESPONSE");
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "failed",
      submissionConfirmed: true,
      phase: "RESPONSE_STALLED",
      lastObservedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestAssistantText: waitResult.text || null,
      uiState: waitResult.uiState,
      processingState: "stalled",
      assistantCountBefore,
      userCountBefore,
      uploadedEvidenceFiles,
      error: "CHATGPT_RESPONSE_STALLED",
    });
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "failed",
        chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
        resultPath: null,
        updatedAt: new Date().toISOString(),
        error: "CHATGPT_RESPONSE_STALLED",
      },
      totals,
    );
    // Bounded retryable — do not refresh; next tender continues.
    return {
      t247Id,
      status: "failed",
      resultPath: null,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: "CHATGPT_RESPONSE_STALLED",
      attempt: 1,
      retryable: true,
      failureStage: "WAITING_RESPONSE",
    };
  }

  if (waitResult.status === "pending_timeout") {
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      phase: "RESPONSE_PENDING",
      promptSubmittedAt:
        loadChatGptTenderState(tenderFolder)?.promptSubmittedAt ||
        new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestAssistantText: waitResult.text || null,
      uiState: waitResult.uiState,
      processingState: "timeout_pending",
      assistantCountBefore,
      userCountBefore,
      uploadedEvidenceFiles,
      error: null,
    });
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "response_pending",
        chatUrl,
        resultPath: null,
        updatedAt: new Date().toISOString(),
        error: null,
      },
      totals,
    );
    // Do not create qualification-result.json on timeout
    logger.info(`CHATGPT_CHAT_CAN_BE_RESUMED=${chatUrl}`);
    console.log(`Chat can be resumed: ${chatUrl}`);
    return {
      t247Id,
      status: "response_pending",
      resultPath: null,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification: null,
      chatUrl,
      error: null,
    };
  }

  let responseText = waitResult.text;
  saveRawResponse(responseText);
  logger.info("CHATGPT_RESPONSE_COMPLETE=true");
  console.log("CHATGPT_RESPONSE_COMPLETE=true");
  logger.info(`CHATGPT_RESPONSE_LENGTH=${responseText.length}`);
  console.log(`CHATGPT_RESPONSE_LENGTH=${responseText.length}`);

  let validated = parseAndValidateQualificationResponse(responseText, t247Id);

  // Reject local fallback — never complete from synthesized VERIFY/etc.
  if (validated.ok && validated.fallback) {
    logger.warn(
      "CHATGPT_RESULT_FALLBACK_REJECTED — local fallback cannot mark completed",
    );
    validated = {
      ok: false,
      error: "Local fallback result rejected; need a real ChatGPT JSON response",
      status: validated.result.status,
    };
  }

  if (
    allowCorrectionPrompt &&
    !validated.ok &&
    validated.status !== undefined
  ) {
    logger.warn(
      `Invalid status from ChatGPT (${validated.status}); requesting one correction`,
    );
    const correction = buildStatusCorrectionPrompt(
      validated.status || String(validated.error),
      "TENDER247",
      t247Id,
    );
    await typeComposerPrompt(page, correction, logger);
    const correctionSend = await sendComposerMessage(page, logger, {
      requireNewConversation: false,
      expectedT247Id: t247Id,
      userMessagePattern:
        /Your previous status value|invalid|ONE JSON object only/i,
    });

    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      promptSubmittedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "correction_submitted",
      assistantCountBefore: correctionSend.baseline.assistantCountBefore,
      userCountBefore: correctionSend.baseline.userCountBefore,
      uploadedEvidenceFiles,
      error: null,
    });

    waitResult = await waitForAssistantResponse({
      page,
      timeoutMs: config.chatgptResponseTimeoutMs,
      logger,
      expectedT247Id: t247Id,
      assistantCountBefore: correctionSend.baseline.assistantCountBefore,
      userCountBefore: correctionSend.baseline.userCountBefore,
      onProgress: heartbeat,
    });

    if (
      waitResult.status === "pending_timeout" ||
      waitResult.status === "stalled"
    ) {
      saveChatGptTenderState(tenderFolder, {
        t247Id,
        chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
        status:
          waitResult.status === "stalled" ? "failed" : "response_pending",
        submissionConfirmed: true,
        updatedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
        latestAssistantText: waitResult.text || null,
        uiState: waitResult.uiState,
        assistantCountBefore: correctionSend.baseline.assistantCountBefore,
        userCountBefore: correctionSend.baseline.userCountBefore,
        uploadedEvidenceFiles,
        error:
          waitResult.status === "stalled"
            ? "CHATGPT_RESPONSE_STALLED"
            : null,
      });
      logger.info(`CHATGPT_CHAT_CAN_BE_RESUMED=${page.url() || chatUrl}`);
      return {
        t247Id,
        status:
          waitResult.status === "stalled" ? "failed" : "response_pending",
        resultPath: null,
        responsePath: fs.existsSync(responsePath) ? responsePath : null,
        qualification: null,
        chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
        error:
          waitResult.status === "stalled"
            ? "CHATGPT_RESPONSE_STALLED"
            : null,
        retryable: waitResult.status === "stalled",
        failureStage:
          waitResult.status === "stalled" ? "WAITING_RESPONSE" : null,
      };
    }

    responseText = waitResult.text;
    saveRawResponse(responseText);
    validated = parseAndValidateQualificationResponse(responseText, t247Id);
    if (validated.ok && validated.fallback) {
      validated = {
        ok: false,
        error: "Local fallback result rejected after status correction",
        status: validated.result.status,
      };
    }
  }

  // One strict-JSON correction when parse failed entirely
  if (allowCorrectionPrompt && !validated.ok) {
    logger.warn(
      `CHATGPT_RESPONSE_PARSE_FAILED=${validated.error}; requesting strict JSON correction`,
    );
    const correction = [
      "Your previous reply was not valid JSON.",
      `For tender T247-${t247Id}, reply again with ONE JSON object only.`,
      `status MUST be exactly one of: GO, CONDITIONAL_GO, PARTNER_BID, VERIFY, NO_GO.`,
      "No markdown. No commentary. Escape newlines inside strings.",
    ].join("\n");
    await typeComposerPrompt(page, correction, logger);
    const correctionSend = await sendComposerMessage(page, logger, {
      requireNewConversation: false,
      expectedT247Id: t247Id,
      userMessagePattern:
        /not valid JSON|ONE JSON object only|Escape newlines/i,
    });

    waitResult = await waitForAssistantResponse({
      page,
      timeoutMs: config.chatgptResponseTimeoutMs,
      logger,
      expectedT247Id: t247Id,
      assistantCountBefore: correctionSend.baseline.assistantCountBefore,
      userCountBefore: correctionSend.baseline.userCountBefore,
      onProgress: heartbeat,
    });

    if (waitResult.status === "complete" && waitResult.text) {
      responseText = waitResult.text;
      saveRawResponse(responseText);
      validated = parseAndValidateQualificationResponse(responseText, t247Id);
      if (validated.ok && validated.fallback) {
        validated = {
          ok: false,
          error: "Local fallback result rejected after JSON correction",
          status: validated.result.status,
        };
      }
    }
  }

  // Retry once when ChatGPT falsely claims uploaded files were unavailable
  if (
    allowCorrectionPrompt &&
    validated.ok &&
    !validated.fallback &&
    claimsMandatoryUploadsUnavailable(
      validated.result,
      uploadedEvidenceFiles,
    )
  ) {
    logger.warn(
      "CHATGPT_FALSE_MISSING_UPLOADS — assistant ignored attached files; requesting one review",
    );
    saveRawResponse(responseText);
    const reviewPrompt = [
      `Your previous answer for tender T247-${t247Id} incorrectly claimed tender documents were unavailable.`,
      "The current chat already has these attachments:",
      ...uploadedEvidenceFiles.map((name) => `- ${name}`),
      "Review the attached files in this conversation and reply again with ONE JSON object only.",
      "Do not claim these uploaded files are missing.",
    ].join("\n");
    await typeComposerPrompt(page, reviewPrompt, logger);
    const reviewSend = await sendComposerMessage(page, logger, {
      requireNewConversation: false,
      expectedT247Id: t247Id,
      userMessagePattern:
        /incorrectly claimed|Review the attached files|ONE JSON object only/i,
    });
    waitResult = await waitForAssistantResponse({
      page,
      timeoutMs: config.chatgptResponseTimeoutMs,
      logger,
      expectedT247Id: t247Id,
      assistantCountBefore: reviewSend.baseline.assistantCountBefore,
      userCountBefore: reviewSend.baseline.userCountBefore,
      onProgress: heartbeat,
    });
    if (waitResult.status === "complete" && waitResult.text) {
      responseText = waitResult.text;
      saveRawResponse(responseText);
      validated = parseAndValidateQualificationResponse(responseText, t247Id);
      if (validated.ok && validated.fallback) {
        validated = {
          ok: false,
          error: "Local fallback rejected after upload-review retry",
        };
      } else if (
        validated.ok &&
        claimsMandatoryUploadsUnavailable(
          validated.result,
          uploadedEvidenceFiles,
        )
      ) {
        logger.warn(
          "CHATGPT_FALSE_MISSING_UPLOADS_PERSISTED — not marking completed",
        );
        saveChatGptTenderState(tenderFolder, {
          t247Id,
          chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
          status: "response_pending",
          submissionConfirmed: true,
          phase: "RAW_RESPONSE_SAVED",
          updatedAt: new Date().toISOString(),
          latestAssistantText: responseText,
          uploadedEvidenceFiles,
          error: "Assistant still claims uploaded files unavailable",
        });
        return {
          t247Id,
          status: "response_pending",
          resultPath: null,
          responsePath,
          qualification: null,
          chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
          error: "Assistant still claims uploaded files unavailable",
        };
      }
    } else {
      validated = {
        ok: false,
        error: "Upload-review retry did not produce a complete response",
      };
    }
  }

  if (!validated.ok) {
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: page.url() || chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "parse_failed",
      uploadedEvidenceFiles,
      error: validated.error,
    });
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: "response_pending",
        chatUrl: page.url() || chatUrl,
        resultPath: null,
        responsePath,
        updatedAt: new Date().toISOString(),
        error: validated.error,
      },
      totals,
    );
    logger.warn(
      `CHATGPT_RESPONSE_PARSE_PENDING=${validated.error} chat=${page.url() || chatUrl}`,
    );
    return {
      t247Id,
      status: "response_pending",
      resultPath: null,
      responsePath,
      qualification: null,
      chatUrl: page.url() || chatUrl,
      error: validated.error,
    };
  }

  // t247Id in response must match current tender
  const resultId = String(validated.result.t247Id).replace(/^T247-/i, "");
  if (resultId !== t247Id) {
    logger.error(
      `CHATGPT_RESPONSE_TENDER_ID_MISMATCH expected=${t247Id} got=${resultId}`,
    );
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uploadedEvidenceFiles,
      error: `t247Id mismatch: expected ${t247Id}, got ${resultId}`,
    });
    return {
      t247Id,
      status: "response_pending",
      resultPath: null,
      responsePath,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: `t247Id mismatch: expected ${t247Id}, got ${resultId}`,
    };
  }

  const finalResult = withUploadedEvidenceFiles(
    validated.result,
    uploadedEvidenceFiles,
  );

  if (!submissionConfirmed) {
    throw new AutomationError(
      "CHATGPT_RESULT_BEFORE_CONFIRMED_SUBMISSION",
      `Refusing to save qualification-result.json without confirmed submission for T247-${t247Id}`,
    );
  }

  fs.writeFileSync(
    resultPath,
    JSON.stringify(finalResult, null, 2),
    "utf8",
  );

  if (!isValidSavedQualificationResult(resultPath)) {
    logger.warn(
      "CHATGPT_RESULT_VALIDATION_FAILED after write — keeping response_pending",
    );
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "result_validation_failed",
      uploadedEvidenceFiles,
      error: "qualification-result.json failed validation after write",
    });
    return {
      t247Id,
      status: "response_pending",
      resultPath: null,
      responsePath,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: "qualification-result.json failed validation after write",
    };
  }

  logger.info("CHATGPT_RESULT_VALIDATED");
  logger.info(`CHATGPT_RESULT_STATUS=${finalResult.status}`);
  logger.info(
    `CHATGPT_RESULT_DECISION_LABEL=${finalResult.decisionLabel}`,
  );
  if (validated.fallback) {
    logger.info("CHATGPT_RESULT_FALLBACK=true");
  }
  if (finalResult.requiresDetailedTenderReview) {
    logger.info("CHATGPT_REQUIRES_DETAILED_TENDER_REVIEW=true");
  }
  logger.info("CHATGPT_RESULT_SAVED");

  const finalChatUrl = isConversationUrl(page.url())
    ? page.url()
    : chatUrl;

  const supabasePersist = await persistValidatedQualificationToSupabase({
    sourcePortal: "TENDER247",
    sourceTenderId: t247Id,
    qualification: finalResult,
    rawResponse: responseText,
    chatUrl: finalChatUrl,
    logger,
  });

  if (!supabasePersist.ok) {
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: finalChatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      phase: "DB_SYNC_FAILED",
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "response_saved_db_pending",
      uploadedEvidenceFiles,
      error: supabasePersist.error,
    });
    logger.warn(
      `CHATGPT_DB_SYNC_FAILED — raw response retained for retry: ${supabasePersist.error}`,
    );
    return {
      t247Id,
      status: "response_pending",
      resultPath,
      responsePath,
      qualification: finalResult,
      chatUrl: finalChatUrl,
      error: supabasePersist.error,
    };
  }

  logger.info("CHATGPT_QUALIFICATION_COMPLETE");
  logger.info(
    `CHATGPT_QUALIFICATION_SAVED=T247-${t247Id} status=${finalResult.status}`,
  );
  console.log(`CHATGPT_RESULT=${finalResult.status}`);
  logger.info(`CHATGPT_RESULT=${finalResult.status}`);

  saveChatGptTenderState(tenderFolder, {
    t247Id,
    chatUrl: finalChatUrl,
    status: "completed",
    submissionConfirmed: true,
    phase: "COMPLETED",
    updatedAt: new Date().toISOString(),
    latestAssistantText: responseText,
    uiState: "completed",
    uploadedEvidenceFiles,
    error: null,
  });
  upsertQualificationManifestEntry(
    dateFolder,
    dateIso,
    {
      t247Id,
      status: "completed",
      qualificationStatus: finalResult.status,
      chatUrl: finalChatUrl,
      resultPath,
      responsePath,
      updatedAt: new Date().toISOString(),
      error: null,
    },
    totals,
  );

  console.log("CHATGPT_CANDIDATE_DONE=true");
  logger.info("CHATGPT_CANDIDATE_DONE=true");

  return {
    t247Id,
    status: "completed",
    resultPath,
    responsePath,
    qualification: finalResult,
    chatUrl: finalChatUrl,
    error: null,
  };
}
