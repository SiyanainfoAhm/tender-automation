/**
 * Document download pipeline for Verify + May Bid tenders.
 *
 * After Phase-1 screening has upserted rows to Supabase, run this to:
 *   1. Select TENDER247 rows for --date (scraped_date) with
 *      qualification_status IN (VERIFY, CONDITIONAL_GO)
 *   2. Download AI Summary + documents ZIP from Tender247
 *   3. Upload artifacts to Azure blob via Edge Function
 *   4. Persist public URLs on agenttender_tenders
 *      (documents_zip_url, ai_summary_url)
 *
 * Usage:
 *   npm run pipeline:tender247:documents -- --date=2026-09-03
 *   npm run pipeline:tender247:documents -- --date=2026-09-03 --force
 *   npm run pipeline:tender247:documents -- --date=2026-09-03 --limit=5
 *   npm run pipeline:tender247:documents -- --date=2026-09-03 --dry-run
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import {
  getArgValue,
  hasBooleanFlag,
  resolveRequestedDate,
} from "../cli/requestedDate.js";
import {
  finishPipelineRun,
  markTender247AccountUsed,
  resolveTender247RunAccount,
  startPipelineRun,
  withTender247AccountContextAsync,
} from "../company/tender247Accounts.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import { ensureDir } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import { normalizePhase1CrawlStatus } from "../runScreening/phase1Statuses.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import { processSurvivorsInParallel } from "../tender247Batch/processSurvivorsInParallel.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { isTenderSafeToSkipReopen } from "../tender247Batch/tenderArtifactState.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { assertMailDateReadyForExcel } from "../tenderDetails/selectTender247MailDate.js";

const DOCUMENT_STATUSES = ["VERIFY", "CONDITIONAL_GO"] as const;

export type DocumentQueueRow = {
  id: string;
  sourceTenderId: string;
  qualificationStatus: string;
  title: string | null;
  documentsZipUrl: string | null;
  aiSummaryUrl: string | null;
};

export type DocumentPipelineSummary = {
  date: string;
  selected: number;
  skippedExistingUrls: number;
  attempted: number;
  fullSuccess: number;
  partialSuccess: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  /** @deprecated use fullSuccess — kept for older readers */
  completed: number;
  dryRun: boolean;
};

function rejectMistypedAccountFlags(argv: string[]): void {
  const mistyped = argv.find(
    (token) =>
      /^--accountid(=|$)/i.test(token) ||
      /^--tender247accountid(=|$)/i.test(token),
  );
  if (!mistyped) return;
  throw new AutomationError(
    "INVALID_ACCOUNT_FLAG",
    `Unrecognized account flag "${mistyped}". Use --account-id=2 (with hyphen), not --accountid=2.`,
  );
}

function parseArgs(argv: string[]): {
  date: string;
  accountId: string | null;
  companyId: string | null;
  force: boolean;
  dryRun: boolean;
  limit: number | null;
} {
  rejectMistypedAccountFlags(argv);
  const resolved = resolveRequestedDate(argv, { requireExplicit: true });
  const limitRaw = getArgValue(argv, "limit");
  const limit =
    limitRaw && Number.isFinite(Number(limitRaw))
      ? Math.max(0, Number.parseInt(limitRaw, 10))
      : null;
  return {
    date: resolved.requestedDate,
    accountId:
      getArgValue(argv, "account-id") ||
      getArgValue(argv, "tender247-account-id") ||
      process.env.TENDER247_ACCOUNT_ID?.trim() ||
      process.env.TENDER247_ACCOUNT?.trim() ||
      null,
    companyId:
      getArgValue(argv, "company-id") ||
      process.env.COMPANY_ID?.trim() ||
      process.env.SIYANA_COMPANY_ID?.trim() ||
      null,
    force: hasBooleanFlag(argv, "force"),
    dryRun:
      hasBooleanFlag(argv, "dry-run") || hasBooleanFlag(argv, "dry-run-date"),
    limit,
  };
}

