/**
 * Run-level ChatGPT Excel screening via the persistent shared screening chat.
 * Uploads Tender247 Excel + screening.md, waits for returned screened XLSX.
 * Falls back to JSON decisions only when no workbook is returned.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Download, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  launchChatGptPersistentSession,
  ensureChatGptLoggedIn,
} from "../chatgptQualification/ensureChatGptLoggedIn.js";
import {
  isConversationUrl,
  sendComposerMessage,
  typeComposerPrompt,
  uploadFilesToComposer,
  waitForRunExcelScreeningAttachmentReady,
  findSubmittedUserMessage,
  type MessageBaseline,
} from "../chatgptQualification/chatInteraction.js";
import {
  findGeneratedScreeningWorkbook,
  findExistingDailyScreeningWorkbookInChat,
  findDailyWorkbookInAssistantAfterUserMessage,
  isDailyScreeningOutputFilename,
  isScreeningGenerationActive,
  countAssistantMessages,
  revealDownloadControl,
  resolveAssistantSpreadsheetHref,
  tryFindGeneratedWorkbookInLibrary,
  type GeneratedScreeningWorkbook,
} from "../chatgptQualification/assistantSpreadsheetAttachment.js";
import { ensureDir } from "../fileUtils.js";
import { dailyScreeningOutputFilename } from "./buildDailyScreeningOperatorPrompt.js";
import {
  downloadFromSpreadsheetPreview,
  downloadGeneratedChatGptXlsx,
  downloadFailedError,
  previewOpenFailedError,
  closeSpreadsheetPreviewIfOpen,
  type ScreeningArtifactStatus,
} from "./chatgptXlsxPreviewDownload.js";
import {
  loadScreeningChatCheckpoint,
  saveScreeningChatCheckpoint,
} from "./screeningManifest.js";
import {
  assertChatGptScreeningSafeToClose,
  isChatGptScreeningSafeToClose,
} from "./screeningSessionGuard.js";
import { parseScreeningDecisionsJson } from "./screeningDecisionSchema.js";
import { openPersistentScreeningChat } from "./dailyScreeningChat.js";

export const RUN_SCREENING_PROMPT_PATTERN =
  /Run Siyana Tender247 Daily Screening|SIYANA DAILY TENDER SCREENING|Follow the attached `screening\.md`|Evaluate the attached tender Excel for Phase-1 screening|Run correlation ID:\s*RUN-\d{4}-\d{2}-\d{2}|OUTPUT CONTRACT/i;

export type ChatGptScreeningResult = {
  /** Present when GPT returns JSON decisions (legacy / fallback). */
  decisionsText?: string;
  /** Present when GPT returns the screened Excel workbook. */
  screenedWorkbookPath?: string;
  conversationUrl: string;
  decisionsPath?: string;
};

