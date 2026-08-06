/**
 * Tender247 NETWORK DISCOVERY mode.
 *
 * Opens an authenticated dashboard and records network traffic while the user
 * manually opens a tender detail via ANY control (eye, Corrigendum, etc.).
 *
 * Does NOT click automatically. Does NOT depend on which element was used.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Request, Response } from "playwright";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "./browserUtils.js";
import { loadConfig, resolveTender247AuthPath } from "./config.js";
import { ensureDir, resolveProjectPath } from "./fileUtils.js";
import { Logger, safeErrorMessage } from "./logger.js";
import {
  dismissTender247BlockingOverlays,
  isTender247DashboardAuthenticated,
  loginToTender247,
} from "./tenderDetails/ensureTender247LoggedIn.js";

const DEFAULT_TARGET_ID = "101466917";
const MAX_JSON_PREVIEW_BYTES = 100 * 1024;
const POST_DETAIL_RECORD_MS = 15_000;
const MANUAL_WAIT_TIMEOUT_MS = 10 * 60_000;

const INTEREST_KEYWORDS = [
  "tender",
  "detail",
  "document",
  "download",
  "corrigendum",
  "summary",
  "bid",
] as const;

interface DiscoveryRequestRecord {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  postData: string | null;
  pageUrl: string | null;
}

interface DiscoveryResponseRecord {
  id: string;
  requestId: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  resourceType: string;
  jsonPreview: unknown | null;
  jsonPreviewTruncated: boolean;
  bodyReadError: string | null;
  pageUrl: string | null;
}

interface DiscoveryNewPageRecord {
  timestamp: string;
  url: string;
}

interface DiscoveryReport {
  startedAt: string;
  finishedAt: string | null;
  targetTender247Id: string;
  dashboardUrl: string;
  newPages: DiscoveryNewPageRecord[];
  requests: DiscoveryRequestRecord[];
  responses: DiscoveryResponseRecord[];
}

function getCliArgument(name: string): string | undefined {
  const args = process.argv.slice(2);
  const normalizedName = name.startsWith("--") ? name : `--${name}`;

  for (const arg of args) {
    if (arg.startsWith(`${normalizedName}=`)) {
      const value = arg.slice(`${normalizedName}=`.length).trim();
      return value || undefined;
    }
  }

  const index = args.indexOf(normalizedName);
  if (index >= 0 && index + 1 < args.length) {
    const value = args[index + 1]?.trim();
    if (value && !value.startsWith("--")) {
      return value;
    }
  }

  return undefined;
}

function isRelevantUrlOrBody(url: string, postData: string | null, targetId: string): boolean {
  const haystack = `${url}\n${postData ?? ""}`.toLowerCase();
  if (haystack.includes(targetId.toLowerCase())) {
    return true;
  }
  return INTEREST_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function makeRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function attachNetworkListeners(
  page: Page,
  report: DiscoveryReport,
  targetId: string,
  logger: Logger,
  requestIds: WeakMap<Request, string>,
): Promise<void> {
  page.on("request", (request: Request) => {
    try {
      const url = request.url();
      const postData = request.postData() ?? null;
      if (!isRelevantUrlOrBody(url, postData, targetId)) {
        return;
      }

      const id = makeRequestId();
      requestIds.set(request, id);

      const record: DiscoveryRequestRecord = {
        id,
        timestamp: new Date().toISOString(),
        method: request.method(),
        url,
        resourceType: request.resourceType(),
        postData: postData && postData.length <= 50_000 ? postData : postData ? `[truncated ${postData.length} chars]` : null,
        pageUrl: page.url(),
      };
      report.requests.push(record);
      logger.info(
        `NET_REQ ${record.method} ${record.resourceType} ${record.url}`,
      );
    } catch {
      // ignore listener errors
    }
  });

  page.on("response", (response: Response) => {
    void (async () => {
      try {
        const request = response.request();
        const url = response.url();
        const postData = request.postData() ?? null;
        if (!isRelevantUrlOrBody(url, postData, targetId)) {
          return;
        }

        const requestId = requestIds.get(request) ?? makeRequestId();
        const contentType = response.headers()["content-type"] ?? null;
        let jsonPreview: unknown | null = null;
        let jsonPreviewTruncated = false;
        let bodyReadError: string | null = null;

        if (contentType && /application\/json/i.test(contentType)) {
          try {
            const text = await response.text();
            if (text.length > MAX_JSON_PREVIEW_BYTES) {
              jsonPreviewTruncated = true;
              const sliced = text.slice(0, MAX_JSON_PREVIEW_BYTES);
              try {
                jsonPreview = JSON.parse(sliced);
              } catch {
                jsonPreview = sliced;
              }
            } else {
              try {
                jsonPreview = JSON.parse(text);
              } catch {
                jsonPreview = text;
              }
            }
          } catch (error) {
            bodyReadError =
              error instanceof Error ? error.message : String(error);
          }
        }

        const record: DiscoveryResponseRecord = {
          id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          requestId,
          timestamp: new Date().toISOString(),
          method: request.method(),
          url,
          status: response.status(),
          contentType,
          resourceType: request.resourceType(),
          jsonPreview,
          jsonPreviewTruncated,
          bodyReadError,
          pageUrl: page.url(),
        };
        report.responses.push(record);
        logger.info(
          `NET_RES ${record.status} ${record.contentType ?? "unknown"} ${record.url}`,
        );
      } catch {
        // ignore listener errors
      }
    })();
  });
}

async function runDiscovery(): Promise<void> {
  const config = loadConfig();
  // Manual click requires a visible browser
  const discoveryConfig = { ...config, headless: false };
  const logger = new Logger(config.logRoot, "Tender247NetworkDiscovery");

  const rawId = getCliArgument("t247-id") ?? DEFAULT_TARGET_ID;
  const targetTender247Id = rawId.replace(/\D/g, "") || DEFAULT_TARGET_ID;

  const authPath = resolveTender247AuthPath(discoveryConfig);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  const debugDir = resolveProjectPath("debug");
  ensureDir(debugDir);
  const reportPath = path.join(debugDir, "tender247-network-discovery.json");

  const report: DiscoveryReport = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    targetTender247Id,
    dashboardUrl: discoveryConfig.tender247Url.trim() || "https://www.tender247.com/auth/tender",
    newPages: [],
    requests: [],
    responses: [],
  };

  const requestIds = new WeakMap<Request, string>();
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;
  let detailOpenedAt: number | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  const saveReport = (): void => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  };

  try {
    session = await launchBrowserSession({
      headless: false,
      storageStatePath: authPath,
      downloadPath: resolveProjectPath("downloads", "network-discovery"),
      pageTimeoutMs: discoveryConfig.pageTimeoutMs,
    });

    const { page, context } = session;

    await attachNetworkListeners(
      page,
      report,
      targetTender247Id,
      logger,
      requestIds,
    );

    // Auth + popup dismiss using existing production helpers (unchanged)
    await loginToTender247(page, context, logger, discoveryConfig);

    if (!(await isTender247DashboardAuthenticated(page))) {
      throw new AutomationError(
        "TENDER247_NOT_AUTHENTICATED",
        "Dashboard did not appear authenticated after login helper",
      );
    }

    await dismissTender247BlockingOverlays(page, logger, discoveryConfig);

    console.log("");
    console.log("NETWORK DISCOVERY READY");
    console.log(
      `Manually open T247 ID ${targetTender247Id} using the eye icon, Corrigendum link, or any control that opens its tender detail.`,
    );
    console.log(
      "Recording relevant network requests. Browser will stay open.",
    );
    console.log(
      `After any new detail tab opens, recording continues for ${POST_DETAIL_RECORD_MS / 1000}s.`,
    );
    console.log(`Report will be written to: ${reportPath}`);
    console.log("");

    logger.info("NETWORK DISCOVERY READY");
    logger.info(`Target T247 ID=${targetTender247Id}`);
    logger.info(
      "Waiting for any new BrowserContext page (eye, Corrigendum, or other control)",
    );

    // Monitor ANY newly opened page after READY — no dependency on which control was clicked
    context.on("page", (newPage: Page) => {
      void (async () => {
        try {
          // Attach listeners immediately so early detail/API traffic is captured
          await attachNetworkListeners(
            newPage,
            report,
            targetTender247Id,
            logger,
            requestIds,
          );

          await newPage
            .waitForLoadState("domcontentloaded", { timeout: 15_000 })
            .catch(() => undefined);

          const url = newPage.url();
          logger.info("TENDER247_DETAIL_TAB_OPENED");
          logger.info(`URL=${url}`);
          console.log("\nTENDER247_DETAIL_TAB_OPENED");
          console.log(`URL=${url}\n`);

          report.newPages.push({
            timestamp: new Date().toISOString(),
            url,
          });

          // Also catch late navigations on the same new tab
          newPage.on("framenavigated", (frame) => {
            if (frame === newPage.mainFrame()) {
              const nextUrl = newPage.url();
              logger.info(`TENDER247_DETAIL_TAB_NAVIGATED URL=${nextUrl}`);
              report.newPages.push({
                timestamp: new Date().toISOString(),
                url: nextUrl,
              });
            }
          });

          if (detailOpenedAt === null) {
            detailOpenedAt = Date.now();
            if (finishTimer) {
              clearTimeout(finishTimer);
            }
            finishTimer = setTimeout(() => {
              // Main wait loop exits once POST_DETAIL_RECORD_MS has elapsed
            }, POST_DETAIL_RECORD_MS);
          }
        } catch (error) {
          logger.warn(
            `New-page handler error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })();
    });

    const deadline = Date.now() + MANUAL_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        detailOpenedAt !== null &&
        Date.now() - detailOpenedAt >= POST_DETAIL_RECORD_MS
      ) {
        break;
      }
      await page.waitForTimeout(500);
    }

    if (detailOpenedAt === null) {
      logger.warn(
        "No detail tab opened before timeout — saving whatever was captured",
      );
      console.log(
        "\nNo detail tab detected. Saving partial discovery report.\n",
      );
    }

    saveReport();

    const jsonResponses = report.responses.filter(
      (r) => r.jsonPreview !== null || /application\/json/i.test(r.contentType ?? ""),
    );

    console.log("");
    console.log("NETWORK DISCOVERY COMPLETE");
    console.log(`New pages: ${report.newPages.length}`);
    console.log(`Relevant requests: ${report.requests.length}`);
    console.log(`Relevant JSON responses: ${jsonResponses.length}`);
    console.log(`Report file: ${reportPath}`);
    console.log("");

    logger.info("NETWORK DISCOVERY COMPLETE");
    logger.info(`New pages: ${report.newPages.length}`);
    logger.info(`Relevant requests: ${report.requests.length}`);
    logger.info(`Relevant JSON responses: ${jsonResponses.length}`);
    logger.info(`Report file: ${reportPath}`);
  } finally {
    if (finishTimer) {
      clearTimeout(finishTimer);
    }
    try {
      saveReport();
    } catch {
      // ignore
    }
    await closeBrowserSession(session);
  }
}

async function main(): Promise<void> {
  const logger = new Logger(loadConfig().logRoot, "Tender247NetworkDiscovery");
  try {
    await runDiscovery();
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
