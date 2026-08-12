import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import { getTodayIsoDate } from "../dateUtils.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import {
  buildSearchBody,
  mailSearchUrl,
  postJson,
  resolveSessionContext,
} from "./apiClient.js";
import type { DiscoveredTender, SearchTenderRow, SessionContext } from "./types.js";

const T247_ID_RE = /T247\s*ID\s*[-:]?\s*(\d+)/gi;

export interface CollectResult {
  expectedCount: number;
  tenders: DiscoveredTender[];
  method: "ui-scroll";
  discoveryComplete: boolean;
  countMismatch: boolean;
  session: SessionContext;
}

/**
 * Discover ALL Today's Fresh tenders via UI infinite scroll BEFORE any detail processing.
 *
 * Required behavior:
 * 1. Read Fresh (N)
 * 2. Scroll the list, collecting unique T247 IDs into a Set
 * 3. Stop when discovered === Fresh total OR 5 consecutive scrolls add no new IDs
 * 4. Save discovered-tenders.json
 * 5. Optionally enrich security codes via API (does not change discovery source)
 */
export async function collectAllTodayTenders(options: {
  page: Page;
  context: BrowserContext;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  /** Explicit CLI / pipeline mail date (YYYY-MM-DD). Never invent with new Date() when supplied. */
  mailDate?: string;
}): Promise<CollectResult> {
  const { page, context, dateFolder, config, logger } = options;
  const mailDate =
    options.mailDate && /^\d{4}-\d{2}-\d{2}$/.test(options.mailDate)
      ? options.mailDate
      : getTodayIsoDate();
  const session = await resolveSessionContext(page, context, mailDate, logger);

  await dismissTender247BlockingOverlays(page, logger, config);
  await dismissTender247SupportChat(page, logger);

  const expectedCount = await readFreshTotal(page, logger);
  logger.info(`TENDER247_EXPECTED_TODAY_COUNT=${expectedCount}`);

  const idSet = new Set<string>();
  const ordered: DiscoveredTender[] = [];
  let emptyScrolls = 0;
  let lastLoggedCount = -1;

  // Collect currently visible IDs first
  await harvestVisibleIds(page, idSet, ordered, logger, () => {
    if (idSet.size !== lastLoggedCount) {
      logger.info(`TENDER247_DISCOVERED_COUNT=${idSet.size}`);
      lastLoggedCount = idSet.size;
    }
  });

  while (true) {
    if (expectedCount > 0 && idSet.size >= expectedCount) {
      break;
    }

    const before = idSet.size;
    await page.mouse.wheel(0, Math.max(700, 900));
    await page.waitForTimeout(800);
    await dismissTender247SupportChat(page, logger).catch(() => undefined);

    await harvestVisibleIds(page, idSet, ordered, logger, () => {
      if (idSet.size !== lastLoggedCount) {
        logger.info(`TENDER247_DISCOVERED_COUNT=${idSet.size}`);
        lastLoggedCount = idSet.size;
      }
    });

    if (expectedCount > 0 && idSet.size >= expectedCount) {
      break;
    }

    if (idSet.size === before) {
      emptyScrolls += 1;
      logger.info(
        `TENDER247_SCROLL_NO_NEW_IDS attempt=${emptyScrolls}/5 discovered=${idSet.size}`,
      );
    } else {
      emptyScrolls = 0;
    }

    if (emptyScrolls >= 5) {
      break;
    }
  }

  // Final harvest after last scroll settle
  await harvestVisibleIds(page, idSet, ordered, logger, () => {
    if (idSet.size !== lastLoggedCount) {
      logger.info(`TENDER247_DISCOVERED_COUNT=${idSet.size}`);
      lastLoggedCount = idSet.size;
    }
  });

  const discoveredCount = ordered.length;
  const countMismatch =
    expectedCount > 0 && discoveredCount !== expectedCount;

  if (countMismatch) {
    logger.warn(
      `TENDER247_COUNT_MISMATCH expected=${expectedCount} discovered=${discoveredCount}`,
    );
    console.log("");
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.log("TENDER247 DISCOVERY COUNT MISMATCH");
    console.log(`Expected Fresh total: ${expectedCount}`);
    console.log(`Discovered unique IDs: ${discoveredCount}`);
    console.log("Discovery is NOT fully successful.");
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.log("");
  } else {
    logger.info(
      `TENDER247_DISCOVERY_COMPLETE expected=${expectedCount} discovered=${discoveredCount}`,
    );
  }

  // Enrich with security codes / titles from API when possible (non-fatal)
  await enrichFromSearchApi(context, session, ordered, logger);

  saveDiscoveredList(dateFolder, ordered, expectedCount, "ui-scroll");

  return {
    expectedCount,
    tenders: ordered,
    method: "ui-scroll",
    discoveryComplete: !countMismatch || expectedCount === 0,
    countMismatch,
    session,
  };
}

