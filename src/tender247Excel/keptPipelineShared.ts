/**
 * Shared Tender247 sequential pipeline helpers (kept-pipeline + until-go).
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { assertPrescreenAllowsChatgpt } from "../prescreen/chatgptGate.js";
import { selectPassedForChatgpt } from "../prescreen/selectPassedForChatgpt.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
} from "../chatgptQualification/ensureChatGptLoggedIn.js";
import { openChatGptProject } from "../chatgptQualification/openProject.js";
import { qualifySingleTender } from "../chatgptQualification/processTenderQualification.js";
import { waitForSharedSubmissionInterval } from "../chatgptQualification/submissionThrottle.js";
import {
  getTenderMetadata,
  verifySourceTenderMetadataRow,
} from "../supabase/tenderMetadataStore.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { processLiveTender } from "../tender247Batch/processTender.js";
import type { KeptExcelCandidate } from "./parseKeptExcelRows.js";
import type { RelevanceScanRecord } from "./selectItRelevantCandidates.js";
import type { KeptPipelinePathResult } from "./writeKeptPipelineAudit.js";

export async function withPipelineTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function logRelevanceDecision(
  record: RelevanceScanRecord,
  logger: Logger,
): void {
  const id = record.candidate.sourceTenderId;
  console.log(`T247-${id}`);
  console.log(`DETAIL_RESOLVED=${record.detailResolved}`);
  console.log(`IT_RELEVANCE=${record.relevance}`);
  logger.info(`T247-${id}`);
  logger.info(`DETAIL_RESOLVED=${record.detailResolved}`);
  logger.info(`IT_RELEVANCE=${record.relevance}`);

  if (!record.detailResolved) {
    console.log(`TENDER247_DETAIL_RESOLVE_FAILED=${id}`);
    logger.info(`TENDER247_DETAIL_RESOLVE_FAILED=${id}`);
    console.log("SKIP");
    logger.info("SKIP");
    return;
  }

  if (record.relevance === "NON_IT") {
    console.log("DOCUMENT_DOWNLOAD_SKIPPED=true");
    console.log("SUPABASE_WRITE_SKIPPED=true");
    console.log("CHATGPT_SKIPPED=true");
    console.log("SKIP");
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    logger.info("SKIP");
    return;
  }

  if (record.relevance === "AMBIGUOUS") {
    console.log("MANUAL_REVIEW_REQUIRED=true");
    console.log("DOCUMENT_DOWNLOAD_SKIPPED=true");
    console.log("SUPABASE_WRITE_SKIPPED=true");
    console.log("CHATGPT_SKIPPED=true");
    console.log("SKIP");
    logger.info("MANUAL_REVIEW_REQUIRED=true");
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    logger.info("SKIP");
    return;
  }

  if (record.candidateOrdinal != null) {
    console.log(`IT_CANDIDATE=${record.candidateOrdinal}`);
    logger.info(`IT_CANDIDATE=${record.candidateOrdinal}`);
  }
}

export function createPipelinePathResult(
  record: RelevanceScanRecord,
): KeptPipelinePathResult {
  return {
    sourceTenderId: record.candidate.sourceTenderId,
    title: record.candidate.title,
    financialStatus: "KEEP",
    itRelevance: "IT_RELEVANT",
    itRelevanceReasonCode: record.reasonCode,
    documentsDownloaded: false,
    supabaseStored: false,
    prescreenStatus: null,
    chatgptSubmitted: false,
    chatgptCompleted: false,
    chatgptResult: null,
    error: null,
  };
}

export async function processKeptCandidateDownstream(options: {
  listPage: Page;
  context: BrowserContext;
  candidate: KeptExcelCandidate;
  index: number;
  total: number;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  pathResult: KeptPipelinePathResult;
}): Promise<{ supabaseExisting: boolean }> {
  const {
    listPage,
    context,
    candidate,
    index,
    total,
    dateFolder,
    config,
    logger,
    pathResult,
  } = options;

  const existingBefore = await getTenderMetadata(
    "TENDER247",
    candidate.sourceTenderId,
  );
  const supabaseExisting = existingBefore !== null;
  console.log(`SUPABASE_EXISTING_TENDER=${supabaseExisting}`);
  logger.info(`SUPABASE_EXISTING_TENDER=${supabaseExisting}`);

  await listPage.bringToFront().catch(() => undefined);
  await dismissTender247BlockingOverlays(listPage, logger, config).catch(
    () => undefined,
  );

  const processResult = await withPipelineTimeout(
    processLiveTender({
      listPage,
      context,
      t247Id: candidate.sourceTenderId,
      index,
      total,
      dateFolder,
      config,
      logger,
      titleHint: candidate.title,
      excelTenderValue: candidate.parsedTenderValueInr,
      excelEmd: candidate.parsedEmdInr,
      excelDeadline: candidate.deadline ?? null,
      openViaSingleTenderDirect: true,
    }),
    config.perTenderTimeoutMs,
    `PER_TENDER_TIMEOUT T247-${candidate.sourceTenderId}`,
  );

  if (
    processResult.status === "dropped_non_it" ||
    processResult.itRelevance === "NON_IT"
  ) {
    pathResult.itRelevance = "NON_IT";
    pathResult.error = "IT gate rejected during process (unexpected)";
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    return { supabaseExisting };
  }
  if (
    processResult.status === "ambiguous_manual_review" ||
    processResult.itRelevance === "AMBIGUOUS"
  ) {
    pathResult.itRelevance = "AMBIGUOUS";
    pathResult.error = "IT gate ambiguous during process (unexpected)";
    logger.info("CHATGPT_SKIPPED=true");
    return { supabaseExisting };
  }

  pathResult.documentsDownloaded = Boolean(processResult.allDocumentsDownloaded);
  if (processResult.error) {
    pathResult.error = processResult.error;
  }

  if (!processResult.allDocumentsDownloaded) {
    pathResult.error =
      pathResult.error ||
      "Required Tender_All_Documents.zip missing/corrupt — ChatGPT blocked";
    logger.warn(`PIPELINE_DOCS_MISSING=T247-${candidate.sourceTenderId}`);
    return { supabaseExisting };
  }

  const archivePath = processResult.allDocumentsPath;
  if (archivePath) {
    console.log(`TENDER247_DOCUMENT_ARCHIVE_DOWNLOADED=${archivePath}`);
    logger.info(`TENDER247_DOCUMENT_ARCHIVE_DOWNLOADED=${archivePath}`);
  }

  const verified = await verifySourceTenderMetadataRow(
    "TENDER247",
    candidate.sourceTenderId,
  );
  if (!verified.ok) {
    pathResult.error =
      pathResult.error ||
      `Supabase verify failed: ${verified.error ?? "unknown"}`;
    return { supabaseExisting };
  }

  pathResult.supabaseStored = true;
  logger.info(
    `SUPABASE_TENDER_UPSERTED=${verified.id ?? candidate.sourceTenderId}`,
  );
  logger.info(
    `SUPABASE_TENDER_VERIFIED=${verified.id ?? `T247-${candidate.sourceTenderId}`}`,
  );
  console.log(`SUPABASE_TENDER_UPSERTED=${verified.id ?? candidate.sourceTenderId}`);
  console.log(
    `SUPABASE_TENDER_VERIFIED=${verified.id ?? `T247-${candidate.sourceTenderId}`}`,
  );

  console.log(`PRESCREEN_START=${candidate.sourceTenderId}`);
  logger.info(`PRESCREEN_START=${candidate.sourceTenderId}`);
  const gate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderId: candidate.sourceTenderId,
    logger,
  });
  pathResult.prescreenStatus = gate.status;
  console.log(`PRESCREEN_STATUS=${gate.status}`);
  logger.info(`PRESCREEN_STATUS=${gate.status}`);
  if (!gate.allowed) {
    logger.info(
      `CHATGPT_SKIPPED=true PRESCREEN=${gate.status} REASON=${gate.reasonCode}`,
    );
  }

  return { supabaseExisting };
}

export type ChatgptPipelineRunResult = {
  qualStatus: string | null;
  chatUrl: string | null;
  reprocessed: boolean;
};

export async function runChatgptForPipelineCandidate(options: {
  sourceTenderId: string;
  pathResult: KeptPipelinePathResult;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  gptSession: Awaited<ReturnType<typeof launchChatGptPersistentSession>>;
  forceReprocess?: boolean;
}): Promise<ChatgptPipelineRunResult> {
  const {
    sourceTenderId,
    pathResult,
    dateFolder,
    config,
    logger,
    gptSession,
    forceReprocess = false,
  } = options;

  const selection = await selectPassedForChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderIds: [sourceTenderId],
    logger,
  });

  if (selection.passedIds.length === 0) {
    const skip = selection.skipped[0];
    if (skip) {
      pathResult.prescreenStatus = skip.status;
    }
    return { qualStatus: null, chatUrl: null, reprocessed: false };
  }

  pathResult.prescreenStatus = "PASSED";

  await waitForSharedSubmissionInterval({
    minIntervalMs: config.chatgptMinSubmissionIntervalMs,
    logger,
  });

  if (forceReprocess) {
    console.log("QUALIFICATION_REPROCESSED=true");
    logger.info("QUALIFICATION_REPROCESSED=true");
  }

  console.log(`CHATGPT_QUALIFICATION_START=${sourceTenderId}`);
  logger.info(`CHATGPT_QUALIFICATION_START=${sourceTenderId}`);
  console.log(`TENDER_PROCESS_START=${sourceTenderId}`);
  logger.info(`TENDER_PROCESS_START=${sourceTenderId}`);

  const outcome = await qualifySingleTender({
    page: gptSession.page,
    dateFolder,
    t247Id: sourceTenderId,
    config,
    logger,
    forceReprocess,
    manifestTotals: {
      expectedTender247: 1,
      readyForChatGpt: 1,
      selected: 1,
    },
  });

  if (outcome.submittedAt) {
    pathResult.chatgptSubmitted = true;
    console.log("CHATGPT_PROMPT_SUBMITTED");
    logger.info("CHATGPT_PROMPT_SUBMITTED");
  }

  if (outcome.status === "completed") {
    pathResult.chatgptCompleted = true;
    console.log("CHATGPT_RESPONSE_COMPLETE");
    logger.info("CHATGPT_RESPONSE_COMPLETE");
  }

  if (outcome.qualification?.status) {
    pathResult.chatgptResult = String(outcome.qualification.status);
    console.log(`CHATGPT_RESULT=${pathResult.chatgptResult}`);
    logger.info(`CHATGPT_RESULT=${pathResult.chatgptResult}`);
    console.log(`CHATGPT_STATUS=${pathResult.chatgptResult}`);
    logger.info(`CHATGPT_STATUS=${pathResult.chatgptResult}`);
  }
  if (outcome.error && !pathResult.error) {
    pathResult.error = outcome.error;
  }

  console.log(`TENDER_PROCESS_COMPLETE=${sourceTenderId}`);
  logger.info(`TENDER_PROCESS_COMPLETE=${sourceTenderId}`);

  return {
    qualStatus: pathResult.chatgptResult,
    chatUrl: outcome.chatUrl,
    reprocessed: forceReprocess && pathResult.chatgptSubmitted,
  };
}

export async function ensureChatGptSession(options: {
  gptSession: Awaited<ReturnType<typeof launchChatGptPersistentSession>> | null;
  config: AppConfig;
  logger: Logger;
}): Promise<Awaited<ReturnType<typeof launchChatGptPersistentSession>>> {
  if (options.gptSession) {
    return options.gptSession;
  }
  const gptSession = await launchChatGptPersistentSession({
    config: options.config,
    logger: options.logger,
  });
  await ensureChatGptLoggedIn({
    page: gptSession.page,
    context: gptSession.context,
    config: options.config,
    logger: options.logger,
  });
  await openChatGptProject({
    page: gptSession.page,
    projectName: options.config.chatgptProjectName,
    projectUrl: options.config.chatgptProjectUrl,
    projectMatch: options.config.chatgptProjectMatch,
    config: options.config,
    logger: options.logger,
  });
  return gptSession;
}

export { closeChatGptSession };
