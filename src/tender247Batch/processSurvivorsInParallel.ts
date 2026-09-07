/**
 * Sequential Tender247 selected-tender artifact acquisition.
 * Concurrency is always 1 — one detail page, one tender transaction, then next.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  dismissTender247AdvanceSearchModal,
  dismissTender247Interruptions,
} from "../tenderDetails/dismissTender247Interruptions.js";
import { ensureTender247FreshListForDate } from "./ensureTender247FreshListForDate.js";
import { getActiveTender247RunContext } from "./tender247RunContext.js";
import {
  assertSingleTender247DetailPage,
  closeExtraTender247DetailPages,
} from "./assertSingleTender247DetailPage.js";
import { loadTender247ConcurrencyConfig } from "./tender247ConcurrencyConfig.js";
import {
  processTender247ArtifactTransaction,
} from "./processTender.js";
import { runSequentialArtifactAcquisition } from "./runSequentialArtifactAcquisition.js";
import type { ProcessTenderResult } from "./types.js";

/** Soft-recover list UI so a failed tender does not poison the next one. */
async function recoverListPageBetweenTenders(
  listPage: Page,
  config: AppConfig,
  logger: Logger,
  dateFolder: string,
): Promise<void> {
  if (listPage.isClosed()) {
    return;
  }
  try {
    await listPage.bringToFront().catch(() => undefined);
    await dismissTender247Interruptions(listPage, logger, config).catch(
      () => undefined,
    );
    await dismissTender247AdvanceSearchModal(listPage, logger).catch(
      () => undefined,
    );

    const requestedDate =
      getActiveTender247RunContext()?.requestedDate ??
      (dateFolder.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null);
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return;
    }

    // Soft attempt only — never abort the batch here.
    await ensureTender247FreshListForDate(
      listPage,
      requestedDate,
      logger,
      config.pageTimeoutMs,
    ).catch(async (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        `T247_LIST_RECOVER_MAIL_DATE_SOFT_FAIL=${msg.slice(0, 160)}`,
      );
      const dashboardUrl =
        config.tender247Url?.trim() || "https://www.tender247.com/auth/tender";
      logger.warn(`TENDER247_UI_HARD_RESET reason=between-tenders url=${dashboardUrl}`);
      await listPage
        .goto(dashboardUrl, {
          waitUntil: "domcontentloaded",
          timeout: config.pageTimeoutMs,
        })
        .catch(() => undefined);
      await listPage.waitForTimeout(600);
      await dismissTender247Interruptions(listPage, logger, config).catch(
        () => undefined,
      );
      await dismissTender247AdvanceSearchModal(listPage, logger).catch(
        () => undefined,
      );
      await ensureTender247FreshListForDate(
        listPage,
        requestedDate,
        logger,
        config.pageTimeoutMs,
        { forceCalendarClick: true },
      ).catch((retryError) => {
        const retryMsg =
          retryError instanceof Error
            ? retryError.message
            : String(retryError);
        logger.warn(
          `T247_LIST_RECOVER_STILL_BROKEN=${retryMsg.slice(0, 160)} (continuing to next tender)`,
        );
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`T247_LIST_RECOVER_SOFT_FAIL=${msg.slice(0, 160)}`);
  }
}

export async function withListPageLock<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export async function processSurvivorsInParallel(options: {
  listPage: Page;
  context: BrowserContext;
  survivorIds: string[];
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  excelValueById: Map<
    string,
    {
      parsedTenderValueInr: number | null;
      parsedEmdInr: number | null;
      title?: string;
      deadline?: string | null;
    }
  >;
  alreadyCompleted: Set<string>;
  shouldStop?: () => boolean;
  concurrency?: number;
  phase1ScreeningAuthoritative?: boolean;
  /** Per-tender Phase-1 status override (Supabase Verify/May Bid document queue). */
  screeningStatusById?: Map<string, string>;
  /** Bypass local ALREADY_COMPLETED_SKIP in the underlying downloader. */
  force?: boolean;
  /** Download documents only when AI Summary is missing. */
  documentsOnlyIfAiMissing?: boolean;
  /**
   * AI-summary-first: allow opening NO_GO / No Bid tenders so every row
   * can still receive an AI Summary download.
   */
  allowNoBidDetailOpen?: boolean;
}): Promise<{
  results: ProcessTenderResult[];
  attemptedIds: string[];
  failedIds: string[];
  processedIds: string[];
}> {
  const concurrencyCfg = loadTender247ConcurrencyConfig();
  const pending = options.survivorIds.filter(
    (id) => !options.alreadyCompleted.has(id),
  );

  options.logger.info("T247_PHASE=ARTIFACT_ACQUISITION");
  options.logger.info(
    `TENDER247_DETAIL_CONCURRENCY=${concurrencyCfg.detailConcurrency}`,
  );
  options.logger.info(
    `TENDER247_DOWNLOAD_CONCURRENCY=${concurrencyCfg.downloadConcurrency}`,
  );
  options.logger.info(
    `TENDER247_ARTIFACT_CONCURRENCY=${concurrencyCfg.artifactConcurrency}`,
  );
  console.log(
    `TENDER247_DETAIL_SEQUENTIAL pending=${pending.length} concurrency=1`,
  );
  if ((options.concurrency ?? 1) > 1) {
    options.logger.warn(
      "T247_ARTIFACT_CONCURRENCY_FORCED=1 (ignoring requested >1)",
    );
  }

  const attemptedIds: string[] = [];
  const failedIds: string[] = [];
  const processedIds: string[] = [];
  const results: ProcessTenderResult[] = [];

  await runSequentialArtifactAcquisition({
    candidates: pending,
    getId: (id) => id,
    logger: options.logger,
    process: async (t247Id, index, total) => {
      if (options.shouldStop?.()) {
        return { evidenceMode: "NONE", dropped: true, safeToAdvance: true };
      }
      attemptedIds.push(t247Id);
      await closeExtraTender247DetailPages(options.context, options.listPage);
      assertSingleTender247DetailPage(
        options.context,
        options.listPage,
        options.logger,
      );

      const excel = options.excelValueById.get(t247Id);
      const result = await processTender247ArtifactTransaction({
        listPage: options.listPage,
        context: options.context,
        t247Id,
        index,
        total,
        dateFolder: options.dateFolder,
        config: options.config,
        logger: options.logger,
        titleHint: excel?.title ?? null,
        excelTenderValue: excel?.parsedTenderValueInr ?? null,
        excelEmd: excel?.parsedEmdInr ?? null,
        excelDeadline: excel?.deadline ?? null,
        openViaSingleTenderDirect: true,
        force: options.force === true,
        documentsOnlyIfAiMissing: options.documentsOnlyIfAiMissing === true,
        allowNoBidDetailOpen: options.allowNoBidDetailOpen === true,
        phase1ScreeningAuthoritative: options.phase1ScreeningAuthoritative,
        phase1ScreeningStatusOverride:
          options.screeningStatusById?.get(t247Id) ?? null,
      });
      results.push(result);

      await closeExtraTender247DetailPages(options.context, options.listPage);
      assertSingleTender247DetailPage(
        options.context,
        options.listPage,
        options.logger,
      );
      // Failed expand / accidental Advance Search must not block the next ID.
      await recoverListPageBetweenTenders(
        options.listPage,
        options.config,
        options.logger,
        options.dateFolder,
      );

      if (
        result.status === "dropped_non_it" ||
        result.status === "ambiguous_manual_review" ||
        result.status === "skipped_no_bid"
      ) {
        return {
          evidenceMode: "NONE",
          metadataOk: false,
          aiOk: false,
          documentsOk: false,
          dropped: true,
          safeToAdvance: true,
        };
      }
      if (result.status === "completed") {
        processedIds.push(result.t247Id);
      } else if (result.status === "pending") {
        processedIds.push(result.t247Id);
      } else if (result.status === "partial") {
        processedIds.push(result.t247Id);
      } else {
        failedIds.push(result.t247Id);
      }
      const complete = result.status === "completed" && result.artifactComplete === true;
      const pendingTimeout = result.status === "pending";
      const failed = result.status === "failed";
      const partial = result.status === "partial";
      return {
        evidenceMode: complete
          ? "FULL"
          : result.completeWithAiMissing || pendingTimeout || partial
            ? "PARTIAL"
            : "NONE",
        metadataOk: result.metadataStatus === "complete",
        aiOk: result.aiSummaryStatus === "complete",
        documentsOk:
          result.allDocumentsStatus === "complete" ||
          result.allDocumentsStatus === "partial",
        complete,
        pendingTimeout,
        dropped: failed,
        safeToAdvance:
          complete ||
          pendingTimeout ||
          failed ||
          partial ||
          result.status === "completed" ||
          result.completeWithAiMissing === true,
      };
    },
  });

  for (const id of pending) {
    if (!results.some((r) => r.t247Id === id) && !failedIds.includes(id)) {
      if (options.shouldStop?.()) break;
      failedIds.push(id);
      results.push({
        t247Id: id,
        status: "failed",
        zipPath: null,
        zipSize: 0,
        documentsDownloaded: 0,
        corrigendaDownloaded: 0,
        aiSummaryDownloaded: false,
        allDocumentsDownloaded: false,
        securityCodeCaptured: false,
        metadataStatus: "missing",
        aiSummaryStatus: "missing",
        allDocumentsStatus: "missing",
        metadataPath: null,
        aiSummaryPath: null,
        allDocumentsPath: null,
        lastCompletedStep: null,
        error: "not processed",
        failedDocuments: [],
      });
    }
  }

  return { results, attemptedIds, failedIds, processedIds };
}

/** @deprecated Use sequential processSurvivorsInParallel (concurrency forced to 1). */
export const processSelectedTendersSequentially = processSurvivorsInParallel;
