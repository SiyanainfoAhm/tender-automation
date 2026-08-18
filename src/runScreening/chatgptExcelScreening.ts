/**
 * Run-level ChatGPT Project Excel screening.
 * Reuses the existing Siyana Tender Qualification Automation project session.
 * Submission mode is RUN_EXCEL_SCREENING — never the tender-artifact pre-send gate.
 *
 * The ChatGPT browser stays open until the generated XLSX is downloaded
 * or an explicit terminal failure is recorded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  launchChatGptPersistentSession,
  ensureChatGptLoggedIn,
} from "../chatgptQualification/ensureChatGptLoggedIn.js";
import { openFreshTenderPage } from "../chatgptQualification/freshTenderTab.js";
import {
  detectSubmissionSignals,
  isConversationUrl,
  sendComposerMessage,
  typeComposerPrompt,
  uploadFilesToComposer,
  waitForAssistantResponse,
} from "../chatgptQualification/chatInteraction.js";
import {
  findGeneratedScreeningWorkbook,
  revealDownloadControl,
  resolveAssistantSpreadsheetHref,
  tryFindGeneratedWorkbookInLibrary,
  type GeneratedScreeningWorkbook,
} from "../chatgptQualification/assistantSpreadsheetAttachment.js";
import { ensureDir } from "../fileUtils.js";
import { RUN_NORMALIZED_FILE } from "./runWorkbook.js";
import {
  loadScreeningChatCheckpoint,
  saveScreeningChatCheckpoint,
} from "./screeningManifest.js";
import {
  assertChatGptScreeningSafeToClose,
  isChatGptScreeningSafeToClose,
} from "./screeningSessionGuard.js";

export const RUN_SCREENING_PROMPT_PATTERN =
  /Evaluate the attached tender Excel for Phase-1 screening/i;

export type ChatGptExcelScreeningClient = {
  screenWorkbook: (options: {
    inputWorkbookPath: string;
    prompt: string;
    outputPath: string;
    runDate: string;
  }) => Promise<string>;
};

function runCorrelationId(runDate: string): string {
  return `RUN-${runDate}`;
}

function log(logger: Logger, message: string): void {
  console.log(message);
  logger.info(message);
}

export function resolveRunScreeningResponseTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(
    env.CHATGPT_RUN_SCREENING_RESPONSE_TIMEOUT_MS ||
      env.CHATGPT_SCREENING_TIMEOUT_MS ||
      "600000",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
}

async function closeScreeningContext(
  context: BrowserContext,
  state: {
    submitted: boolean;
    downloaded: boolean;
    validated?: boolean;
    explicitTerminalFailure: boolean;
  },
  logger: Logger,
): Promise<void> {
  assertChatGptScreeningSafeToClose(state);
  if (!isChatGptScreeningSafeToClose(state)) return;
  log(logger, "CHATGPT_SCREENING_SAFE_TO_CLOSE=true");
  await context.close().catch(() => undefined);
}

export async function downloadGeneratedWorkbook(options: {
  page: Page;
  workbook: GeneratedScreeningWorkbook;
  outputPath: string;
  logger: Logger;
  inputFileName: string;
  conversationUrl?: string;
  correlationId?: string;
}): Promise<{ outputPath: string; originalFilename: string }> {
  const { page, workbook, outputPath, logger, inputFileName } = options;
  ensureDir(path.dirname(outputPath));
  log(logger, "CHATGPT_RUN_SCREENING_STAGE=GENERATED_XLSX_DOWNLOADING");
  log(logger, "CHATGPT_GENERATED_XLSX_DOWNLOAD_START");
  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_START");

  const downloadPromise = page
    .waitForEvent("download", { timeout: 120_000 })
    .catch(() => null);

  const control = await revealDownloadControl(page, workbook);
  if (!control) {
    throw new AutomationError(
      "SCREENING_OUTPUT_MISSING",
      "SCREENING_OUTPUT_MISSING: generated workbook card found but no download control",
    );
  }
  await control.scrollIntoViewIfNeeded().catch(() => undefined);
  await control.click({ timeout: 8_000 }).catch((error) => {
    logger.warn(`CHATGPT_SCREENING_OUTPUT_DOWNLOAD_CLICK_FAILED=${String(error)}`);
  });

  const download = await downloadPromise;
  if (download) {
    log(logger, "CHATGPT_GENERATED_XLSX_DOWNLOAD_EVENT_RECEIVED");
    log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=true");
    const suggested =
      download.suggestedFilename?.() || workbook.filename || "run-screened.xlsx";
    log(logger, `CHATGPT_SCREENING_OUTPUT_SUGGESTED_FILENAME=${suggested}`);
    if (
      inputFileName &&
      suggested.toLowerCase() === inputFileName.toLowerCase()
    ) {
      throw new AutomationError(
        "SCREENING_OUTPUT_MISSING",
        "SCREENING_OUTPUT_MISSING: refused to download the input workbook",
      );
    }
    const tmpPath = path.join(
      os.tmpdir(),
      `chatgpt-screening-${Date.now()}-${suggested}`,
    );
    log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOADING");
    const saved = await saveScreeningDownload(download, tmpPath, logger);
    if (saved) {
      fs.copyFileSync(tmpPath, outputPath);
      return finishScreeningDownload(logger, outputPath, suggested);
    }
  }

  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=false");
  const href = await resolveAssistantSpreadsheetHref(
    page,
    control,
    inputFileName,
  );
  if (href) {
    log(logger, `CHATGPT_SCREENING_OUTPUT_DOWNLOAD_FALLBACK_HREF=${href}`);
    const saved = await saveScreeningHrefDownload(page, href, outputPath, logger);
    if (saved) {
      return finishScreeningDownload(logger, outputPath, workbook.filename);
    }
  }

  if (options.conversationUrl && options.correlationId) {
    log(logger, "CHATGPT_SCREENING_LIBRARY_FALLBACK_START");
    const libraryHit = await tryFindGeneratedWorkbookInLibrary(page, {
      filename: workbook.filename,
      correlationId: options.correlationId,
      conversationUrl: options.conversationUrl,
    });
    if (libraryHit) {
      return downloadGeneratedWorkbook({
        ...options,
        workbook: libraryHit,
        conversationUrl: undefined,
      });
    }
  }

  throw new AutomationError(
    "SCREENING_OUTPUT_MISSING",
    "SCREENING_OUTPUT_MISSING: generated workbook was visible but could not be downloaded",
  );
}

export async function waitForReturnedWorkbook(options: {
  page: Page;
  outputPath: string;
  timeoutMs: number;
  logger: Logger;
  inputFileName: string;
  assistantCountBefore?: number;
  expectedFilename?: string;
  correlationId?: string;
}): Promise<{ outputPath: string; originalFilename: string }> {
  const { page, outputPath, timeoutMs, logger, inputFileName } = options;
  const assistantCountBefore = options.assistantCountBefore ?? 0;
  const correlationId = options.correlationId || "RUN";
  ensureDir(path.dirname(outputPath));
  log(logger, "[AI SCREENING] Waiting for returned XLSX...");
  log(logger, "CHATGPT_SCREENING_OUTPUT_WAITING");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const workbook = await findGeneratedScreeningWorkbook(page, {
      correlationId,
      inputFileName,
      assistantCountBefore,
    });
    if (!workbook) {
      await page.waitForTimeout(1_000).catch(() => undefined);
      continue;
    }
    logger.info("CHATGPT_SCREENING_OUTPUT_DETECTED");
    logger.info("[AI SCREENING] Returned workbook detected");
    return downloadGeneratedWorkbook({
      page,
      workbook,
      outputPath,
      logger,
      inputFileName,
      conversationUrl: isConversationUrl(page.url()) ? page.url() : undefined,
      correlationId,
    });
  }

  throw new AutomationError(
    "SCREENING_OUTPUT_MISSING",
    "SCREENING_OUTPUT_MISSING: ChatGPT finished responding but did not return a downloadable Excel workbook",
  );
}

function finishScreeningDownload(
  logger: Logger,
  outputPath: string,
  suggested: string,
): { outputPath: string; originalFilename: string } {
  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOADED");
  log(logger, "CHATGPT_GENERATED_XLSX_DOWNLOAD_COMPLETE");
  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_COMPLETE=true");
  log(logger, "CHATGPT_RUN_SCREENING_STAGE=GENERATED_XLSX_DOWNLOADED");
  log(logger, `[AI SCREENING] Workbook downloaded=${outputPath}`);
  log(logger, `CHATGPT_SCREENING_OUTPUT_FILE=${outputPath}`);
  log(logger, `CHATGPT_SCREENING_OUTPUT_PATH=${outputPath}`);
  log(logger, `CHATGPT_SCREENING_ORIGINAL_OUTPUT_FILENAME=${suggested}`);
  return { outputPath, originalFilename: suggested };
}

async function saveScreeningHrefDownload(
  page: Page,
  href: string,
  outputPath: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const response = await page.request.get(href);
    if (!response.ok()) {
      logger.warn(
        `CHATGPT_SCREENING_OUTPUT_DOWNLOAD_FALLBACK_STATUS=${response.status()}`,
      );
      return false;
    }
    const body = await response.body();
    if (!body || body.length < 4) return false;
    fs.writeFileSync(outputPath, body);
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
  } catch (error) {
    logger.warn(
      `CHATGPT_SCREENING_OUTPUT_DOWNLOAD_FALLBACK_FAILED=${String(error)}`,
    );
    return false;
  }
}

async function saveScreeningDownload(
  download: Download,
  outputPath: string,
  logger: Logger,
): Promise<boolean> {
  try {
    await download.saveAs(outputPath);
  } catch (error) {
    const failure = await download.failure().catch(() => String(error));
    logger.warn(`CHATGPT_SCREENING_DOWNLOAD_SAVE_RETRY=${failure || "saveAs failed"}`);
    const tmpPath = await download.path().catch(() => null);
    if (tmpPath && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
      fs.copyFileSync(tmpPath, outputPath);
    }
  }
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

function isTerminalScreeningFailure(error: unknown): boolean {
  if (!(error instanceof AutomationError)) return false;
  return (
    error.code === "SCREENING_OUTPUT_MISSING" ||
    error.code === "CHATGPT_RATE_LIMITED" ||
    error.code === "CHATGPT_CONVERSATION_URL_LOST" ||
    error.code === "CHATGPT_RESPONSE_WAIT_WITHOUT_SUBMISSION" ||
    error.code === "CHATGPT_PROMPT_NOT_SUBMITTED"
  );
}

export function createLiveChatGptExcelScreeningClient(options: {
  config: AppConfig;
  logger: Logger;
}): ChatGptExcelScreeningClient {
  const { config, logger } = options;
  return {
    async screenWorkbook({ inputWorkbookPath, prompt, outputPath, runDate }) {
      const correlationId = runCorrelationId(runDate);
      const inputFileName =
        path.basename(inputWorkbookPath) || RUN_NORMALIZED_FILE;
      log(logger, `CHATGPT_SCREENING_INPUT_FILE=${inputWorkbookPath}`);
      log(logger, `CHATGPT_SCREENING_OUTPUT_FILE=${outputPath}`);
      const session = await launchChatGptPersistentSession({
        config,
        logger,
        downloadPath: path.dirname(outputPath),
      });
      const closeState = {
        submitted: false,
        downloaded: false,
        validated: false,
        explicitTerminalFailure: false,
      };
      try {
        await ensureChatGptLoggedIn({
          page: session.page,
          context: session.context,
          config,
          logger,
        });
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=PROJECT_READY");

        const checkpoint = loadScreeningChatCheckpoint(outputPath);
        if (
          checkpoint &&
          checkpoint.correlationId === correlationId &&
          checkpoint.conversationUrl &&
          isConversationUrl(checkpoint.conversationUrl)
        ) {
          log(
            logger,
            `CHATGPT_SCREENING_RESUME_CONVERSATION=${checkpoint.conversationUrl}`,
          );
          try {
            await session.page.goto(checkpoint.conversationUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60_000,
            });
            const existing = await findGeneratedScreeningWorkbook(session.page, {
              correlationId,
              inputFileName,
              assistantCountBefore: 0,
            });
            if (existing) {
              closeState.submitted = true;
              const downloaded = await downloadGeneratedWorkbook({
                page: session.page,
                workbook: existing,
                outputPath,
                logger,
                inputFileName,
                conversationUrl: checkpoint.conversationUrl,
                correlationId,
              });
              closeState.downloaded = true;
              closeState.validated = true;
              log(logger, "CHATGPT_RUN_SCREENING_STAGE=GENERATED_XLSX_DOWNLOADED");
              return downloaded.outputPath;
            }
            log(logger, "CHATGPT_SCREENING_RESUME_NO_XLSX_YET=true");
          } catch (error) {
            logger.warn(
              `CHATGPT_SCREENING_RESUME_FAILED=${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        const page = await openFreshTenderPage({
          context: session.context,
          config,
          logger,
          workerId: 0,
          sourceTenderId: correlationId,
        });
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=COMPOSER_READY");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_FILE_UPLOADING");
        await uploadFilesToComposer({
          page,
          filePaths: [inputWorkbookPath],
          logger,
          expectedAttachmentCount: 1,
        });
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_XLSX_UPLOADED");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_FILE_READY");
        await typeComposerPrompt(page, prompt, logger);
        log(logger, "[AI SCREENING] Prompt prepared");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=PROMPT_ENTERED");

        const already = await detectSubmissionSignals(page, {
          expectedT247Id: correlationId,
          userMessagePattern: RUN_SCREENING_PROMPT_PATTERN,
        });
        let sendResult = already.submitted
          ? {
              chatUrl: already.url,
              baseline: {
                assistantCountBefore: 0,
                userCountBefore: 0,
                capturedAt: new Date().toISOString(),
              },
              submissionConfirmed: true as const,
            }
          : null;
        if (already.submitted) {
          log(logger, "CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
          log(logger, "CHATGPT_MESSAGE_SUBMITTED=true");
        } else {
          sendResult = await sendComposerMessage(page, logger, {
            requireNewConversation: true,
            submissionKind: "RUN_EXCEL_SCREENING",
            userMessagePattern: RUN_SCREENING_PROMPT_PATTERN,
            expectedT247Id: correlationId,
            minAttachmentCount: 1,
            confirmedAttachments: {
              requiredAttachmentsConfirmed: true,
              sourcePortal: "TENDER247",
              sourceTenderId: correlationId,
              fileNames: [inputFileName],
              composerIdentity: "run-screening",
            },
          });
        }
        if (!sendResult?.submissionConfirmed) {
          closeState.explicitTerminalFailure = true;
          throw new AutomationError(
            "CHATGPT_PROMPT_NOT_SUBMITTED",
            "Run-level screening prompt was not submitted",
          );
        }
        closeState.submitted = true;
        log(
          logger,
          "[AI SCREENING] Prompt sent to Siyana Tender Qualification Automation",
        );
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=MESSAGE_SUBMITTED");
        saveScreeningChatCheckpoint(outputPath, {
          conversationUrl: sendResult.chatUrl || page.url(),
          correlationId,
          expectedFilename: `run-normalized-screened-${correlationId}.xlsx`,
          submittedAt: new Date().toISOString(),
          stage: "MESSAGE_SUBMITTED",
        });
        log(logger, "[AI SCREENING] Waiting for ChatGPT screening response...");

        const timeoutMs = resolveRunScreeningResponseTimeoutMs();
        log(logger, `CHATGPT_RUN_SCREENING_RESPONSE_TIMEOUT_MS=${timeoutMs}`);
        const waitResult = await waitForAssistantResponse({
          page,
          timeoutMs,
          logger,
          expectedT247Id: correlationId,
          assistantCountBefore: sendResult.baseline.assistantCountBefore,
          userCountBefore: sendResult.baseline.userCountBefore,
          submissionKind: "RUN_EXCEL_SCREENING",
          completionMode: "generation_complete",
          inputWorkbookFileName: inputFileName,
        });
        if (waitResult.status !== "complete" || !waitResult.outputFilename) {
          throw new AutomationError(
            "SCREENING_OUTPUT_MISSING",
            `SCREENING_OUTPUT_MISSING: screening response did not complete (${waitResult.status})`,
          );
        }
        log(logger, "[AI SCREENING] Response complete");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=RESPONSE_STABLE");

        const workbook = await findGeneratedScreeningWorkbook(page, {
          correlationId,
          inputFileName,
          assistantCountBefore: sendResult.baseline.assistantCountBefore,
        });
        if (!workbook) {
          throw new AutomationError(
            "SCREENING_OUTPUT_MISSING",
            "SCREENING_OUTPUT_MISSING: stable wait completed without a generated workbook card",
          );
        }

        saveScreeningChatCheckpoint(outputPath, {
          conversationUrl: page.url(),
          correlationId,
          expectedFilename: workbook.filename,
          submittedAt: new Date().toISOString(),
          stage: "GENERATED_XLSX_DETECTED",
        });

        const downloaded = await downloadGeneratedWorkbook({
          page,
          workbook,
          outputPath,
          logger,
          inputFileName,
          conversationUrl: page.url(),
          correlationId,
        });
        closeState.downloaded = true;
        closeState.validated = true;
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=OUTPUT_FILE_VALIDATING");
        return downloaded.outputPath;
      } catch (error) {
        if (isTerminalScreeningFailure(error) || closeState.downloaded) {
          closeState.explicitTerminalFailure = true;
        }
        if (closeState.submitted && !closeState.downloaded) {
          logger.warn("CHATGPT_SCREENING_CHAT_PRESERVED=true");
        }
        throw error;
      } finally {
        try {
          await closeScreeningContext(session.context, closeState, logger);
        } catch (closeError) {
          if (
            closeError instanceof AutomationError &&
            closeError.code === "REFUSING_TO_CLOSE_CHATGPT_SCREENING"
          ) {
            logger.error(closeError.message);
            logger.warn("CHATGPT_SCREENING_BROWSER_LEFT_OPEN=true");
          } else {
            throw closeError;
          }
        }
      }
    },
  };
}
