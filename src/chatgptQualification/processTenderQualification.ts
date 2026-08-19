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
  evaluateExistingQualificationReuse,
  logSkipExistingDetails,
} from "./existingQualificationReuse.js";
import {
  computeQualificationInputFingerprint,
  saveQualificationInputFingerprint,
} from "./qualificationInputFingerprint.js";
import {
  cleanupTenderTempUpload,
  handleRateLimitModal,
  isConversationUrl,
  preparePartialTenderUploadFiles,
  saveUploadFailureDiagnostics,
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
  buildEvidenceAwareQualificationPrompt,
  applyFalseMissingDocumentClaim,
  isValidSavedQualificationResult,
  parseAndValidateQualificationResponse,
  withUploadedEvidenceFiles,
} from "./qualificationSchema.js";
import {
  ensureTender247QualificationEvidence,
} from "./ensureTender247QualificationEvidence.js";
import { inspectTenderArtifactState } from "../tender247Batch/tenderArtifactState.js";
import {
  resolvePartialQualificationFiles,
} from "./sourceDocumentResolver.js";
import { assertPrescreenAllowsChatgpt } from "../prescreen/chatgptGate.js";
import type { QualificationResult } from "./types.js";
import { persistValidatedQualificationToSupabase } from "../supabase/persistQualification.js";

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
  /** True when this skip is an actual valid existing qualification. */
  reusedExistingValid?: boolean;
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
  /** When true (--resume), may reuse valid unchanged qualifications. */
  resumeMode?: boolean;
  /**
   * Fired immediately after authoritative Send / SUBMITTED.
   * Used by dual workers to protect the page until terminal outcome.
   */
  onSubmitted?: () => void;
  /**
   * When true, page was just opened via openFreshTenderTab with a verified
   * clean composer — do NOT re-navigate / reload project home.
   */
  skipInitialProjectHome?: boolean;
  /** When set, may open Tender247 for one bounded document acquisition attempt. */
  browserContext?: import("playwright").BrowserContext;
  tender247ListPage?: import("playwright").Page;
}): Promise<QualifyTenderOutcome> {
  const { page, dateFolder, t247Id, config, logger } = options;
  const resumeMode = options.resumeMode === true;
  // Fresh runs always reprocess; resume may reuse matching valid results.
  const effectiveForceReprocess = !resumeMode || options.forceReprocess === true;
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

  const reuseDecision = evaluateExistingQualificationReuse({
    dateFolder,
    sourceTenderId: t247Id,
    resumeMode,
    logger,
  });

  if (resumeMode && reuseDecision.reuse) {
    logSkipExistingDetails({ sourceTenderId: t247Id, decision: reuseDecision });
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
      reusedExistingValid: true,
    };
  }

  if (reuseDecision.found && !resumeMode) {
    logger.info(
      `CHATGPT_EXISTING_QUALIFICATION_FOUND=true CHATGPT_EXISTING_QUALIFICATION_REUSE=false T247-${t247Id}`,
    );
  }

  // ---- Local raw-response recovery (no ChatGPT / no re-upload) ----
  // Resume only — fresh runs must submit a new GPT request.
  if (resumeMode && !options.forceReprocess) {
    const localRecovery = await tryRecoverFromExistingRawResponse({
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
  } else if (effectiveForceReprocess) {
    logger.info(`QUALIFICATION_REPROCESSED=true T247-${t247Id}`);
    console.log(`QUALIFICATION_REPROCESSED=true T247-${t247Id}`);
  }

  logger.info(`CHATGPT_PHASE1_ADMITTED=T247-${t247Id}`);
  logger.info("CHATGPT_QUALIFICATION_PRESCREEN=ARTIFACTS_ONLY");
  const prescreenGate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderId: t247Id,
    logger,
    allowMissingPrescreenRow: true,
    phase1Admitted: true,
  });
  if (!prescreenGate.allowed) {
    throw new AutomationError(
      "CHATGPT_PHASE1_PRESCREEN_UNEXPECTED_BLOCK",
      `Phase-1 admitted tender T247-${t247Id} was blocked by qualification prescreen`,
    );
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
    // Fresh runs (--resume absent) must submit a NEW GPT request even if a
    // prior /c/ URL exists. Pending URL recovery is resume-only.
    if (
      existingState &&
      resumeMode &&
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

    if (resumeMode && isResumablePendingState(existingState)) {
      logger.info(`CHATGPT_PENDING_CHAT_RESUME=T247-${t247Id}`);
      // Resume owns a single goto to THIS tender's /c/ URL — never reuse
      // another tender's conversation. Reset lifecycle so the recovery goto
      // is allowed (fresh-tab may have already landed on project home).
      const {
        clearTenderPageLifecycle,
        initTenderPageLifecycle,
        chatGptPageGoto,
        setTenderPageLifecycleState,
        attachChatGptNavigationObservers,
      } = await import("./tenderPageNav.js");
      clearTenderPageLifecycle(page);
      initTenderPageLifecycle(page, 0, t247Id);
      attachChatGptNavigationObservers(page, logger);
      setTenderPageLifecycleState(page, "PROJECT_LOADING", logger);
      await chatGptPageGoto(page, existingState.chatUrl!, {
        reason: "resume_pending_conversation",
        logger,
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      setTenderPageLifecycleState(page, "WAITING_RESPONSE", logger);
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

      const { inspectExistingSubmissionAndResponse } = await import(
        "./inspectExistingSubmission.js"
      );
      const resumeInspect = await inspectExistingSubmissionAndResponse({
        page,
        expectedT247Id: t247Id,
        logger,
      });
      if (
        resumeInspect.assistantMessagePresent ||
        resumeInspect.validQualificationJsonPresent
      ) {
        logger.info("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
        console.log("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
      }

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
        allowCorrectionPrompt: false,
        totals,
        baseline: {
          assistantCountBefore: existingState.assistantCountBefore ?? 0,
          userCountBefore: existingState.userCountBefore ?? 0,
          capturedAt:
            existingState.promptSubmittedAt || existingState.updatedAt,
        },
        submissionConfirmed:
          existingState.submissionConfirmed === true ||
          Boolean(existingState.promptSubmittedAt) ||
          resumeInspect.promptSubmitted,
        uploadedEvidenceFiles: existingState.uploadedEvidenceFiles || [],
        existingResponseText: resumeInspect.assistantText || undefined,
        existingValidJson: resumeInspect.validQualificationJsonPresent,
      });
    }

    const evidence = await ensureTender247QualificationEvidence({
      dateFolder,
      t247Id,
      logger,
      attemptDocumentDownload: false,
      browserContext: options.browserContext,
      listPage: options.tender247ListPage,
      config: options.config,
      fullLogger: logger,
    });

    const crawlArtifacts = inspectTenderArtifactState(tenderFolder, t247Id);
    if (!crawlArtifacts.coreReady) {
      const missingFiles = crawlArtifacts.missing
        .filter((name) => name !== "aiSummary")
        .map((name) =>
          name === "documents" ? "Tender_All_Documents.zip" : "metadata.json",
        );
      logger.warn(
        `CHATGPT_TENDER_NOT_READY=T247-${t247Id} reason=ARTIFACTS_INCOMPLETE ${missingFiles.join(",")}`,
      );
      saveChatGptTenderState(tenderFolder, {
        t247Id,
        chatUrl: null,
        status: "not_ready",
        updatedAt: new Date().toISOString(),
        missingFiles,
        error: `PENDING_TIMEOUT artifacts incomplete: ${missingFiles.join(", ")}`,
        evidenceMode: evidence.evidenceMode,
        availableFiles: evidence.availableFiles,
        downloadAttempted: evidence.downloadAttempted,
        metadataRepairAttempted: evidence.metadataRepairAttempted,
      });
      upsertQualificationManifestEntry(
        dateFolder,
        dateIso,
        {
          t247Id,
          status: "not_ready",
          missingFiles,
          updatedAt: new Date().toISOString(),
          error: `PENDING_TIMEOUT artifacts incomplete: ${missingFiles.join(", ")}`,
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
        error: `PENDING_TIMEOUT artifacts incomplete: ${missingFiles.join(", ")}`,
        missingFiles,
      };
    }

    if (!evidence.gptReady) {
      const missingFiles = [
        evidence.notReadyReason ?? "MISSING_CORE_QUALIFICATION_ARTIFACTS",
      ];
      logger.warn(
        `CHATGPT_TENDER_NOT_READY=T247-${t247Id} reason=${missingFiles.join(",")}`,
      );
      saveChatGptTenderState(tenderFolder, {
        t247Id,
        chatUrl: null,
        status: "not_ready",
        updatedAt: new Date().toISOString(),
        missingFiles: evidence.missingFiles,
        error: missingFiles.join(", "),
        evidenceMode: evidence.evidenceMode,
        availableFiles: evidence.availableFiles,
        downloadAttempted: evidence.downloadAttempted,
        metadataRepairAttempted: evidence.metadataRepairAttempted,
      });
      upsertQualificationManifestEntry(
        dateFolder,
        dateIso,
        {
          t247Id,
          status: "not_ready",
          missingFiles,
          updatedAt: new Date().toISOString(),
          error: missingFiles.join(", "),
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
        error: missingFiles.join(", "),
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

    const attachmentBundle = await resolvePartialQualificationFiles(
      t247Id,
      tenderFolder,
      evidence,
    );

    assertTender247BundleComplete(
      attachmentBundle.files,
      t247Id,
      attachmentBundle.aiSummaryAvailable,
    );
    logAttachmentBundle("TENDER247", t247Id, attachmentBundle.files, logger);

    const readinessStatus =
      evidence.evidenceMode === "FULL" ? "ready_full" : "ready_partial";
    saveChatGptTenderState(tenderFolder, {
      t247Id,
      chatUrl: existingState?.chatUrl ?? null,
      status: existingState?.status ?? "attachments_confirmed",
      updatedAt: new Date().toISOString(),
      evidenceMode: evidence.evidenceMode,
      availableFiles: evidence.availableFiles,
      missingFiles: evidence.missingFiles,
      downloadAttempted: evidence.downloadAttempted,
      metadataRepairAttempted: evidence.metadataRepairAttempted,
      processingState: readinessStatus,
      aiSummaryAvailable: evidence.aiSummary.available,
    });
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id,
        status: readinessStatus,
        missingFiles: evidence.missingFiles,
        availableFiles: evidence.availableFiles,
        evidenceMode: evidence.evidenceMode,
        downloadAttempted: evidence.downloadAttempted,
        metadataRepairAttempted: evidence.metadataRepairAttempted,
        updatedAt: new Date().toISOString(),
        error: null,
      },
      totals,
    );

    try {
      if (options.skipInitialProjectHome === true) {
        // Fresh tab already navigated once and verified clean composer.
        // NEVER ensureProjectHome here — that was the reload storm.
        logger.info("CHATGPT_SKIP_INITIAL_PROJECT_HOME=true");
        console.log("CHATGPT_UPLOAD_START");
        logger.info("CHATGPT_UPLOAD_START");
        try {
          const { setTenderPageLifecycleState } = await import(
            "./tenderPageNav.js"
          );
          setTenderPageLifecycleState(page, "FILES_UPLOADING", logger);
        } catch {
          // ignore
        }
      } else {
        // Legacy path — still must not navigate if composer already ready.
        const { isAtOrPastComposerReady } = await import("./tenderPageNav.js");
        if (isAtOrPastComposerReady(page)) {
          logger.info("CHATGPT_SKIP_INITIAL_PROJECT_HOME=true");
          console.log("CHATGPT_UPLOAD_START");
          logger.info("CHATGPT_UPLOAD_START");
        } else {
          await ensureProjectHome({
            page,
            projectName: config.chatgptProjectName,
            projectMatch: config.chatgptProjectMatch,
            projectUrl: config.chatgptProjectUrl,
            config,
            logger,
          });
          assertProjectHomeOpen(page);
        }
      }

      logger.info(`CHATGPT_CHAT_TITLE_HINT=T247-${t247Id} Qualification`);

      const prepared = preparePartialTenderUploadFiles({
        t247Id,
        tenderFolder,
        metadataPath: attachmentBundle.metadataPath,
        aiSummaryPath: attachmentBundle.aiSummaryPath,
        documentZipPath: attachmentBundle.documentArchivePath,
        logger,
      });

      try {
        const prompt = buildEvidenceAwareQualificationPrompt(
          "TENDER247",
          t247Id,
          {
            metadataAvailable: evidence.metadata.available,
            documentsAvailable: evidence.documents.available,
            aiSummaryAvailable: evidence.aiSummary.available,
            evidenceMode: evidence.evidenceMode,
          },
        );
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
          const audit = confirmed.attachmentManifest;
          logger.info(
            `CHATGPT_ATTACHMENT_MANIFEST metadataPresent=${audit.metadataPresent} documentZipPresent=${audit.documentZipPresent} aiSummaryPresent=${audit.aiSummaryPresent}`,
          );
          console.log(
            `CHATGPT_ATTACHMENT_MANIFEST=${JSON.stringify({
              metadataPresent: audit.metadataPresent,
              documentZipPresent: audit.documentZipPresent,
              aiSummaryPresent: audit.aiSummaryPresent,
              uploadedLogicalFiles: audit.uploadedLogicalFiles,
            })}`,
          );
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
        options.onSubmitted?.();
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
          allowCorrectionPrompt: false,
          totals,
          baseline,
          submissionConfirmed: true,
          uploadedEvidenceFiles: evidenceFiles,
          existingResponseText: submitted.existingResponseText,
          existingValidJson: submitted.existingValidJson === true,
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
      try {
        const { tripGlobalChatGptRateLimit } = await import(
          "./globalChatGptRateLimit.js"
        );
        tripGlobalChatGptRateLimit({
          logger,
          backoffMs: config.chatgptRateLimitInitialBackoffMs,
          reason: `qualify_catch:${t247Id}`,
        });
      } catch {
        // ignore
      }
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

    let failInspect = {
      userMessagePresent: false,
      assistantMessagePresent: false,
      validJsonPresent: false,
      promptSubmitted: txn.submitted || Boolean(chatUrl),
    };
    try {
      const { inspectExistingSubmissionAndResponse } = await import(
        "./inspectExistingSubmission.js"
      );
      const insp = await inspectExistingSubmissionAndResponse({
        page,
        expectedT247Id: t247Id,
        logger,
      });
      failInspect = {
        userMessagePresent: insp.userMessagePresent,
        assistantMessagePresent: insp.assistantMessagePresent,
        validJsonPresent: insp.validQualificationJsonPresent,
        promptSubmitted:
          insp.promptSubmitted || txn.submitted || Boolean(chatUrl),
      };
    } catch {
      // non-fatal — audit still written
    }

    await saveCandidateFailureAudit({
      dateFolder,
      tenderId: t247Id,
      attempt,
      stage: failureStage,
      reason: errorCode === "CHATGPT_PROMPT_NOT_SUBMITTED" ? errorCode : message,
      conversationUrl: chatUrl,
      promptSubmitted: failInspect.promptSubmitted,
      filesLocked: txn.filesLocked,
      responseDetected: failInspect.assistantMessagePresent,
      userMessagePresent: failInspect.userMessagePresent,
      assistantMessagePresent: failInspect.assistantMessagePresent,
      validJsonPresent: failInspect.validJsonPresent,
      retryable,
      page,
      logger,
      workerEvents: [
        {
          stage: failureStage,
          promptEntryCount: txn.promptEntryCount,
          uploadAttemptCount: txn.uploadAttemptCount,
          sendAttemptCount: txn.sendAttemptCount,
          promptSubmitted: failInspect.promptSubmitted,
          userMessagePresent: failInspect.userMessagePresent,
          assistantMessagePresent: failInspect.assistantMessagePresent,
          validJsonPresent: failInspect.validJsonPresent,
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
export async function tryRecoverFromExistingRawResponse(options: {
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
}): Promise<QualifyTenderOutcome | null> {
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

  const uploadedEvidenceFiles = existingState.uploadedEvidenceFiles || [];
  const withEvidence = withUploadedEvidenceFiles(
    parsed.result,
    uploadedEvidenceFiles,
  );
  const falseMissing = applyFalseMissingDocumentClaim({
    result: withEvidence,
    uploadedEvidenceFiles,
    metadataUploaded: existingState.metadataUploaded,
    documentZipUploaded: existingState.documentArchiveUploaded,
  });
  if (falseMissing.falseClaim) {
    logger.warn("MODEL_FALSE_MISSING_DOCUMENT_CLAIM=true");
    console.log("MODEL_FALSE_MISSING_DOCUMENT_CLAIM=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_CORRECTION_PROMPT_FORBIDDEN=true");
    logger.info("CHATGPT_CORRECTION_PROMPT_FORBIDDEN=true");
    logger.info(
      `CHATGPT_ATTACHMENT_MANIFEST=${JSON.stringify(falseMissing.manifest)}`,
    );
  }

  logger.info(
    `CHATGPT_EXISTING_RAW_RESPONSE_PARSED status=${falseMissing.result.status}`,
  );
  fs.writeFileSync(
    resultPath,
    JSON.stringify(falseMissing.result, null, 2),
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
  logger.info(`CHATGPT_RESULT_STATUS=${falseMissing.result.status}`);
  logger.info(
    `CHATGPT_RESULT_DECISION_LABEL=${falseMissing.result.decisionLabel}`,
  );

  const chatUrl = existingState.chatUrl;
  const inputFingerprint = computeQualificationInputFingerprint({
    dateFolder,
    sourceTenderId: t247Id,
    sourcePortal: "TENDER247",
  });
  saveQualificationInputFingerprint(tenderFolder, inputFingerprint);

  let supabasePersist = { ok: false, error: "not_attempted" as string | null };
  const maxPersistAttempts = 3;
  for (let persistAttempt = 1; persistAttempt <= maxPersistAttempts; persistAttempt++) {
    supabasePersist = await persistValidatedQualificationToSupabase({
      sourcePortal: "TENDER247",
      sourceTenderId: t247Id,
      qualification: falseMissing.result,
      rawResponse: responseText,
      chatUrl,
      logger,
    });
    if (supabasePersist.ok) break;
    logger.warn(
      `CHATGPT_PERSIST_RETRY_PENDING=true attempt=${persistAttempt}/${maxPersistAttempts} error=${supabasePersist.error}`,
    );
  }
  if (!supabasePersist.ok) {
    logger.warn(
      `CHATGPT_DB_SYNC_FAILED — raw response retained for retry (no GPT re-prompt): ${supabasePersist.error}`,
    );
    saveChatGptTenderState(tenderFolder, {
      ...existingState,
      t247Id,
      chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      phase: "DB_SYNC_FAILED",
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "response_saved_db_pending",
      uploadedEvidenceFiles,
      qualificationInputHash: inputFingerprint.qualificationInputHash,
      error: supabasePersist.error,
    });
    return {
      t247Id,
      status: "response_pending",
      resultPath,
      responsePath,
      qualification: falseMissing.result,
      chatUrl,
      error: supabasePersist.error,
    };
  }

  logger.info("CHATGPT_QUALIFICATION_COMPLETE");
  logger.info(
    `CHATGPT_QUALIFICATION_SAVED=T247-${t247Id} status=${falseMissing.result.status}`,
  );
  console.log(`CHATGPT_RESULT=${falseMissing.result.status}`);
  console.log("CHATGPT_CANDIDATE_DONE=true");

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
    uploadedEvidenceFiles,
    qualificationInputHash: inputFingerprint.qualificationInputHash,
    error: null,
  });
  upsertQualificationManifestEntry(
    dateFolder,
    dateIso,
    {
      t247Id,
      status: "completed",
      qualificationStatus: falseMissing.result.status,
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
    qualification: falseMissing.result,
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
  /** When set, consume this assistant text instead of waiting / re-prompting. */
  existingResponseText?: string;
  existingValidJson?: boolean;
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
    totals,
    baseline,
  } = options;

  // Absolute rule: never send a second qualification / correction prompt.
  void options.allowCorrectionPrompt;

  const submissionConfirmed = options.submissionConfirmed === true;
  const uploadedEvidenceFiles = options.uploadedEvidenceFiles || [];
  const existingResponseText = (options.existingResponseText || "").trim();
  const existingValidJson = options.existingValidJson === true;

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

  let waitResult: Awaited<ReturnType<typeof waitForAssistantResponse>>;

  if (existingValidJson && existingResponseText) {
    logger.info("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
    console.log("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
    logger.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    logger.info("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
    console.log("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
    logger.info("CHATGPT_VALID_JSON_DETECTED=true");
    console.log("CHATGPT_VALID_JSON_DETECTED=true");
    waitResult = {
      status: "complete",
      text: existingResponseText,
      reason: "existing_valid_json",
    };
  } else if (existingResponseText.length > 0) {
    // Assistant already present (possibly partial) — wait on SAME message, never re-prompt.
    logger.info("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
    console.log("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
    logger.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    waitResult = await waitForAssistantResponse({
      page,
      timeoutMs: config.chatgptResponseTimeoutMs,
      logger,
      expectedT247Id: t247Id,
      assistantCountBefore,
      userCountBefore,
      onProgress: heartbeat,
    });
  } else {
    waitResult = await waitForAssistantResponse({
      page,
      timeoutMs: config.chatgptResponseTimeoutMs,
      logger,
      expectedT247Id: t247Id,
      assistantCountBefore,
      userCountBefore,
      onProgress: heartbeat,
    });
  }

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
    const { inspectExistingSubmissionAndResponse: inspectOnTimeout } =
      await import("./inspectExistingSubmission.js");
    const timeoutInspect = await inspectOnTimeout({
      page,
      expectedT247Id: t247Id,
      logger,
    });
    if (
      timeoutInspect.validQualificationJsonPresent &&
      timeoutInspect.assistantText
    ) {
      logger.info("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
      console.log("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
      logger.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
      console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
      logger.info("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
      console.log("CHATGPT_EXISTING_RESPONSE_RECOVERY_START=true");
      waitResult = {
        status: "complete",
        text: timeoutInspect.assistantText,
        reason: "timeout_recovery_existing_json",
      };
    } else {
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
      latestAssistantText:
        waitResult.text || timeoutInspect.assistantText || null,
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
    } // end else: no recoverable JSON on timeout
  }

  let responseText = waitResult.text;
  if (waitResult.status === "complete" && waitResult.reason) {
    logger.info(`CHATGPT_RESPONSE_COMPLETE_REASON=${waitResult.reason}`);
    console.log(`CHATGPT_RESPONSE_COMPLETE_REASON=${waitResult.reason}`);
  }
  saveRawResponse(responseText);
  logger.info("CHATGPT_RESPONSE_COMPLETE=true");
  console.log("CHATGPT_RESPONSE_COMPLETE=true");
  logger.info(`CHATGPT_RESPONSE_LENGTH=${responseText.length}`);
  console.log(`CHATGPT_RESPONSE_LENGTH=${responseText.length}`);

  logger.info("CHATGPT_JSON_PARSE_START");
  console.log("CHATGPT_JSON_PARSE_START");
  let validated = parseAndValidateQualificationResponse(responseText, t247Id);
  if (validated.ok) {
    logger.info("CHATGPT_JSON_PARSED=true");
    console.log("CHATGPT_JSON_PARSED=true");
    logger.info(`CHATGPT_RESULT=${validated.result.status}`);
    console.log(`CHATGPT_RESULT=${validated.result.status}`);
  }

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

  // INVARIANT: assistant response exists => NEVER send another prompt.
  // Status / JSON / upload-review "correction" prompts are permanently disabled.
  if (!validated.ok) {
    logger.warn(
      `CHATGPT_DUPLICATE_PROMPT_BLOCKED=true reason=invalid_or_unparsed_response error=${validated.error || validated.status || "unknown"}`,
    );
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_CORRECTION_PROMPT_FORBIDDEN=true");
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

  let finalResult = withUploadedEvidenceFiles(
    validated.result,
    uploadedEvidenceFiles,
  );
  const falseMissing = applyFalseMissingDocumentClaim({
    result: finalResult,
    uploadedEvidenceFiles,
    metadataUploaded: existing?.metadataUploaded,
    documentZipUploaded: existing?.documentArchiveUploaded,
  });
  if (falseMissing.falseClaim) {
    logger.warn("MODEL_FALSE_MISSING_DOCUMENT_CLAIM=true");
    console.log("MODEL_FALSE_MISSING_DOCUMENT_CLAIM=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    console.log("CHATGPT_CORRECTION_PROMPT_FORBIDDEN=true");
    logger.info("CHATGPT_CORRECTION_PROMPT_FORBIDDEN=true");
    logger.info(
      `CHATGPT_ATTACHMENT_MANIFEST=${JSON.stringify(falseMissing.manifest)}`,
    );
    if (falseMissing.result.status === "VERIFY") {
      logger.info("CHATGPT_MODEL_DOCUMENT_INTERPRETATION_CONFLICT=VERIFY");
    }
    finalResult = falseMissing.result;
  }

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

  // Persist independently of ChatGPT — never re-prompt on Supabase failure.
  let supabasePersist = { ok: false, error: "not_attempted" as string | null };
  const maxPersistAttempts = 3;
  for (let persistAttempt = 1; persistAttempt <= maxPersistAttempts; persistAttempt++) {
    supabasePersist = await persistValidatedQualificationToSupabase({
      sourcePortal: "TENDER247",
      sourceTenderId: t247Id,
      qualification: finalResult,
      rawResponse: responseText,
      chatUrl: finalChatUrl,
      logger,
    });
    if (supabasePersist.ok) break;
    logger.warn(
      `CHATGPT_PERSIST_RETRY_PENDING=true attempt=${persistAttempt}/${maxPersistAttempts} error=${supabasePersist.error}`,
    );
    console.log("CHATGPT_PERSIST_RETRY_PENDING=true");
    console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
    if (persistAttempt < maxPersistAttempts) {
      await page.waitForTimeout(1500 * persistAttempt);
    }
  }

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
      `CHATGPT_DB_SYNC_FAILED — raw response retained for retry (no GPT re-prompt): ${supabasePersist.error}`,
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

  const inputFingerprint = computeQualificationInputFingerprint({
    dateFolder,
    sourceTenderId: t247Id,
    sourcePortal: "TENDER247",
  });
  saveQualificationInputFingerprint(tenderFolder, inputFingerprint);

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
    qualificationInputHash: inputFingerprint.qualificationInputHash,
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