export async function listVerifyMayBidTendersForDate(options: {
  scrapedDate: string;
  force?: boolean;
}): Promise<DocumentQueueRow[]> {
  if (!isSupabaseConfigured()) {
    throw new AutomationError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase is not configured — cannot build document queue",
    );
  }
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("agenttender_tenders")
    .select(
      "id, source_tender_id, qualification_status, title, documents_zip_url, ai_summary_url",
    )
    .eq("source_portal", "TENDER247")
    .eq("scraped_date", options.scrapedDate)
    .in("qualification_status", [...DOCUMENT_STATUSES])
    .order("source_tender_id", { ascending: true });

  if (error) {
    throw new AutomationError(
      "DOCUMENT_QUEUE_QUERY_FAILED",
      `Failed to load Verify/May Bid queue: ${error.message}`,
    );
  }

  const rows: DocumentQueueRow[] = [];
  for (const row of data || []) {
    const sourceTenderId = String(row.source_tender_id || "")
      .replace(/^T247-/i, "")
      .replace(/\D/g, "");
    if (!sourceTenderId) continue;
    const status = String(row.qualification_status || "").trim().toUpperCase();
    const crawl = normalizePhase1CrawlStatus(status);
    if (crawl !== "VERIFY" && crawl !== "MAY_BID") continue;

    const documentsZipUrl = row.documents_zip_url
      ? String(row.documents_zip_url)
      : null;
    const aiSummaryUrl = row.ai_summary_url
      ? String(row.ai_summary_url)
      : null;

    if (!options.force && documentsZipUrl) {
      continue;
    }

    rows.push({
      id: String(row.id),
      sourceTenderId,
      qualificationStatus: status,
      title: row.title ? String(row.title) : null,
      documentsZipUrl,
      aiSummaryUrl,
    });
  }
  return rows;
}

