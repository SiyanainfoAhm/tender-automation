/**
 * Tender247 daily batch — live list processing:
 * Open Today's Fresh list → process each visible card fully (detail tab →
 * docs → ZIP) → scroll for more → until Fresh(N) reached.
 *
 * Does NOT collect all IDs first. security_code is captured from real
 * detail navigation/network only — never invented.
 *
 * No Supabase / AI scoring / BidAssist / Tender App integration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import { getTodayIsoDate } from "../dateUtils.js";
import { downloadDirForToday, ensureDir } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  formatProductionLimit,
  resolveProductionLimit,
} from "../productionLimit.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import {
  createEmptyManifest,
  isSkippableCompleted,
  loadManifest,
  saveManifest,
  upsertTenderEntry,
} from "./batchManifest.js";
import { createDailyMasterZip, cleanOrphanUuidFilesInDayFolder, cleanPlaywrightDownloadTemp, playwrightDownloadsDir } from "./createTenderZip.js";
import {
  findVisibleLiveTenderCards,
  readFreshExpectedCount,
  waitForFreshTenderList,
} from "./liveListCards.js";
import { processLiveTender } from "./processTender.js";
import type { ProcessTenderResult } from "./types.js";

// HARD GUARD: runDailyBatch must NEVER import or call ensureTodayTendersSelected.
// Calling it stalls on dashboard card diagnostics. Throw BUG_BATCH_CALLED_ENSURE_TODAY
// if that regression is reintroduced.

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(errorCode));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function acquireLock(lockFilePath: string): void {
  try {
    const fd = fs.openSync(lockFilePath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    fs.closeSync(fd);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "EEXIST") {
      throw new AutomationError(
        "DUPLICATE_EXECUTION",
        `Another crawl/batch is already running (lock: ${lockFilePath})`,
      );
    }
    throw error;
  }
}

function releaseLock(lockFilePath: string): void {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // ignore
  }
}

async function runDailyBatch(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247Batch");
  const dateIso = getTodayIsoDate();
  const dateFolder = downloadDirForToday(config.downloadRoot);
  ensureDir(dateFolder);

  if (config.tenderBatchConcurrency !== 1) {
    logger.warn(
      `TENDER_BATCH_CONCURRENCY=${config.tenderBatchConcurrency} overridden to 1`,
    );
  }

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  const manifestPath = path.join(dateFolder, "crawl-manifest.json");
  acquireLock(config.crawlLockFilePath);
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;

  try {
    logger.info("=== Tender247 daily batch started (live-list) ===");
    logger.info(`DATE=${dateIso}`);
    logger.info(`TENDER247_LIMIT=${formatProductionLimit(config.maxTenders)}`);
    logger.info(
      `MAX_TENDERS=${formatProductionLimit(config.maxTenders)}`,
    );
    logger.info(`TENDER_DELAY_MS=${config.tenderDelayMs}`);
    logger.info(`PER_TENDER_TIMEOUT_MS=${config.perTenderTimeoutMs}`);
    logger.info(
      `KEEP_UNZIPPED_TENDER_FOLDERS=${config.keepUnzippedTenderFolders}`,
    );

    const playwrightTemp = playwrightDownloadsDir(dateFolder);
    ensureDir(playwrightTemp);
    cleanOrphanUuidFilesInDayFolder(dateFolder, logger);

    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: authPath,
      downloadPath: playwrightTemp,
      pageTimeoutMs: config.pageTimeoutMs,
    });
    logger.info(`PLAYWRIGHT_DOWNLOADS_PATH=${playwrightTemp}`);

    const listPage = session.page;
    const { context } = session;

    // Auth only — do NOT call ensureTodayTendersSelected (stalls on dashboard cards).
    // Dashboard already loads Today's Fresh list after TENDER247_DASHBOARD_AUTHENTICATED.
    await loginToTender247(listPage, context, logger, config);
    await dismissTender247BlockingOverlays(listPage, logger, config);
    await dismissTender247SupportChat(listPage, logger);
    await waitForFreshTenderList(listPage, logger);

    const expectedCount = await readFreshExpectedCount(listPage, logger);
    logger.info(`EXPECTED_TODAY_COUNT=${expectedCount}`);

    let manifest =
      loadManifest(manifestPath) ??
      createEmptyManifest(dateIso, expectedCount, 0);
    manifest.expectedCount = expectedCount;
    saveManifest(manifestPath, manifest);

    const processedIds = new Set<string>();
    const attemptedIds = new Set<string>();
    const failedIds = new Set<string>();
    const createdZips: string[] = [];

    // Seed from existing non-empty ZIPs on disk (resume-safe; no duplicates)
    for (const name of fs.readdirSync(dateFolder)) {
      const match = name.match(/^T247-(\d+)\.zip$/i);
      if (!match) {
        continue;
      }
      const zipPath = path.join(dateFolder, name);
      if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
        continue;
      }
      const id = match[1]!;
      processedIds.add(id);
      createdZips.push(zipPath);
      if (!manifest.tenders[id] || manifest.tenders[id]!.status !== "completed") {
        upsertTenderEntry(manifest, id, {
          status: "completed",
          zipPath,
          zipSize: fs.statSync(zipPath).size,
          documentsDownloaded: manifest.tenders[id]?.documentsDownloaded ?? 0,
          corrigendaDownloaded: manifest.tenders[id]?.corrigendaDownloaded ?? 0,
          aiSummaryDownloaded: manifest.tenders[id]?.aiSummaryDownloaded,
          allDocumentsDownloaded: manifest.tenders[id]?.allDocumentsDownloaded,
          securityCodeCaptured: manifest.tenders[id]?.securityCodeCaptured,
          error: null,
          updatedAt: new Date().toISOString(),
        });
      }
      logger.info(`TENDER247_ALREADY_COMPLETED_SKIP=T247-${id}`);
    }
    saveManifest(manifestPath, manifest);

    const maxTenders = resolveProductionLimit(config.maxTenders);
    let emptyScrolls = 0;
    let lastKnownVisibleIds = new Set<string>();
    let batchIncomplete = false;

    while (true) {
      if (maxTenders < Infinity && attemptedIds.size >= maxTenders) {
        logger.info("MAX_TENDERS_REACHED");
        break;
      }
      if (expectedCount > 0 && processedIds.size + failedIds.size >= expectedCount) {
        break;
      }

      // Re-query currently rendered cards (never reuse stale locators)
      await listPage.bringToFront().catch(() => undefined);
      await dismissTender247BlockingOverlays(listPage, logger, config).catch(
        () => undefined,
      );
      await dismissTender247SupportChat(listPage, logger).catch(() => undefined);

      const cards = await findVisibleLiveTenderCards(listPage, logger);
      for (const c of cards) {
        lastKnownVisibleIds.add(c.t247Id);
      }

      const nextCard = cards.find(
        (c) => !processedIds.has(c.t247Id) && !attemptedIds.has(c.t247Id),
      );

      if (nextCard) {
        emptyScrolls = 0;
        const t247Id = nextCard.t247Id;
        const zipPath = path.join(dateFolder, `T247-${t247Id}.zip`);
        const existing = manifest.tenders[t247Id];

        if (isSkippableCompleted(existing, zipPath)) {
          processedIds.add(t247Id);
          logger.info(`TENDER247_ALREADY_COMPLETED_SKIP=T247-${t247Id}`);
          continue;
        }

        // Mark attempted immediately so we never reopen the same tender this run
        attemptedIds.add(t247Id);

        const index = attemptedIds.size;
        const total =
          maxTenders < Infinity
            ? maxTenders
            : expectedCount || processedIds.size + failedIds.size + 1;

        upsertTenderEntry(manifest, t247Id, {
          status: "processing",
          zipPath: null,
          zipSize: 0,
          documentsDownloaded: 0,
          corrigendaDownloaded: 0,
          aiSummaryDownloaded: false,
          allDocumentsDownloaded: false,
          securityCodeCaptured: Boolean(nextCard.securityCodeFromHref),
          metadataStatus: "missing",
          aiSummaryStatus: "missing",
          allDocumentsStatus: "missing",
          metadataPath: null,
          aiSummaryPath: null,
          allDocumentsPath: null,
          lastCompletedStep: null,
          error: null,
          updatedAt: new Date().toISOString(),
        });
        saveManifest(manifestPath, manifest);

        // Canonical processor owns: open detail → metadata → downloads → close → ZIP
        let result: ProcessTenderResult;
        try {
          result = await withTimeout(
            processLiveTender({
              listPage,
              context,
              t247Id,
              index,
              total,
              dateFolder,
              config,
              logger,
              titleHint: nextCard.titleHint,
            }),
            config.perTenderTimeoutMs,
            `PER_TENDER_TIMEOUT T247-${t247Id}`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`[${index}/${total}] FAILED T247-${t247Id}: ${message}`);
          await listPage.bringToFront().catch(() => undefined);
          for (const p of context.pages()) {
            if (p !== listPage && !p.isClosed()) {
              await p.close({ runBeforeUnload: false }).catch(() => undefined);
            }
          }
          result = {
            t247Id,
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
            error: message,
            failedDocuments: [],
          };
          logger.info(`[${index}/${total}] COMPLETE status=failed`);
        }

        const zipOk = Boolean(
          result.zipPath &&
            fs.existsSync(result.zipPath) &&
            fs.statSync(result.zipPath).size > 0,
        );

        if (zipOk && (result.status === "completed" || result.status === "partial")) {
          processedIds.add(t247Id);
        } else {
          failedIds.add(t247Id);
        }

        upsertTenderEntry(manifest, t247Id, {
          status: result.status,
          zipPath: result.zipPath,
          zipSize: result.zipSize ?? (zipOk && result.zipPath ? fs.statSync(result.zipPath).size : 0),
          documentsDownloaded: result.documentsDownloaded,
          corrigendaDownloaded: result.corrigendaDownloaded,
          aiSummaryDownloaded: Boolean(result.aiSummaryDownloaded),
          allDocumentsDownloaded: Boolean(result.allDocumentsDownloaded),
          securityCodeCaptured: Boolean(result.securityCodeCaptured),
          metadataStatus: result.metadataStatus,
          aiSummaryStatus: result.aiSummaryStatus,
          allDocumentsStatus: result.allDocumentsStatus,
          metadataPath: result.metadataPath,
          aiSummaryPath: result.aiSummaryPath,
          allDocumentsPath: result.allDocumentsPath,
          lastCompletedStep: result.lastCompletedStep,
          error: result.error,
          failedDocuments: result.failedDocuments,
          updatedAt: new Date().toISOString(),
        });
        saveManifest(manifestPath, manifest);

        if (result.zipPath && fs.existsSync(result.zipPath)) {
          createdZips.push(result.zipPath);
        }

        cleanPlaywrightDownloadTemp(dateFolder, logger);
        cleanOrphanUuidFilesInDayFolder(dateFolder, logger);

        manifest.discoveredCount = Math.max(
          manifest.discoveredCount,
          lastKnownVisibleIds.size,
          processedIds.size + failedIds.size,
        );
        saveManifest(manifestPath, manifest);

        if (config.tenderDelayMs > 0) {
          await listPage.waitForTimeout(config.tenderDelayMs);
        }
        continue;
      }

      // No unprocessed visible cards — scroll for more
      if (expectedCount > 0 && processedIds.size + failedIds.size >= expectedCount) {
        break;
      }
      if (maxTenders < Infinity && attemptedIds.size >= maxTenders) {
        break;
      }

      logger.info("VISIBLE_TENDERS_EXHAUSTED");
      logger.info("SCROLLING_FOR_MORE");

      const beforeIds = new Set(lastKnownVisibleIds);
      await listPage.mouse.wheel(0, Math.max(700, 900));
      await listPage.waitForTimeout(900);
      await dismissTender247SupportChat(listPage, logger).catch(() => undefined);

      const afterCards = await findVisibleLiveTenderCards(listPage, logger);
      let added = 0;
      for (const c of afterCards) {
        if (!beforeIds.has(c.t247Id)) {
          added += 1;
        }
        lastKnownVisibleIds.add(c.t247Id);
      }

      const newUnprocessed = afterCards.filter(
        (c) => !processedIds.has(c.t247Id) && !attemptedIds.has(c.t247Id),
      ).length;

      if (newUnprocessed > 0 || added > 0) {
        logger.info("NEW_TENDERS_LOADED");
        emptyScrolls = 0;
      } else {
        emptyScrolls += 1;
        logger.info(
          `TENDER247_SCROLL_NO_NEW_IDS attempt=${emptyScrolls}/5 processed=${processedIds.size}`,
        );
      }

      if (emptyScrolls >= 5) {
        if (expectedCount > 0 && processedIds.size + failedIds.size < expectedCount) {
          batchIncomplete = true;
          logger.error("TENDER247_BATCH_INCOMPLETE");
          logger.error(
            `Missing count: expected=${expectedCount} processed=${processedIds.size} failed=${failedIds.size} missing=${expectedCount - processedIds.size - failedIds.size}`,
          );
        }
        break;
      }

      if (expectedCount === 0 && attemptedIds.size > 0 && emptyScrolls >= 2) {
        break;
      }
    }

    if (config.createDailyMasterZip) {
      await createDailyMasterZip({
        dateFolder,
        dateIso,
        zipPaths: createdZips,
        logger,
      });
    }

    await persistAuthState(context, config, logger);

    const finalManifest = loadManifest(manifestPath) ?? manifest;
    finalManifest.discoveredCount = Math.max(
      finalManifest.discoveredCount,
      lastKnownVisibleIds.size,
      processedIds.size,
    );
    saveManifest(manifestPath, finalManifest);

    const zipCount = createdZips.filter(
      (p) => fs.existsSync(p) && fs.statSync(p).size > 0,
    ).length;

    console.log("");
    console.log("==================================");
    console.log("Tender247 Daily Batch Complete");
    console.log(`Expected: ${finalManifest.expectedCount}`);
    console.log(`Processed: ${processedIds.size}`);
    console.log(`Completed: ${finalManifest.successCount}`);
    console.log(`Partial: ${finalManifest.partialCount}`);
    console.log(`Failed: ${finalManifest.failedCount}`);
    console.log(`ZIP files created: ${zipPathCount(createdZips)}`);
    console.log("==================================");
    if (batchIncomplete) {
      console.log("");
      console.log("TENDER247_BATCH_INCOMPLETE");
      console.log(
        `Missing: ${Math.max(0, finalManifest.expectedCount - processedIds.size - failedIds.size)}`,
      );
      console.log("");
    }

    logger.info(
      `BATCH_SUMMARY expected=${finalManifest.expectedCount} processed=${processedIds.size} failedIds=${failedIds.size} completed=${finalManifest.successCount} partial=${finalManifest.partialCount} failed=${finalManifest.failedCount} zipCount=${zipCount} incomplete=${batchIncomplete}`,
    );

    if (
      finalManifest.failedCount > 0 &&
      finalManifest.successCount === 0 &&
      finalManifest.partialCount === 0
    ) {
      process.exitCode = 1;
    }
    if (batchIncomplete) {
      process.exitCode = 1;
    }
  } finally {
    cleanPlaywrightDownloadTemp(dateFolder, logger);
    cleanOrphanUuidFilesInDayFolder(dateFolder, logger);
    await closeBrowserSession(session);
    releaseLock(config.crawlLockFilePath);
    logger.info("Batch browser closed; lock released");
  }
}

function zipPathCount(paths: string[]): number {
  return paths.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 0).length;
}

async function main(): Promise<void> {
  const logger = new Logger(loadConfig().logRoot, "Tender247Batch");
  try {
    await runDailyBatch();
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "UNEXPECTED_ERROR";
    const message = safeErrorMessage(error);
    logger.error(`[${code}] ${message}`);
    console.error(`\n${code}\n${message}\n`);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void main();
}