export type ChatGptExcelScreeningClient = {
  screenWorkbook: (options: {
    inputWorkbookPath: string;
    prompt: string;
    /** Optional screening.md path uploaded alongside the Excel. */
    screeningMdPath?: string | null;
    /** Optional extra files (e.g. duplicate-rows-manifest.json). */
    extraUploadPaths?: string[];
    outputPath: string;
    runDate: string;
  }) => Promise<ChatGptScreeningResult>;
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

async function clickForWorkbookDownload(
  page: Page,
  control: Locator,
  logger: Logger,
  timeoutMs: number,
): Promise<Download | null> {
  const downloadPromise = page
    .waitForEvent("download", { timeout: timeoutMs })
    .catch(() => null);
  await control.scrollIntoViewIfNeeded().catch(() => undefined);
  await control.click({ force: true, timeout: 8_000 }).catch((error) => {
    logger.warn(
      `CHATGPT_SCREENING_OUTPUT_DOWNLOAD_CLICK_FAILED=${String(error)}`,
    );
  });
  return downloadPromise;
}

async function tryLegacyCardDownload(
  page: Page,
  workbook: GeneratedScreeningWorkbook,
  outputPath: string,
  logger: Logger,
  inputFileName: string,
): Promise<{ outputPath: string; originalFilename: string } | null> {
  const revealed = await revealDownloadControl(page, workbook);
  const controls: Locator[] = [];
  if (revealed) controls.push(revealed);
  if (workbook.downloadLinkLocator) controls.push(workbook.downloadLinkLocator);
  controls.push(
    workbook.cardLocator.getByRole("button", { name: /^download$/i }),
    workbook.cardLocator.getByRole("button", { name: /download file/i }),
    workbook.cardLocator.locator('[aria-label*="Download" i]'),
    workbook.assistantMessageLocator.getByRole("button", { name: /^download$/i }),
    workbook.assistantMessageLocator.getByRole("button", { name: /download file/i }),
    workbook.assistantMessageLocator.locator('[aria-label*="Download" i]'),
    page.getByRole("button", { name: /download file/i }),
    page.locator('button[aria-label="Download file"]'),
    page.locator('button[aria-label*="download" i]'),
  );

  const requireDaily = isDailyScreeningOutputFilename(workbook.filename)
    ? workbook.filename
    : undefined;

  for (const control of controls) {
    const count = await control.count().catch(() => 0);
    if (count === 0) continue;
    const candidate = control.last();
    const download = await clickForWorkbookDownload(page, candidate, logger, 15_000);
    if (!download) continue;
    log(logger, "CHATGPT_XLSX_DOWNLOAD_EVENT_RECEIVED=true");
    log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=true");
    const suggested =
      download.suggestedFilename?.() || workbook.filename || "run-screened.xlsx";
    if (inputFileName && suggested.toLowerCase() === inputFileName.toLowerCase()) {
      logger.warn(`CHATGPT_SCREENING_IGNORED_INPUT_DOWNLOAD=${suggested}`);
      continue;
    }
    if (
      requireDaily &&
      !isDailyScreeningOutputFilename(suggested, requireDaily)
    ) {
      logger.warn(
        `CHATGPT_SCREENING_IGNORED_NON_DAILY_DOWNLOAD=${suggested} (want ${requireDaily})`,
      );
      continue;
    }
    const saved = await saveScreeningDownload(download, outputPath, logger);
    if (saved) {
      const size = fs.statSync(outputPath).size;
      log(logger, "CHATGPT_XLSX_LOCAL_FILE_VERIFIED=true");
      log(logger, `CHATGPT_XLSX_DOWNLOADED_PATH=${outputPath}`);
      log(logger, `CHATGPT_XLSX_DOWNLOADED_FILE_SIZE=${size}`);
      return finishScreeningDownload(logger, outputPath, suggested, requireDaily);
    }
  }
  return null;
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
  const requireDaily = isDailyScreeningOutputFilename(workbook.filename)
    ? workbook.filename
    : undefined;
  let artifactStatus: ScreeningArtifactStatus = "GENERATED";
  log(logger, "AI_SCREENING_GENERATION_STATUS=SUCCESS");
  log(logger, `CHATGPT_SCREENING_ARTIFACT_STATUS=${artifactStatus}`);
  log(logger, "CHATGPT_RUN_SCREENING_STAGE=GENERATED_XLSX_DOWNLOADING");
  log(logger, "CHATGPT_GENERATED_XLSX_DOWNLOAD_START");
  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_START");
  log(logger, "AI_SCREENING_DOWNLOAD_STATUS=DOWNLOADING");
  if (requireDaily) {
    log(logger, `CHATGPT_SCREENING_REQUIRE_DAILY_FILENAME=${requireDaily}`);
    log(logger, "CHATGPT_SCREENING_DAILY_DOWNLOAD_STRATEGY=card_first");
    const cardFirst = await tryLegacyCardDownload(
      page,
      workbook,
      outputPath,
      logger,
      inputFileName,
    );
    if (cardFirst) {
      log(logger, "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS");
      log(logger, "AI_SCREENING_STATUS=SUCCESS");
      return cardFirst;
    }
  }

  const previewAttempt = await downloadGeneratedChatGptXlsx({
    page,
    expectedFilename: workbook.filename,
    cardLocator: workbook.cardLocator,
    finalOutputPath: outputPath,
    logger,
  });
  if ("outputPath" in previewAttempt) {
    if (
      requireDaily &&
      !isDailyScreeningOutputFilename(
        previewAttempt.originalFilename,
        requireDaily,
      )
    ) {
      logger.warn(
        `CHATGPT_SCREENING_PREVIEW_WRONG_FILE=${previewAttempt.originalFilename}`,
      );
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
    } else {
      artifactStatus = "DOWNLOADED";
      log(logger, `CHATGPT_SCREENING_ARTIFACT_STATUS=${artifactStatus}`);
      log(logger, "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS");
      log(logger, "AI_SCREENING_STATUS=SUCCESS");
      return finishScreeningDownload(
        logger,
        previewAttempt.outputPath,
        previewAttempt.originalFilename,
        requireDaily,
      );
    }
  }
  const previewOpened =
    "previewOpened" in previewAttempt ? previewAttempt.previewOpened : true;

  if (previewOpened) {
    await closeSpreadsheetPreviewIfOpen(page, logger);
  }
  if (
    options.conversationUrl &&
    /\/library(?:\/|$|\?)/i.test(page.url())
  ) {
    log(logger, "CHATGPT_SCREENING_RETURN_FROM_LIBRARY=true");
    await page
      .goto(options.conversationUrl, { waitUntil: "domcontentloaded" })
      .catch(() => undefined);
    await page.waitForTimeout(800).catch(() => undefined);
  }

  log(logger, "CHATGPT_XLSX_PREVIEW_DOWNLOAD_FALLBACK=legacy_card_or_href");
  const legacy = await tryLegacyCardDownload(
    page,
    workbook,
    outputPath,
    logger,
    inputFileName,
  );
  if (legacy) {
    log(logger, "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS");
    log(logger, "AI_SCREENING_STATUS=SUCCESS");
    return legacy;
  }

  const stillPreview = await downloadFromSpreadsheetPreview(
    page,
    workbook.filename,
    outputPath,
    logger,
  );
  if (stillPreview) {
    if (
      requireDaily &&
      !isDailyScreeningOutputFilename(
        stillPreview.originalFilename,
        requireDaily,
      )
    ) {
      logger.warn(
        `CHATGPT_SCREENING_PREVIEW_FALLBACK_WRONG_FILE=${stillPreview.originalFilename}`,
      );
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
    } else {
      log(logger, "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS");
      log(logger, "AI_SCREENING_STATUS=SUCCESS");
      return finishScreeningDownload(
        logger,
        stillPreview.outputPath,
        stillPreview.originalFilename,
        requireDaily,
      );
    }
  }

  const href = await resolveAssistantSpreadsheetHref(
    page,
    workbook.cardLocator,
    inputFileName,
  );
  if (href) {
    log(logger, `CHATGPT_SCREENING_OUTPUT_DOWNLOAD_FALLBACK_HREF=${href}`);
    const saved = await saveScreeningHrefDownload(page, href, outputPath, logger);
    if (saved) {
      const size = fs.statSync(outputPath).size;
      log(logger, "CHATGPT_XLSX_LOCAL_FILE_VERIFIED=true");
      log(logger, `CHATGPT_XLSX_DOWNLOADED_PATH=${outputPath}`);
      log(logger, `CHATGPT_XLSX_DOWNLOADED_FILE_SIZE=${size}`);
      log(logger, "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS");
      log(logger, "AI_SCREENING_STATUS=SUCCESS");
      return finishScreeningDownload(
        logger,
        outputPath,
        workbook.filename,
        requireDaily,
      );
    }
  }

  if (options.conversationUrl && options.correlationId && !requireDaily) {
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
  } else if (requireDaily) {
    log(logger, "CHATGPT_SCREENING_LIBRARY_FALLBACK_SKIPPED=daily_screening");
  }

  log(logger, "AI_SCREENING_GENERATION_STATUS=SUCCESS");
  log(logger, "AI_SCREENING_DOWNLOAD_STATUS=FAILED");
  log(logger, "CHATGPT_SCREENING_ARTIFACT_STATUS=DOWNLOAD_FAILED");
  log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=false");
  if (!previewOpened) {
    throw previewOpenFailedError(workbook.filename);
  }
  throw downloadFailedError(workbook.filename, "DOWNLOAD_EVENT_TIMEOUT");
}

function isValidXlsxFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size <= 0) return false;
  const header = fs.readFileSync(filePath).subarray(0, 4);
  return header.length >= 2 && header[0] === 0x50 && header[1] === 0x4b;
}

