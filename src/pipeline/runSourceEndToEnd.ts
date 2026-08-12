/**
 * Source end-to-end orchestrator: crawl → Supabase metadata → ChatGPT → qualification row.
 * Crawler and ChatGPT never run in parallel.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { Logger } from "../logger.js";
import { resolveRequestedDate } from "../cli/requestedDate.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
} from "../chatgptQualification/ensureChatGptLoggedIn.js";
import { qualifySingleTender } from "../chatgptQualification/processTenderQualification.js";
import { qualifyBidassistTender } from "../chatgptQualification/qualifyBidassistTender.js";
import { openChatGptProject } from "../chatgptQualification/openProject.js";
import { waitForSharedSubmissionInterval } from "../chatgptQualification/submissionThrottle.js";
import {
  createPipelineRunId,
  selectManifestQualificationIds,
  writePipelineManifest,
  type PipelineManifest,
  type PipelineSourcePortal,
} from "./pipelineManifest.js";
import { verifySourceTenderMetadataRow } from "../supabase/tenderMetadataStore.js";
import { verifySourceEndToEndRows } from "../supabase/verifyEndToEndRows.js";
import { bidassistDayRoot, loadBidassistConfig } from "../bidassist/bidassistConfig.js";
import { selectPassedForChatgpt } from "../prescreen/selectPassedForChatgpt.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";

export type SourceEndToEndOptions = {
  source: "tender247" | "bidassist";
  /** Max ChatGPT qualifications per source (typically 1 for E2E). */
  limit: number;
  date?: string;
  /** Max crawl candidates before selecting PASSED for ChatGPT. */
  crawlMax?: number;
  /** When true, exhaust crawlMax looking for an eligible tender (never force REJECTED). */
  requireChatgptPath?: boolean;
};

export type SourceE2EOutcome =
  | "SUCCESS"
  | "NO_ELIGIBLE_TEST_TENDER"
  | "FAILED"
  | "RATE_LIMITED";

export type SourceEndToEndPrescreenStats = {
  candidatesCrawled: number;
  metadataVerifiedCount: number;
  prescreenRejected: number;
  prescreenManualReview: number;
  prescreenPassed: number;
  chatgptRequestsAvoided: number;
  crawlMaxPerSource: number;
  chatgptMaxPerSource: number;
};

export type SourceEndToEndResult = {
  source: "TENDER247" | "BIDASSIST";
  /** ChatGPT path completed successfully */
  success: boolean;
  /** Source-level outcome (prescreen exhaustion is not FAILED) */
  outcome: SourceE2EOutcome;
  rateLimited: boolean;
  sourceTenderId: string | null;
  folderId: string | null;
  manifestPath: string | null;
  metadataVerified: boolean;
  documentsEnriched: boolean;
  attachmentsConfirmed: boolean;
  promptSubmitted: boolean;
  responseCompleted: boolean;
  qualificationStatus:
    | "GO"
    | "CONDITIONAL_GO"
    | "PARTNER_BID"
    | "VERIFY"
    | "NO_GO"
    | null;
  qualificationVerified: boolean;
  statusSyncVerified: boolean;
  chatUrl: string | null;
  error: string | null;
  stats: SourceEndToEndPrescreenStats;
};

function emptyStats(
  crawlMax: number,
  chatgptMax: number,
): SourceEndToEndPrescreenStats {
  return {
    candidatesCrawled: 0,
    metadataVerifiedCount: 0,
    prescreenRejected: 0,
    prescreenManualReview: 0,
    prescreenPassed: 0,
    chatgptRequestsAvoided: 0,
    crawlMaxPerSource: crawlMax,
    chatgptMaxPerSource: chatgptMax,
  };
}

function emptyResult(
  source: "TENDER247" | "BIDASSIST",
  error: string | null = null,
  crawlMax = 0,
  chatgptMax = 0,
): SourceEndToEndResult {
  return {
    source,
    success: false,
    outcome: "FAILED",
    rateLimited: false,
    sourceTenderId: null,
    folderId: null,
    manifestPath: null,
    metadataVerified: false,
    documentsEnriched: source === "TENDER247",
    attachmentsConfirmed: false,
    promptSubmitted: false,
    responseCompleted: false,
    qualificationStatus: null,
    qualificationVerified: false,
    statusSyncVerified: false,
    chatUrl: null,
    error,
    stats: emptyStats(crawlMax, chatgptMax),
  };
}