function writeQueueArtifact(
  dateFolder: string,
  payload: Record<string, unknown>,
): string {
  const dir = path.join(dateFolder, "screening");
  ensureDir(dir);
  const outPath = path.join(dir, "supabase-document-queue.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

export async function runVerifyMayBidDocumentPipeline(
  argv: string[] = process.argv.slice(2),
): Promise<DocumentPipelineSummary> {
  const args = parseArgs(argv);
  const config = loadConfig();
  const dateIso = args.date;

  const account = await resolveTender247RunAccount({
    companyId: args.companyId || resolveRunCompanyId(),
    accountId: args.accountId,
  });

  process.env.TENDER247_STORAGE_STATE_PATH = account.storageStatePath;
  process.env.COMPANY_ID = account.companyId;
  if (account.username) process.env.TENDER247_EMAIL = account.username;
  if (account.password) process.env.TENDER247_PASSWORD = account.password;

  const logger = new Logger(
    config.logRoot,
    "VerifyMayBidDocuments",
    account.logPrefix,
  );
  const runContext = createTender247RunContext(config.downloadRoot, dateIso, {
    accountId: account.accountId,
    seedExcelSubdir: account.seedExcelSubdir,
  });
  logTender247RunContext(runContext);

  logger.info(
    `DOCUMENT_PIPELINE_ACCOUNT_RESOLVED accountId=${account.accountId} label=${account.accountLabel || account.accountShort} companyId=${account.companyId} storageState=${account.storageStatePath}`,
  );
  console.log(
    `DOCUMENT_PIPELINE_ACCOUNT_RESOLVED accountId=${account.accountId} label=${account.accountLabel || account.accountShort} companyId=${account.companyId}`,
  );

  const dateFolder = runContext.downloadRoot;
  ensureTender247DateScopedDir(dateFolder, dateIso);

  const allCandidates = await listVerifyMayBidTendersForDate({
    scrapedDate: dateIso,
    force: true,
  });
  const pending = await listVerifyMayBidTendersForDate({
    scrapedDate: dateIso,
    force: args.force,
  });
  const skippedExistingUrls = Math.max(0, allCandidates.length - pending.length);
  let queue = pending;
  if (args.limit != null) {
    queue = queue.slice(0, args.limit);
  }

  const verifyCount = queue.filter(
    (r) => normalizePhase1CrawlStatus(r.qualificationStatus) === "VERIFY",
  ).length;
  const mayBidCount = queue.filter(
    (r) => normalizePhase1CrawlStatus(r.qualificationStatus) === "MAY_BID",
  ).length;

  const queuePath = writeQueueArtifact(dateFolder, {
    runDate: dateIso,
    source: "agenttender_tenders.qualification_status",
    statuses: DOCUMENT_STATUSES,
    force: args.force,
    dryRun: args.dryRun,
    totalMatching: allCandidates.length,
    skippedExistingUrls,
    queued: queue.length,
    verify: verifyCount,
    mayBid: mayBidCount,
    ids: queue.map((r) => r.sourceTenderId),
    rows: queue,
    updatedAt: new Date().toISOString(),
  });

  logger.info(`DOCUMENT_PIPELINE_DATE=${dateIso}`);
  logger.info(`DOCUMENT_PIPELINE_QUEUE_FILE=${queuePath}`);
  logger.info(
    `DOCUMENT_PIPELINE_SELECTED total=${allCandidates.length} queued=${queue.length} skippedUrls=${skippedExistingUrls} verify=${verifyCount} mayBid=${mayBidCount}`,
  );
  console.log(`DOCUMENT_PIPELINE_DATE=${dateIso}`);
  console.log(
    `DOCUMENT_PIPELINE_QUEUE verify=${verifyCount} mayBid=${mayBidCount} queued=${queue.length} skippedExistingUrls=${skippedExistingUrls}`,
  );

  const summary: DocumentPipelineSummary = {
    date: dateIso,
    selected: allCandidates.length,
    skippedExistingUrls,
    attempted: 0,
    fullSuccess: 0,
    partialSuccess: 0,
    skipped: skippedExistingUrls,
    failed: 0,
    failedIds: [],
    completed: 0,
    dryRun: args.dryRun,
  };

  if (args.dryRun) {
    console.log("DOCUMENT_PIPELINE_DRY_RUN=true");
    console.log(`DOCUMENT_PIPELINE_IDS=${queue.map((r) => r.sourceTenderId).join(",")}`);
    return summary;
  }

  if (queue.length === 0) {
    console.log("DOCUMENT_PIPELINE_EMPTY=true");
    return summary;
  }

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing Tender247 storage state. Run: npm run auth:tender247 -- --account-id=<uuid>",
    );
  }

  const pipelineRunId = await startPipelineRun({
    companyId: account.companyId,
    tender247AccountId: account.accountId,
    runDate: dateIso,
    mode: "document-pipeline",
    resume: !args.force,
  });
  await markTender247AccountUsed(account.accountId);

  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;
  try {
    await withTender247AccountContextAsync(account, async () => {
      await withTender247RunContextAsync(runContext, async () => {
        session = await launchBrowserSession({
          headless: config.headless,
          storageStatePath: authPath,
          downloadPath: path.join(dateFolder, "playwright-downloads"),
          pageTimeoutMs: config.pageTimeoutMs,
        });
        const listPage = session.page;
        const { context } = session;

        await loginToTender247(listPage, context, logger, config);
        await dismissTender247Interruptions(listPage, logger, config);

        const mailDate = await ensureTender247FreshListForDate(
          listPage,
          dateIso,
          logger,
          config.pageTimeoutMs,
        );
        assertMailDateReadyForExcel(mailDate, dateIso);
        if (mailDate.selectedMailDateIso !== dateIso) {
          throw new AutomationError(
            "TENDER247_DATE_FILTER_MISMATCH",
            `Document pipeline mail date mismatch requested=${dateIso} selected=${mailDate.selectedMailDateIso}`,
          );
        }

        const screeningStatusById = new Map<string, string>();
        const excelValueById = new Map<
          string,
          {
            parsedTenderValueInr: number | null;
            parsedEmdInr: number | null;
            title?: string;
            deadline?: string | null;
          }
        >();
        for (const row of queue) {
          const crawl =
            normalizePhase1CrawlStatus(row.qualificationStatus) || "VERIFY";
          screeningStatusById.set(row.sourceTenderId, crawl);
          excelValueById.set(row.sourceTenderId, {
            parsedTenderValueInr: null,
            parsedEmdInr: null,
            title: row.title || undefined,
            deadline: null,
          });
        }

        const alreadyCompleted = new Set<string>();
        // Document queue rows already lack documents_zip_url (unless --force).
        // Do not skip reopen solely on local folders when Azure URLs are still
        // missing — unless --force, let the downloader's resume/upload path run.
        // With --force, never skip so the underlying downloader reopens.
        if (!args.force) {
          for (const row of queue) {
            const tenderDir = path.join(dateFolder, `T247-${row.sourceTenderId}`);
            if (
              row.documentsZipUrl &&
              isTenderSafeToSkipReopen(tenderDir, row.sourceTenderId)
            ) {
              alreadyCompleted.add(row.sourceTenderId);
              logger.info(
                `DOCUMENT_PIPELINE_SKIP_REOPEN=${row.sourceTenderId} (local artifacts + DB URL ready)`,
              );
            }
          }
        } else {
          logger.info("DOCUMENT_PIPELINE_FORCE=true bypassing completion skips");
        }

        const survivorIds = queue.map((r) => r.sourceTenderId);
        console.log(`DOCUMENT_PIPELINE_CRAWL_START count=${survivorIds.length}`);
        logger.info(`DOCUMENT_PIPELINE_CRAWL_START count=${survivorIds.length}`);

        const parallel = await processSurvivorsInParallel({
          listPage,
          context,
          survivorIds,
          dateFolder,
          config,
          logger,
          alreadyCompleted,
          force: args.force,
          phase1ScreeningAuthoritative: true,
          screeningStatusById,
          excelValueById,
        });

        summary.attempted = parallel.attemptedIds.length;
        summary.failed = parallel.failedIds.length;
        summary.failedIds = [...parallel.failedIds];

        for (const result of parallel.results) {
          if (summary.failedIds.includes(result.t247Id)) continue;
          if (result.status === "completed" && result.artifactComplete) {
            summary.fullSuccess += 1;
          } else if (
            result.status === "completed" ||
            result.status === "partial" ||
            result.completeWithAiMissing
          ) {
            summary.partialSuccess += 1;
          }
        }

        summary.skipped += alreadyCompleted.size;
        for (const id of alreadyCompleted) {
          if (!summary.failedIds.includes(id)) {
            summary.fullSuccess += 1;
          }
        }
        summary.completed = summary.fullSuccess + summary.partialSuccess;

        await persistAuthState(context, config, logger);
      });
    });

    await finishPipelineRun({
      runId: pipelineRunId,
      status:
        summary.failed > 0 && summary.fullSuccess + summary.partialSuccess === 0
          ? "failed"
          : summary.failed > 0
            ? "completed_with_failures"
            : "success",
      summary: {
        accountId: account.accountId,
        requestedDate: dateIso,
        ...summary,
      },
    });
  } catch (error) {
    await finishPipelineRun({
      runId: pipelineRunId,
      status: "failed",
      summary: {
        accountId: account.accountId,
        error: safeErrorMessage(error),
      },
    });
    throw error;
  } finally {
    if (session) {
      await closeBrowserSession(session).catch(() => undefined);
    }
  }

  console.log("");
  console.log("==================================");
  console.log("Verify / May Bid Document Pipeline");
  console.log(`Date: ${summary.date}`);
  console.log(`Selected (DB): ${summary.selected}`);
  console.log(`Skipped (URL already set): ${summary.skippedExistingUrls}`);
  console.log(`Attempted: ${summary.attempted}`);
  console.log(`Full success: ${summary.fullSuccess}`);
  console.log(`Partial success: ${summary.partialSuccess}`);
  console.log(`Skipped (local+URL): ${summary.skipped - summary.skippedExistingUrls}`);
  console.log(`Failed: ${summary.failed}`);
  if (summary.failedIds.length) {
    console.log(`Failed IDs: ${summary.failedIds.join(", ")}`);
  }
  if (summary.failed > 0) {
    console.log("Batch finished with failures — not all tenders succeeded.");
  }
  console.log("==================================");

  fs.writeFileSync(
    path.join(dateFolder, "document-pipeline-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
  return summary;
}

async function main(): Promise<void> {
  try {
    await runVerifyMayBidDocumentPipeline();
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "DOCUMENT_PIPELINE_FAILED";
    const message = safeErrorMessage(error);
    console.error(`\n${code}\n${message}\n`);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void main();
}