function archiveDailyScreeningCopy(
  downloadedPath: string,
  expectedDailyFilename: string,
  logger: Logger,
): void {
  const dailyArchivePath = path.join(
    path.dirname(downloadedPath),
    expectedDailyFilename,
  );
  if (path.resolve(dailyArchivePath) === path.resolve(downloadedPath)) return;
  try {
    fs.copyFileSync(downloadedPath, dailyArchivePath);
    log(logger, `CHATGPT_SCREENING_DAILY_ARCHIVE=${dailyArchivePath}`);
  } catch (error) {
    logger.warn?.(
      `CHATGPT_SCREENING_DAILY_ARCHIVE_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function downloadDailyWorkbookOnce(options: {
  page: Page;
  workbook: GeneratedScreeningWorkbook;
  outputPath: string;
  expectedDailyFilename: string;
  logger: Logger;
  inputFileName: string;
  conversationUrl?: string;
  correlationId: string;
  reason: "reuse_existing_chat" | "post_generate";
}): Promise<{ outputPath: string; originalFilename: string }> {
  log(options.logger, `CHATGPT_SCREENING_DAILY_DOWNLOAD_REASON=${options.reason}`);
  const downloaded = await downloadGeneratedWorkbook({
    page: options.page,
    workbook: options.workbook,
    outputPath: options.outputPath,
    logger: options.logger,
    inputFileName: options.inputFileName,
    conversationUrl: options.conversationUrl,
    correlationId: options.correlationId,
  });
  archiveDailyScreeningCopy(
    downloaded.outputPath,
    options.expectedDailyFilename,
    options.logger,
  );
  return downloaded;
}

/** After Send: poll until today's `{DD-MM-YY}_daily Tenders.xlsx` appears on the latest assistant turn. */
async function waitForDailyScreeningWorkbookAfterSend(options: {
  page: Page;
  outputPath: string;
  timeoutMs: number;
  logger: Logger;
  inputFileName: string;
  userCountBefore: number;
  assistantCountBefore: number;
  expectedDailyFilename: string;
  correlationId: string;
  conversationUrl?: string;
}): Promise<{ outputPath: string; originalFilename: string }> {
  const {
    page,
    outputPath,
    timeoutMs,
    logger,
    inputFileName,
    userCountBefore,
    assistantCountBefore,
    expectedDailyFilename,
    correlationId,
  } = options;
  ensureDir(path.dirname(outputPath));
  log(logger, "[AI SCREENING] Waiting for today's daily Excel in chat...");
  log(logger, "CHATGPT_SCREENING_OUTPUT_WAITING");
  log(logger, `CHATGPT_SCREENING_EXPECTED_DAILY=${expectedDailyFilename}`);
  const deadline = Date.now() + timeoutMs;
  let lastDiagnosticAt = 0;
  const messageBaseline: MessageBaseline = {
    assistantCountBefore,
    userCountBefore,
    capturedAt: new Date().toISOString(),
  };

  while (Date.now() < deadline) {
    const generationActive = await isScreeningGenerationActive(page);
    const userCount = await page
      .locator('[data-message-author-role="user"]')
      .count()
      .catch(() => 0);
    const assistantCount = await countAssistantMessages(page);
    const newTurnObserved =
      userCount > userCountBefore || assistantCount > assistantCountBefore;
    const runUserMessage = await findSubmittedUserMessage(page, {
      baseline: messageBaseline,
      userMessagePattern: RUN_SCREENING_PROMPT_PATTERN,
      expectedT247Id: correlationId,
    });
    const readyToScan =
      !generationActive && (newTurnObserved || runUserMessage !== null);

    if (readyToScan) {
      const minUserIndex = runUserMessage?.index ?? userCountBefore;
      const workbook = await findDailyWorkbookInAssistantAfterUserMessage(page, {
        expectedFilename: expectedDailyFilename,
        minUserIndex,
      });
      if (workbook) {
        logger.info("CHATGPT_SCREENING_OUTPUT_DETECTED");
        logger.info("[AI SCREENING] Today's daily workbook ready in chat");
        return downloadDailyWorkbookOnce({
          page,
          workbook,
          outputPath,
          expectedDailyFilename,
          logger,
          inputFileName,
          conversationUrl: options.conversationUrl,
          correlationId,
          reason: "post_generate",
        });
      }
    }

    const now = Date.now();
    if (now - lastDiagnosticAt >= 30_000) {
      lastDiagnosticAt = now;
      log(
        logger,
        `CHATGPT_SCREENING_OUTPUT_WAIT_POLL users=${userCount} userBaseline=${userCountBefore} assistants=${assistantCount} assistantBaseline=${assistantCountBefore} generating=${generationActive} runUserIndex=${runUserMessage?.index ?? "none"} readyToScan=${readyToScan}`,
      );
    }

    await page.waitForTimeout(1_000).catch(() => undefined);
  }

  throw new AutomationError(
    "SCREENING_OUTPUT_MISSING",
    `SCREENING_OUTPUT_MISSING: ChatGPT did not attach ${expectedDailyFilename} before timeout`,
  );
}

export async function waitForReturnedWorkbook(options: {
  page: Page;
  outputPath: string;
  timeoutMs: number;
  logger: Logger;
  inputFileName: string;
  assistantCountBefore?: number;
  userCountBefore?: number;
  expectedFilename?: string;
  correlationId?: string;
  expectedDailyFilename?: string;
  runDate?: string;
}): Promise<{ outputPath: string; originalFilename: string }> {
  if (options.expectedDailyFilename && options.runDate) {
    return waitForDailyScreeningWorkbookAfterSend({
      page: options.page,
      outputPath: options.outputPath,
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      inputFileName: options.inputFileName,
      userCountBefore: options.userCountBefore ?? 0,
      assistantCountBefore: options.assistantCountBefore ?? 0,
      expectedDailyFilename: options.expectedDailyFilename,
      correlationId: options.correlationId || "RUN",
      conversationUrl: isConversationUrl(options.page.url())
        ? options.page.url()
        : undefined,
    });
  }

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
      expectedDailyFilename: options.expectedDailyFilename,
    });
    if (workbook) {
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

    await page.waitForTimeout(1_000).catch(() => undefined);
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
  requiredFilename?: string,
): { outputPath: string; originalFilename: string } {
  if (
    requiredFilename &&
    isDailyScreeningOutputFilename(requiredFilename) &&
    !isDailyScreeningOutputFilename(suggested, requiredFilename)
  ) {
    throw new AutomationError(
      "CHATGPT_WRONG_SCREENING_FILE",
      `Expected daily screening Excel "${requiredFilename}" but download suggested "${suggested}"`,
    );
  }
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
    error.code === "SCREENING_OUTPUT_INVALID" ||
    error.code === "CHATGPT_XLSX_PREVIEW_OPEN_FAILED" ||
    error.code === "CHATGPT_XLSX_DOWNLOAD_FAILED" ||
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
    async screenWorkbook({
      inputWorkbookPath,
      prompt,
      screeningMdPath,
      extraUploadPaths,
      outputPath,
      runDate,
    }) {
      const correlationId = runCorrelationId(runDate);
      const inputFileName = path.basename(inputWorkbookPath);
      if (!inputFileName || !/\.xlsx$/i.test(inputFileName)) {
        throw new AutomationError(
          "CHATGPT_INPUT_FILENAME_INVALID",
          `ChatGPT screening input must be an .xlsx file (got ${inputFileName || "empty"})`,
        );
      }
      const decisionsPath = path.join(
        path.dirname(outputPath),
        "chatgpt-screening-decisions.json",
      );
      const uploadPaths = [inputWorkbookPath];
      if (screeningMdPath && fs.existsSync(screeningMdPath)) {
        uploadPaths.push(screeningMdPath);
      }
      for (const extraPath of extraUploadPaths || []) {
        if (extraPath && fs.existsSync(extraPath)) {
          uploadPaths.push(extraPath);
        }
      }
      log(logger, `CHATGPT_SCREENING_INPUT_FILE=${inputWorkbookPath}`);
      log(logger, `CHATGPT_INPUT_FILENAME=${inputFileName}`);
      if (screeningMdPath) {
        log(logger, `CHATGPT_SCREENING_MD=${screeningMdPath}`);
      }
      log(logger, `CHATGPT_SCREENING_DECISIONS_FILE=${decisionsPath}`);
      log(logger, "CHATGPT_SCREENING_MODE=SHARED_CHAT_XLSX");
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
        // Only resume a workbook that was fully downloaded AND previously marked
        // WORKBOOK_DOWNLOADED — never re-use a failed/partial screening artifact.
        // Also require the checkpoint to point at today's daily Excel name so we
        // never resume a wrongly downloaded run-screened / stale artifact.
        const expectedDailyForResume = dailyScreeningOutputFilename(runDate);
        if (
          checkpoint &&
          checkpoint.correlationId === correlationId &&
          checkpoint.conversationUrl &&
          checkpoint.stage === "WORKBOOK_DOWNLOADED" &&
          checkpoint.validated === true &&
          isDailyScreeningOutputFilename(
            checkpoint.expectedFilename || "",
            expectedDailyForResume,
          ) &&
          fs.existsSync(outputPath) &&
          fs.statSync(outputPath).size > 0
        ) {
          log(logger, "CHATGPT_SCREENING_RESUME_WORKBOOK=true");
          closeState.submitted = true;
          closeState.downloaded = true;
          closeState.validated = true;
          return {
            screenedWorkbookPath: outputPath,
            conversationUrl: checkpoint.conversationUrl,
            decisionsPath,
          };
        }
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          log(logger, "CHATGPT_SCREENING_STALE_OUTPUT_IGNORED=true");
          try {
            fs.unlinkSync(outputPath);
          } catch {
            /* ignore */
          }
        }
        if (
          checkpoint &&
          checkpoint.correlationId === correlationId &&
          checkpoint.conversationUrl &&
          isConversationUrl(checkpoint.conversationUrl) &&
          fs.existsSync(decisionsPath)
        ) {
          const existingText = fs.readFileSync(decisionsPath, "utf8");
          const parsed = parseScreeningDecisionsJson(existingText);
          if (parsed.ok && parsed.decisions.length > 0) {
            log(logger, "CHATGPT_SCREENING_RESUME_DECISIONS=true");
            closeState.submitted = true;
            closeState.downloaded = true;
            closeState.validated = true;
            return {
              decisionsText: existingText,
              conversationUrl: checkpoint.conversationUrl,
              decisionsPath,
            };
          }
        }

        const opened = await openPersistentScreeningChat({
          page: session.page,
          config,
          logger,
        });
        const page = session.page;
        const expectedDailyFilename = dailyScreeningOutputFilename(runDate);
        const dailyArchivePath = path.join(
          path.dirname(outputPath),
          expectedDailyFilename,
        );
        log(logger, `CHATGPT_SCREENING_EXPECTED_OUTPUT=${expectedDailyFilename}`);

        // Step 1 — local copy from a prior successful run (skip ChatGPT entirely).
        if (isValidXlsxFile(dailyArchivePath)) {
          fs.copyFileSync(dailyArchivePath, outputPath);
          log(logger, `CHATGPT_SCREENING_REUSE_LOCAL_DAILY=${dailyArchivePath}`);
          closeState.submitted = true;
          closeState.downloaded = true;
          closeState.validated = true;
          saveScreeningChatCheckpoint(outputPath, {
            conversationUrl: opened.chatUrl,
            correlationId,
            expectedFilename: expectedDailyFilename,
            submittedAt: new Date().toISOString(),
            stage: "WORKBOOK_DOWNLOADED",
          });
          return {
            screenedWorkbookPath: outputPath,
            conversationUrl: opened.chatUrl,
            decisionsPath,
          };
        }

        // Step 2 — before upload/prompt: scroll chat for today's `{DD-MM-YY}_daily Tenders.xlsx`.
        log(logger, "CHATGPT_SCREENING_CHECK_CHAT_BEFORE_UPLOAD=true");
        const lookup = await findExistingDailyScreeningWorkbookInChat(page, {
          expectedFilename: expectedDailyFilename,
          runDate,
          logger,
        });
        if (lookup.status === "found") {
          log(logger, "CHATGPT_SCREENING_REUSE_EXISTING_CHAT_EXCEL=true");
          closeState.submitted = true;
          const downloaded = await downloadDailyWorkbookOnce({
            page,
            workbook: lookup.workbook,
            outputPath,
            expectedDailyFilename,
            logger,
            inputFileName,
            conversationUrl: page.url() || opened.chatUrl,
            correlationId,
            reason: "reuse_existing_chat",
          });
          closeState.downloaded = true;
          closeState.validated = true;
          saveScreeningChatCheckpoint(outputPath, {
            conversationUrl: page.url() || opened.chatUrl,
            correlationId,
            expectedFilename: expectedDailyFilename,
            submittedAt: new Date().toISOString(),
            stage: "WORKBOOK_DOWNLOADED",
          });
          return {
            screenedWorkbookPath: downloaded.outputPath,
            conversationUrl: page.url() || opened.chatUrl,
            decisionsPath,
          };
        }

        if (lookup.reason === "older_daily_found") {
          log(
            logger,
            `CHATGPT_SCREENING_GENERATE_NEW=true (older daily=${lookup.olderFilename || "unknown"} < runDate=${runDate})`,
          );
        } else {
          log(logger, "CHATGPT_SCREENING_GENERATE_NEW=true (today daily not in chat)");
        }

        // Step 3 — upload Tender247 Excel + screening.md, then send operator prompt.
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=COMPOSER_READY");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_FILE_UPLOADING");
        await uploadFilesToComposer({
          page,
          filePaths: uploadPaths,
          logger,
          expectedAttachmentCount: uploadPaths.length,
        });
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_XLSX_UPLOADED");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=INPUT_FILE_READY");
        await typeComposerPrompt(page, prompt, logger);
        log(logger, "[AI SCREENING] Prompt prepared");
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=PROMPT_ENTERED");
        await waitForRunExcelScreeningAttachmentReady(page, {
          expectedWorkbookName: inputFileName,
          composerToken: "run-screening",
          logger,
        });
        log(logger, "CHATGPT_SEND_ALLOWED=true");

        // Always Send after a fresh upload on the reused daily chat.
        // Older user bubbles for the same run date must not skip Send — that
        // closes/reconciles against a stale Excel before the new response lands.
        const sendResult = await sendComposerMessage(page, logger, {
          // Reuse the same shared chat every day — do not force a new conversation.
          requireNewConversation: false,
          submissionKind: "RUN_EXCEL_SCREENING",
          userMessagePattern: RUN_SCREENING_PROMPT_PATTERN,
          expectedT247Id: correlationId,
          minAttachmentCount: uploadPaths.length,
          confirmedAttachments: {
            requiredAttachmentsConfirmed: true,
            sourcePortal: "TENDER247",
            sourceTenderId: correlationId,
            fileNames: uploadPaths.map((p) => path.basename(p)),
            composerIdentity: "run-screening",
          },
        });
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
          "[AI SCREENING] Prompt sent to persistent Siyana screening chat",
        );
        log(logger, "CHATGPT_RUN_SCREENING_STAGE=MESSAGE_SUBMITTED");
        saveScreeningChatCheckpoint(outputPath, {
          conversationUrl: sendResult.chatUrl || page.url() || opened.chatUrl,
          correlationId,
          expectedFilename: expectedDailyFilename,
          submittedAt: new Date().toISOString(),
          stage: "MESSAGE_SUBMITTED",
        });
        log(logger, "[AI SCREENING] Waiting for ChatGPT screened Excel...");

        const timeoutMs = resolveRunScreeningResponseTimeoutMs();
        log(logger, `CHATGPT_RUN_SCREENING_RESPONSE_TIMEOUT_MS=${timeoutMs}`);

        // Step 4 — wait for today's daily Excel on the latest assistant turn, download once.
        const downloaded = await waitForReturnedWorkbook({
          page,
          outputPath,
          timeoutMs,
          logger,
          inputFileName,
          assistantCountBefore: sendResult.baseline.assistantCountBefore,
          userCountBefore: sendResult.baseline.userCountBefore,
          correlationId,
          expectedDailyFilename,
          runDate,
        });
        closeState.downloaded = true;
        closeState.validated = true;
        saveScreeningChatCheckpoint(outputPath, {
          conversationUrl: page.url() || opened.chatUrl,
          correlationId,
          expectedFilename: expectedDailyFilename,
          submittedAt: new Date().toISOString(),
          stage: "WORKBOOK_DOWNLOADED",
        });
        return {
          screenedWorkbookPath: downloaded.outputPath,
          conversationUrl: page.url() || opened.chatUrl,
          decisionsPath,
        };
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
