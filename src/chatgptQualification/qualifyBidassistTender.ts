/**
 * BidAssist ChatGPT qualification — uses Supabase temp metadata + original ZIP.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { requestedDateFromDateFolder } from "../tender247Batch/tender247RunContext.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { persistValidatedQualificationToSupabase } from "../supabase/persistQualification.js";
import {
  invalidatePendingChatWithoutAttachments,
  isResumablePendingState,
  loadChatGptTenderState,
  saveChatGptTenderState,
  upsertQualificationManifestEntry,
} from "./chatgptState.js";
import {
  handleRateLimitModal,
  isConversationUrl,
  prepareTenderSpecificUploadFiles,
  waitForAssistantResponse,
  type MessageBaseline,
} from "./chatInteraction.js";
import {
  assertBidassistBundleComplete,
  enterPromptAndSendWithConfirmedAttachments,
  logAttachmentBundle,
  uploadQualificationAttachments,
} from "./uploadQualificationAttachments.js";
import { ensureProjectHome, assertProjectHomeOpen } from "./openProject.js";
import {
  buildQualificationPrompt,
  claimsMandatoryUploadsUnavailable,
  isValidSavedQualificationResult,
  parseAndValidateQualificationResponse,
  withUploadedEvidenceFiles,
} from "./qualificationSchema.js";
import type { QualifyTenderOutcome } from "./processTenderQualification.js";
import { resolveQualificationFiles } from "./sourceDocumentResolver.js";
import { assertPrescreenAllowsChatgpt } from "../prescreen/chatgptGate.js";

export async function qualifyBidassistTender(options: {
  page: Page;
  dateFolder: string;
  sourceTenderId: string;
  tenderFolder: string;
  config: AppConfig;
  logger: Logger;
}): Promise<QualifyTenderOutcome> {
  const { page, dateFolder, sourceTenderId, tenderFolder, config, logger } =
    options;
  const dateIso = requestedDateFromDateFolder(dateFolder);
  ensureDir(tenderFolder);
  const resultPath = path.join(tenderFolder, "qualification-result.json");
  const responsePath = path.join(tenderFolder, "qualification-response.txt");
  const label = sourceTenderId.toUpperCase().startsWith("BA-")
    ? sourceTenderId
    : `BA-${sourceTenderId}`;

  if (isValidSavedQualificationResult(resultPath)) {
    const qualification = JSON.parse(
      fs.readFileSync(resultPath, "utf8"),
    ) as NonNullable<QualifyTenderOutcome["qualification"]>;
    logger.info(`CHATGPT_QUALIFICATION_ALREADY_COMPLETE_SKIP=${label}`);
    return {
      t247Id: sourceTenderId,
      status: "skipped",
      resultPath,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification,
      chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
      error: null,
    };
  }

  if (
    fs.existsSync(responsePath) &&
    fs.statSync(responsePath).size > 0 &&
    loadChatGptTenderState(tenderFolder)?.submissionConfirmed
  ) {
    const raw = fs.readFileSync(responsePath, "utf8");
    const parsed = parseAndValidateQualificationResponse(
      raw,
      sourceTenderId,
      "BIDASSIST",
    );
    if (parsed.ok && !parsed.fallback) {
      fs.writeFileSync(resultPath, JSON.stringify(parsed.result, null, 2), "utf8");
      const db = await persistValidatedQualificationToSupabase({
        sourcePortal: "BIDASSIST",
        sourceTenderId,
        qualification: parsed.result,
        rawResponse: raw,
        chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
        logger,
      });
      if (db.ok) {
        saveChatGptTenderState(tenderFolder, {
          t247Id: sourceTenderId,
          chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
          status: "completed",
          updatedAt: new Date().toISOString(),
          submissionConfirmed: true,
        });
        return {
          t247Id: sourceTenderId,
          status: "completed",
          resultPath,
          responsePath,
          qualification: parsed.result,
          chatUrl: loadChatGptTenderState(tenderFolder)?.chatUrl ?? null,
          error: null,
        };
      }
    }
  }

  const prescreenGate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "BIDASSIST",
    sourceTenderId,
    logger,
  });
  if (!prescreenGate.allowed) {
    return {
      t247Id: sourceTenderId,
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
      `CHATGPT_PENDING_CHAT_INVALIDATED=${label} reason=attachments_not_confirmed`,
    );
  }

  if (isResumablePendingState(existingState)) {
    logger.info(`CHATGPT_PENDING_CHAT_RESUME=${label}`);
    await page.goto(existingState.chatUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    return await waitParseAndPersistBidassist({
      page,
      sourceTenderId,
      tenderFolder,
      dateFolder,
      dateIso,
      resultPath,
      responsePath,
      chatUrl: existingState.chatUrl,
      config,
      logger,
      baseline: {
        assistantCountBefore: existingState.assistantCountBefore ?? 0,
        userCountBefore: existingState.userCountBefore ?? 0,
        capturedAt:
          existingState.promptSubmittedAt || existingState.updatedAt,
      },
      uploadedEvidenceFiles:
        existingState.attachmentFileNames ||
        existingState.uploadedEvidenceFiles ||
        [],
      submittedAt: Date.now(),
    });
  }

  let cleanup: (() => void) | undefined;
  try {
    const files = await resolveQualificationFiles(
      "BIDASSIST",
      sourceTenderId,
      tenderFolder,
    );
    cleanup = files.cleanup;

    assertBidassistBundleComplete(files.files, sourceTenderId);
    logAttachmentBundle("BIDASSIST", sourceTenderId, files.files, logger);

    await ensureProjectHome({
      page,
      projectName: config.chatgptProjectName,
      projectMatch: config.chatgptProjectMatch,
      projectUrl: config.chatgptProjectUrl,
      config,
      logger,
    });
    assertProjectHomeOpen(page);

    const prepared = prepareTenderSpecificUploadFiles({
      t247Id: sourceTenderId,
      tenderFolder,
      metadataPath: files.metadataPath,
      aiSummaryPath: null,
      documentZipPath: files.documentArchivePath,
      logger,
    });
    void prepared;

    const prompt = buildQualificationPrompt("BIDASSIST", sourceTenderId, {
      aiSummaryAvailable: false,
    });

    const confirmed = await uploadQualificationAttachments({
      page,
      sourcePortal: "BIDASSIST",
      sourceTenderId,
      files: files.files,
      logger,
      config,
    });

    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      sourcePortal: "BIDASSIST",
      sourceTenderId,
      chatUrl: null,
      status: "attachments_confirmed",
      submissionConfirmed: false,
      requiredAttachmentsConfirmed: true,
      attachmentFileNames: confirmed.fileNames,
      attachmentCount: confirmed.fileNames.length,
      attachmentHashes: confirmed.attachmentHashes,
      attachmentConfirmedAt: new Date().toISOString(),
      composerIdentity: confirmed.composerIdentity,
      phase: "FILES_UPLOADED",
      updatedAt: new Date().toISOString(),
      error: null,
      uploadedEvidenceFiles: confirmed.fileNames,
    });

    const send = await enterPromptAndSendWithConfirmedAttachments({
      page,
      prompt,
      logger,
      confirmed,
    });
    logger.info("CHATGPT_PROMPT_SUBMITTED");

    const chatUrl = send.chatUrl;
    if (!isConversationUrl(chatUrl)) {
      throw new AutomationError(
        "CHATGPT_PROMPT_NOT_SUBMITTED",
        `Verified submission missing /c/ conversation URL (got ${chatUrl})`,
      );
    }

    const evidenceFiles = confirmed.fileNames;
    const submittedAt = Date.now();
    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      sourcePortal: "BIDASSIST",
      sourceTenderId,
      chatUrl,
      submittedChatUrl: chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      requiredAttachmentsConfirmed: true,
      attachmentFileNames: evidenceFiles,
      attachmentCount: evidenceFiles.length,
      attachmentHashes: confirmed.attachmentHashes,
      attachmentConfirmedAt: new Date().toISOString(),
      composerIdentity: confirmed.composerIdentity,
      phase: "CONVERSATION_URL_CONFIRMED",
      promptSubmittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uploadedEvidenceFiles: evidenceFiles,
      assistantCountBefore: send.baseline.assistantCountBefore,
      userCountBefore: send.baseline.userCountBefore,
      error: null,
    });

    const rateLimited = await handleRateLimitModal(page, logger);
    if (rateLimited) {
      logger.warn(
        "CHATGPT_RATE_LIMITED — preserving chat URL, not failing tender",
      );
      return {
        t247Id: sourceTenderId,
        status: "rate_limited",
        resultPath: null,
        responsePath: null,
        qualification: null,
        chatUrl,
        error: "Too many requests",
        submittedAt,
        retryAfterMs: config.chatgptRateLimitInitialBackoffMs,
      };
    }

    return await waitParseAndPersistBidassist({
      page,
      sourceTenderId,
      tenderFolder,
      dateFolder,
      dateIso,
      resultPath,
      responsePath,
      chatUrl,
      config,
      logger,
      baseline: send.baseline,
      uploadedEvidenceFiles: evidenceFiles,
      submittedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`CHATGPT_BIDASSIST_FAILED=${label} ${message}`);
    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      chatUrl: isConversationUrl(page.url()) ? page.url() : null,
      status: "failed",
      submissionConfirmed: false,
      requiredAttachmentsConfirmed: false,
      updatedAt: new Date().toISOString(),
      error: message,
    });
    upsertQualificationManifestEntry(dateFolder, dateIso, {
      t247Id: sourceTenderId,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: message,
    });
    return {
      t247Id: sourceTenderId,
      status: "failed",
      resultPath: null,
      responsePath: null,
      qualification: null,
      chatUrl: null,
      error: message,
    };
  } finally {
    cleanup?.();
  }
}

async function waitParseAndPersistBidassist(options: {
  page: Page;
  sourceTenderId: string;
  tenderFolder: string;
  dateFolder: string;
  dateIso: string;
  resultPath: string;
  responsePath: string;
  chatUrl: string;
  config: AppConfig;
  logger: Logger;
  baseline: MessageBaseline;
  uploadedEvidenceFiles: string[];
  submittedAt: number;
}): Promise<QualifyTenderOutcome> {
  const {
    page,
    sourceTenderId,
    tenderFolder,
    resultPath,
    responsePath,
    chatUrl,
    config,
    logger,
    baseline,
    uploadedEvidenceFiles,
    submittedAt,
  } = options;

  const waitResult = await waitForAssistantResponse({
    page,
    timeoutMs: config.chatgptResponseTimeoutMs,
    logger,
    expectedT247Id: sourceTenderId,
    assistantCountBefore: baseline.assistantCountBefore,
    userCountBefore: baseline.userCountBefore,
  });

  if (waitResult.status !== "complete" || !waitResult.text) {
    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      requiredAttachmentsConfirmed: true,
      attachmentFileNames: uploadedEvidenceFiles,
      attachmentCount: uploadedEvidenceFiles.length,
      updatedAt: new Date().toISOString(),
      error: waitResult.status,
    });
    return {
      t247Id: sourceTenderId,
      status: "response_pending",
      resultPath: null,
      responsePath: fs.existsSync(responsePath) ? responsePath : null,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: `Response not complete: ${waitResult.status}`,
      submittedAt,
    };
  }

  logger.info("CHATGPT_RESPONSE_COMPLETE");
  const responseText = waitResult.text;
  fs.writeFileSync(responsePath, responseText, "utf8");
  logger.info("CHATGPT_RAW_RESPONSE_SAVED");

  const validated = parseAndValidateQualificationResponse(
    responseText,
    sourceTenderId,
    "BIDASSIST",
  );
  if (!validated.ok || validated.fallback) {
    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      requiredAttachmentsConfirmed: true,
      attachmentFileNames: uploadedEvidenceFiles,
      attachmentCount: uploadedEvidenceFiles.length,
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      error: validated.ok ? "fallback rejected" : validated.error,
    });
    return {
      t247Id: sourceTenderId,
      status: "response_pending",
      resultPath: null,
      responsePath,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: validated.ok ? "fallback rejected" : validated.error,
      submittedAt,
    };
  }

  const finalResult = withUploadedEvidenceFiles(
    validated.result,
    uploadedEvidenceFiles,
  );
  if (claimsMandatoryUploadsUnavailable(finalResult, uploadedEvidenceFiles)) {
    return {
      t247Id: sourceTenderId,
      status: "response_pending",
      resultPath: null,
      responsePath,
      qualification: null,
      chatUrl: isConversationUrl(page.url()) ? page.url() : chatUrl,
      error: "Assistant claims uploaded files unavailable",
      submittedAt,
    };
  }

  fs.writeFileSync(resultPath, JSON.stringify(finalResult, null, 2), "utf8");
  logger.info("CHATGPT_RESULT_VALIDATED");

  const finalChatUrl = isConversationUrl(page.url()) ? page.url() : chatUrl;
  const db = await persistValidatedQualificationToSupabase({
    sourcePortal: "BIDASSIST",
    sourceTenderId,
    qualification: finalResult,
    rawResponse: responseText,
    chatUrl: finalChatUrl,
    logger,
  });
  if (!db.ok) {
    saveChatGptTenderState(tenderFolder, {
      t247Id: sourceTenderId,
      chatUrl: finalChatUrl,
      status: "response_pending",
      submissionConfirmed: true,
      requiredAttachmentsConfirmed: true,
      attachmentFileNames: uploadedEvidenceFiles,
      attachmentCount: uploadedEvidenceFiles.length,
      phase: "DB_SYNC_FAILED",
      updatedAt: new Date().toISOString(),
      latestAssistantText: responseText,
      uiState: "response_saved_db_pending",
      error: db.error,
    });
    return {
      t247Id: sourceTenderId,
      status: "response_pending",
      resultPath,
      responsePath,
      qualification: finalResult,
      chatUrl: finalChatUrl,
      error: db.error,
      submittedAt,
    };
  }

  saveChatGptTenderState(tenderFolder, {
    t247Id: sourceTenderId,
    chatUrl: finalChatUrl,
    status: "completed",
    submissionConfirmed: true,
    requiredAttachmentsConfirmed: true,
    attachmentFileNames: uploadedEvidenceFiles,
    attachmentCount: uploadedEvidenceFiles.length,
    phase: "COMPLETED",
    updatedAt: new Date().toISOString(),
    latestAssistantText: responseText,
    uploadedEvidenceFiles,
    error: null,
  });
  logger.info("CHATGPT_QUALIFICATION_COMPLETE");

  return {
    t247Id: sourceTenderId,
    status: "completed",
    resultPath,
    responsePath,
    qualification: finalResult,
    chatUrl: finalChatUrl,
    error: null,
    submittedAt,
  };
}