function parseArgs(argv: string[]): SourceEndToEndOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    }
  }

  const sourceRaw = (values.get("source") || "").trim().toLowerCase();
  let source: "tender247" | "bidassist";
  if (sourceRaw === "tender247") source = "tender247";
  else if (sourceRaw === "bidassist") source = "bidassist";
  else throw new Error("--source=tender247|bidassist is required");

  const limitRaw = values.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 1;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer (e2e tests use 1)");
  }
  const date = values.get("date")?.trim() || undefined;
  return { source, limit, date };
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function listT247CompletedIds(dateFolder: string): string[] {
  if (!fs.existsSync(dateFolder)) return [];
  const ids: string[] = [];
  for (const name of fs.readdirSync(dateFolder)) {
    const m = name.match(/^T247-(\d+)$/i);
    if (!m) continue;
    const folder = path.join(dateFolder, name);
    const marker = path.join(folder, "agenttender-metadata-sync.json");
    const zip = path.join(folder, "documents", "Tender_All_Documents.zip");
    if (
      (fs.existsSync(marker) || fs.existsSync(path.join(folder, "metadata.json"))) &&
      fs.existsSync(zip)
    ) {
      ids.push(m[1]!);
    }
  }
  return ids.sort();
}

function listBidassistCompletedIds(dayRoot: string): string[] {
  if (!fs.existsSync(dayRoot)) return [];
  const ids: string[] = [];
  for (const name of fs.readdirSync(dayRoot)) {
    if (!/^BA-/i.test(name)) continue;
    const folder = path.join(dayRoot, name);
    const statePath = path.join(folder, "download-state.json");
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
        status?: string;
        bidassistId?: string;
      };
      if (state.status === "completed" && state.bidassistId) {
        ids.push(String(state.bidassistId));
      }
    } catch {
      // ignore
    }
  }
  return ids;
}

function folderLabel(
  source: PipelineSourcePortal,
  id: string,
): string {
  if (source === "TENDER247") {
    return `T247-${id}`;
  }
  return id.toUpperCase().startsWith("BA-") ? id : `BA-${id}`;
}

function findBidassistFolder(
  baRoot: string,
  id: string,
): string {
  const folderCandidates = fs.existsSync(baRoot)
    ? fs.readdirSync(baRoot).filter((n) => {
        const statePath = path.join(baRoot, n, "download-state.json");
        if (!fs.existsSync(statePath)) return false;
        try {
          const st = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
            bidassistId?: string;
          };
          return String(st.bidassistId) === id;
        } catch {
          return false;
        }
      })
    : [];
  if (folderCandidates[0]) {
    return path.join(baRoot, folderCandidates[0]);
  }
  return path.join(
    baRoot,
    id.toUpperCase().startsWith("BA-") ? id : `BA-${id}`,
  );
}