async function harvestVisibleIds(
  page: Page,
  idSet: Set<string>,
  ordered: DiscoveredTender[],
  _logger: Logger,
  onChange: () => void,
): Promise<void> {
  const ids = await extractVisibleT247Ids(page);
  let changed = false;
  for (const id of ids) {
    if (!idSet.has(id)) {
      idSet.add(id);
      ordered.push({
        t247Id: id,
        position: ordered.length + 1,
      });
      changed = true;
    }
  }
  if (changed) {
    onChange();
  }
}

async function readFreshTotal(page: Page, logger: Logger): Promise<number> {
  const fresh = page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first();
  if (!(await fresh.isVisible().catch(() => false))) {
    logger.warn("Fresh (N) badge not visible");
    return 0;
  }
  const text = ((await fresh.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = text.match(/Fresh\s*\(\s*(\d+)\s*\)/i);
  return match ? Number(match[1]) : 0;
}

async function extractVisibleT247Ids(page: Page): Promise<string[]> {
  const body = ((await page.locator("body").innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(T247_ID_RE)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Fill securityCode / title / organisation from paginated search-tender API.
 * Does not replace the UI-discovered ordered ID list.
 */
async function enrichFromSearchApi(
  context: BrowserContext,
  session: SessionContext,
  ordered: DiscoveredTender[],
  logger: Logger,
): Promise<void> {
  const byId = new Map(ordered.map((t) => [t.t247Id, t]));
  let pageNo = 1;
  const pageSize = 20;
  let enriched = 0;

  try {
    while (pageNo <= 500) {
      const body = buildSearchBody(session, pageNo, pageSize);
      const res = await postJson<SearchTenderRow[]>(
        context.request,
        mailSearchUrl(),
        body,
        logger,
      );
      const rows = Array.isArray(res.Data) ? res.Data : [];
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        const id = String(row.tender_id);
        const target = byId.get(id);
        if (!target) {
          continue;
        }
        if (!target.securityCode && row.security_code) {
          target.securityCode = row.security_code;
          enriched += 1;
        }
        target.title = target.title ?? row.requirement_workbrief ?? null;
        target.organisation =
          target.organisation ?? row.organization_name ?? null;
        target.submissionEndDate =
          target.submissionEndDate ?? row.submission_enddate ?? null;
        target.listRaw = target.listRaw ?? row;
      }
      if (rows.length < pageSize) {
        break;
      }
      pageNo += 1;
    }
    logger.info(`TENDER247_API_ENRICHED_SECURITY_CODES=${enriched}`);
  } catch (error) {
    logger.warn(
      `API enrichment skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function saveDiscoveredList(
  dateFolder: string,
  tenders: DiscoveredTender[],
  expectedCount: number,
  method: string,
): void {
  ensureDir(dateFolder);
  const out = path.join(dateFolder, "discovered-tenders.json");
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        method,
        expectedCount,
        count: tenders.length,
        tenders: tenders.map((t) => ({
          t247Id: t.t247Id,
          position: t.position,
          securityCode: t.securityCode ?? null,
          title: t.title ?? null,
          organisation: t.organisation ?? null,
          submissionEndDate: t.submissionEndDate ?? null,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}