/** Run one source crawl → ChatGPT → Supabase verification. */
export async function runSourceEndToEnd(
  options: SourceEndToEndOptions,
): Promise<SourceEndToEndResult> {
  const source: PipelineSourcePortal =
    options.source === "tender247" ? "TENDER247" : "BIDASSIST";
  const limit = options.limit;
  const config = loadConfig();
  const logger = new Logger(config.logRoot, `E2E-${source}`);
  const dateIso =
    options.date?.trim() ||
    resolveRequestedDate(process.argv.slice(2)).requestedDate ||
    getIndiaTodayIsoDate();
  const prescreenCfg = loadPrescreenConfig();
  const crawlCandidatesEnv = Number.parseInt(
    process.env.E2E_CRAWL_CANDIDATES?.trim() || "0",
    10,
  );
  const explicitCrawl =
    typeof options.crawlMax === "number" &&
    Number.isFinite(options.crawlMax) &&
    options.crawlMax > 0
      ? options.crawlMax
      : null;
  // Crawl enough candidates so we can find the first PASSED for ChatGPT.
  const crawlLimit = Math.max(
    limit,
    explicitCrawl ??
      (Number.isFinite(crawlCandidatesEnv) && crawlCandidatesEnv > 0
        ? crawlCandidatesEnv
        : prescreenCfg.enabled
          ? Math.max(limit, 5)
          : limit),
  );
  const requireChatgptPath = options.requireChatgptPath !== false;
  logger.info(`E2E_SOURCE=${source}`);
  logger.info(`E2E_QUALIFY_LIMIT=${limit}`);
  logger.info(`E2E_CRAWL_CANDIDATES=${crawlLimit}`);
  if (source === "BIDASSIST") {
    logger.info("PRESCREEN_EMD_RULE_APPLIED=false");
    logger.info("PRESCREEN_IT_RELEVANCE_RULE_APPLIED=false");
    logger.info(
      "BIDASSIST_CATEGORY_FILTER_ASSUMED=Software and IT Solutions",
    );
  } else {
    logger.info("PRESCREEN_EMD_RULE_APPLIED=true");
    logger.info("PRESCREEN_IT_RELEVANCE_RULE_APPLIED=true");
  }
  const dateFolder = path.resolve(config.downloadRoot, dateIso);
  ensureDir(dateFolder);

  const result = emptyResult(source, null, crawlLimit, limit);
  result.stats.crawlMaxPerSource = crawlLimit;
  result.stats.chatgptMaxPerSource = limit;
  console.log(`E2E_SOURCE=${source}`);
  console.log(`E2E_QUALIFY_LIMIT=${limit}`);
  console.log(`E2E_CRAWL_CANDIDATES=${crawlLimit}`);
  console.log(`E2E_REQUIRE_CHATGPT_PATH=${requireChatgptPath ? "true" : "false"}`);
  console.log(`E2E_DATE=${dateIso}`);

  const runId = createPipelineRunId(source);
  const beforeT247 = new Set(listT247CompletedIds(dateFolder));
  const baConfig = loadBidassistConfig();
  const baRoot = bidassistDayRoot(baConfig, dateIso);
  const beforeBa = new Set(listBidassistCompletedIds(baRoot));

  try {
    if (source === "TENDER247") {
      console.log("TENDER247_CRAWLER_START");
      const code = await runCommand(
        "npx",
        [
          "tsx",
          "src/tender247Batch/runDailyBatch.ts",
          `--date=${dateIso}`,
        ],
        {
          MAX_TENDERS: String(crawlLimit),
          TENDER247_DATE: dateIso,
        },
      );
      if (code !== 0) {
        throw new Error(`Tender247 crawler exited with code ${code}`);
      }
      console.log("TENDER247_CRAWLER_COMPLETE");
    } else {
      console.log("BIDASSIST_CRAWLER_START");
      const code = await runCommand(
        "npx",
        [
          "tsx",
          "src/bidassist/runBidassistCrawler.ts",
          `--limit=${crawlLimit}`,
          `--date=${dateIso}`,
        ],
        {
          MAX_BIDASSIST_TENDERS: String(crawlLimit),
        },
      );
      if (code !== 0) {
        throw new Error(`BidAssist crawler exited with code ${code}`);
      }
      console.log("BIDASSIST_CRAWLER_COMPLETE");
    }

    const afterT247 = listT247CompletedIds(dateFolder);
    const afterBa = listBidassistCompletedIds(baRoot);

    let completedIds: string[] =
      source === "TENDER247"
        ? afterT247.filter((id) => !beforeT247.has(id))
        : afterBa.filter((id) => !beforeBa.has(id));

    if (completedIds.length === 0) {
      completedIds =
        source === "TENDER247"
          ? afterT247.slice(-crawlLimit)
          : afterBa.slice(-crawlLimit);
    }
    completedIds = completedIds.slice(0, crawlLimit);

    if (completedIds.length === 0) {
      throw new Error(
        "No completed crawler tenders available for e2e qualification",
      );
    }

    for (const id of completedIds) {
      const verified = await verifySourceTenderMetadataRow(source, id);
      const label = folderLabel(source, id);
      if (!verified.ok) {
        throw new Error(
          `SUPABASE_TENDER_VERIFY_FAILED=${label} ${verified.error}`,
        );
      }
      console.log(`SUPABASE_TENDER_VERIFIED=${label}`);
      result.metadataVerified = true;
      result.stats.metadataVerifiedCount += 1;
    }
    result.stats.candidatesCrawled = completedIds.length;

    // Pre-screen already ran during crawl upsert. Filter to PASSED only.
    console.log("E2E_PRESCREEN_FILTER_START");
    const selection = await selectPassedForChatgpt({
      sourcePortal: source,
      sourceTenderIds: completedIds,
      logger,
      limit,
    });
    console.log(
      `E2E_PRESCREEN_SKIPPED_WITHOUT_CHATGPT=${selection.skipped.length}`,
    );
    console.log(
      `E2E_PRESCREEN_PASSED_FOR_CHATGPT=${selection.passedIds.length}`,
    );

    result.stats.prescreenPassed = selection.passedIds.length;
    result.stats.prescreenRejected = selection.skipped.filter(
      (s) => s.status === "REJECTED",
    ).length;
    result.stats.prescreenManualReview = selection.skipped.filter(
      (s) => s.status === "MANUAL_REVIEW",
    ).length;
    result.stats.chatgptRequestsAvoided = selection.skipped.length;

    const qualifyIds = selection.passedIds;
    if (qualifyIds.length === 0) {
      const skippedSummary = selection.skipped
        .map(
          (s) =>
            `${folderLabel(source, s.sourceTenderId)}:${s.status ?? "null"}:${s.reasonCode ?? "null"}`,
        )
        .join(",");
      logger.info(
        `E2E_NO_ELIGIBLE_TEST_TENDER=${source} crawled=${completedIds.length} skipped=${skippedSummary}`,
      );
      console.log(`E2E_NO_ELIGIBLE_TEST_TENDER=${source}`);
      console.log(`E2E_SOURCE_TECHNICAL_SUCCESS=${source}`);
      console.log("E2E_CHATGPT_SKIPPED_NO_PASSED_TENDER");
      result.sourceTenderId = null;
      result.folderId = null;
      result.error = null;
      result.success = false;
      result.outcome = "NO_ELIGIBLE_TEST_TENDER";
      result.stats.chatgptRequestsAvoided = completedIds.length;
      const emptyManifest: PipelineManifest = {
        runId,
        sourcePortal: source,
        startedAt: new Date().toISOString(),
        selectedTenderIds: [...completedIds],
        completedCrawlerTenderIds: [...completedIds],
        failedCrawlerTenderIds: [],
        qualifiedTenderIds: [],
        failedQualificationTenderIds: [],
        finishedAt: new Date().toISOString(),
      };
      result.manifestPath = writePipelineManifest(
        resolveProjectPath(config.downloadRoot),
        emptyManifest,
        dateIso,
      );
      return result;
    }

    const primaryId = qualifyIds[0]!;
    result.sourceTenderId = primaryId;
    result.folderId = folderLabel(source, primaryId);

    const manifest: PipelineManifest = {
      runId,
      sourcePortal: source,
      startedAt: new Date().toISOString(),
      selectedTenderIds: [...qualifyIds],
      completedCrawlerTenderIds: [...completedIds],
      failedCrawlerTenderIds: [],
      qualifiedTenderIds: [],
      failedQualificationTenderIds: selection.skipped.map(
        (s) => s.sourceTenderId,
      ),
    };
    result.manifestPath = writePipelineManifest(
      resolveProjectPath(config.downloadRoot),
      manifest,
      dateIso,
    );

    const manifestQualifyIds = selectManifestQualificationIds(manifest);
    if (manifestQualifyIds.length !== qualifyIds.length) {
      throw new Error("Manifest qualification ID selection mismatch");
    }
    if (qualifyIds.length > limit) {
      throw new Error(`E2E limit ${limit} exceeded by ${qualifyIds.length} IDs`);
    }
    // Process only current-run PASSED IDs (never rejected / manual-review).
    console.log(
      `E2E_MANIFEST_QUALIFY_IDS=${qualifyIds.join(",")}`,
    );
    console.log(`E2E_FIRST_PASSED=${folderLabel(source, primaryId)}`);

    let session:
      | Awaited<ReturnType<typeof launchChatGptPersistentSession>>
      | undefined;

    try {
      session = await launchChatGptPersistentSession({
        config,
        logger,
      });
      await ensureChatGptLoggedIn({
        page: session.page,
        context: session.context,
        config,
        logger,
      });

      await openChatGptProject({
        page: session.page,
        projectName: config.chatgptProjectName,
        projectUrl: config.chatgptProjectUrl,
        projectMatch: config.chatgptProjectMatch,
        config,
        logger,
      });

      for (const id of qualifyIds) {
        await waitForSharedSubmissionInterval({
          minIntervalMs: config.chatgptMinSubmissionIntervalMs,
          logger,
        });

        const label = folderLabel(source, id);

        let outcome;
        if (source === "TENDER247") {
          logger.info(`E2E_SOURCE=TENDER247`);
          logger.info(`E2E_QUALIFY_START=T247-${id}`);
          outcome = await qualifySingleTender({
            page: session.page,
            dateFolder,
            t247Id: id,
            config,
            logger,
            manifestTotals: {
              expectedTender247: qualifyIds.length,
              readyForChatGpt: qualifyIds.length,
              selected: qualifyIds.length,
            },
          });
        } else {
          logger.info(`E2E_SOURCE=BIDASSIST`);
          logger.info(`E2E_QUALIFY_START=BA-${id}`);
          const tenderFolder = findBidassistFolder(baRoot, id);
          outcome = await qualifyBidassistTender({
            page: session.page,
            dateFolder,
            sourceTenderId: id,
            tenderFolder,
            config,
            logger,
          });
        }

        if (
          outcome.status === "completed" ||
          outcome.status === "skipped" ||
          outcome.status === "response_pending" ||
          outcome.status === "rate_limited"
        ) {
          result.attachmentsConfirmed = true;
        }
        if (outcome.submittedAt || outcome.status === "completed" || outcome.status === "skipped" || outcome.status === "response_pending") {
          result.promptSubmitted = true;
        }
        if (outcome.status === "completed" || outcome.status === "skipped") {
          result.responseCompleted = true;
        }
        if (outcome.chatUrl) {
          result.chatUrl = outcome.chatUrl;
        }
        if (outcome.qualification?.status) {
          result.qualificationStatus = outcome.qualification.status as SourceEndToEndResult["qualificationStatus"];
        }

        if (outcome.status === "rate_limited") {
          result.rateLimited = true;
          result.error = outcome.error || "Too many requests";
          logger.warn("E2E_RATE_LIMITED — stopping further submissions");
          manifest.failedQualificationTenderIds = [
            ...(manifest.failedQualificationTenderIds || []),
            id,
          ];
          break;
        }

        if (outcome.status === "completed" || outcome.status === "skipped") {
          manifest.qualifiedTenderIds = [
            ...(manifest.qualifiedTenderIds || []),
            id,
          ];
          console.log(`E2E_TENDER_COMPLETE=${label}`);
        } else {
          manifest.failedQualificationTenderIds = [
            ...(manifest.failedQualificationTenderIds || []),
            id,
          ];
          result.error =
            outcome.error ||
            `Qualification ended with status=${outcome.status}`;
          logger.error(
            `E2E_TENDER_FAILED=${label} status=${outcome.status} error=${outcome.error}`,
          );
        }
      }
    } finally {
      if (config.chatgptKeepBrowserOpenOnFailure) {
        logger.warn(
          "CHATGPT_KEEP_BROWSER_OPEN_ON_FAILURE — browser left open for inspection (10 minutes)",
        );
        await new Promise((r) => setTimeout(r, 10 * 60_000));
      }
      await closeChatGptSession(session);
    }

    manifest.finishedAt = new Date().toISOString();
    writePipelineManifest(
      resolveProjectPath(config.downloadRoot),
      manifest,
      dateIso,
    );

    if (result.rateLimited) {
      result.success = false;
      result.outcome = "RATE_LIMITED";
      return result;
    }

    const failed = (manifest.failedQualificationTenderIds || []).filter(
      (id) => qualifyIds.includes(id),
    ).length;
    if (failed > 0 || !result.sourceTenderId) {
      result.success = false;
      result.outcome = "FAILED";
      result.error =
        result.error ||
        `Qualification failed for ${(manifest.failedQualificationTenderIds || []).join(",")}`;
      return result;
    }

    const verification = await verifySourceEndToEndRows({
      source,
      sourceTenderId: result.sourceTenderId,
    });
    result.metadataVerified = verification.metadataVerified;
    result.documentsEnriched = verification.documentsEnriched;
    result.qualificationVerified = verification.qualificationVerified;
    result.statusSyncVerified = verification.statusSyncVerified;
    result.qualificationStatus =
      verification.qualificationStatus ?? result.qualificationStatus;
    result.chatUrl = verification.chatUrl ?? result.chatUrl;
    result.success = verification.ok;
    result.outcome = verification.ok ? "SUCCESS" : "FAILED";
    if (!verification.ok) {
      result.error = verification.error;
    }

    console.log("==================================");
    console.log("Source End-To-End");
    console.log(`Source: ${source}`);
    console.log(`Crawl max: ${crawlLimit}`);
    console.log(`ChatGPT max: ${limit}`);
    console.log(`Candidates crawled: ${result.stats.candidatesCrawled}`);
    console.log(`Prescreen passed: ${result.stats.prescreenPassed}`);
    console.log(`Outcome: ${result.outcome}`);
    console.log(`Success: ${result.success}`);
    console.log("==================================");

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    result.success = false;
    result.outcome = "FAILED";
    logger.error(`E2E_SOURCE_FAILED=${source} ${message}`);
    return result;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    options.source === "tender247"
      ? "TENDER247_E2E_START"
      : "BIDASSIST_E2E_START",
  );
  const result = await runSourceEndToEnd(options);
  console.log(
    options.source === "tender247"
      ? "TENDER247_E2E_COMPLETE"
      : "BIDASSIST_E2E_COMPLETE",
  );
  if (result.rateLimited) {
    process.exit(2);
  }
  if (result.outcome === "NO_ELIGIBLE_TEST_TENDER") {
    process.exit(0);
  }
  if (!result.success) {
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
