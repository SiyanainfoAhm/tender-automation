import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import type { BidassistConfig } from "./bidassistConfig.js";
import {
  bidassistDayRoot,
  openingDateFromIso,
} from "./bidassistConfig.js";
import {
  deriveBidassistIds,
  downloadZipForCard,
  extractAndPrefixDocuments,
  isBidassistTenderComplete,
  loadDownloadState,
  saveDownloadState,
  storeOriginalZip,
  tenderFolderPath,
  writeBidassistMetadata,
} from "./bidassistDownload.js";
import {
  applyOpeningDateFilter,
  ensureCategorySelected,
  openIndianActiveTenders,
  verifyResultsFilters,
  waitForBidassistResults,
} from "./bidassistFilters.js";
import type {
  BidassistCardInfo,
  BidassistCrawlSummary,
  BidassistMetadata,
} from "./bidassistTypes.js";
import {
  extractBidAssistDocumentMetadata,
  mergeBidAssistMetadata,
} from "./bidassistDocumentMetadataExtractor.js";
import { isSupabaseRequired } from "../supabase/tenderMetadataMap.js";
import {
  upsertBidassistMetadata,
  verifyBidassistMetadataRow,
} from "../supabase/tenderMetadataStore.js";
import {
  buildBidassistPrescreenInput,
  runAndPersistPrescreen,
} from "../prescreen/runPrescreen.js";
import {
  getCurrentPaginationPage,
  moveToNextBidAssistPage,
  remainingSlots,
  shouldContinuePagination,
} from "./bidassistPagination.js";

export interface DiscoveredBidassistTender extends BidassistCardInfo {
  index: number;
  cardKey: string;
}

const DOWNLOAD_TEXT = /^\s*download\s*$/i;
const CLOSING_DATE_PATTERN =
  /\b\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s]\d{2,4}\b/i;
/** Card affordances that must never be mistaken for a tender title. */
const CARD_ACTION_TEXT =
  /^(follow|unfollow|following|download|share|save|saved|view|view details|details|bookmark|compare|add to|read more)$/i;
/** Reading the DOM must never block on the 90s page default timeout. */
const READ_TIMEOUT_MS = 2_000;
const CATEGORY_LABEL = "Software and IT Solutions";

async function safeInnerText(locator: Locator): Promise<string> {
  if ((await locator.count().catch(() => 0)) === 0) {
    return "";
  }
  const rendered = await locator
    .first()
    .evaluate(
      (el) => (el as HTMLElement).innerText || el.textContent || "",
      undefined,
      { timeout: READ_TIMEOUT_MS },
    )
    .catch(() => "");
  return rendered || "";
}

/** Every visible Download control on the results page. */
function downloadControls(page: Page): Locator {
  return page
    .locator('button, a, [role="button"]')
    .filter({ hasText: DOWNLOAD_TEXT });
}

async function countVisibleDownloadControls(page: Page): Promise<number> {
  const controls = downloadControls(page);
  const total = await controls.count().catch(() => 0);
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    if (await controls.nth(i).isVisible().catch(() => false)) {
      visible += 1;
    }
  }
  return visible;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildBidassistCardKey(info: {
  title: string;
  authority: string;
  closingDate: string;
  tenderDetailUrl?: string;
}): string {
  return [
    normalizeText(info.title),
    normalizeText(info.authority),
    normalizeText(info.closingDate),
    normalizeText(info.tenderDetailUrl || ""),
  ].join("|");
}

export function looksLikeCompleteCard(text: string): boolean {
  return CLOSING_DATE_PATTERN.test(text) || text.replace(/\s+/g, " ").length >= 80;
}

async function countDownloadControlsIn(card: Locator): Promise<number> {
  const controls = card
    .locator('button, a, [role="button"]')
    .filter({ hasText: DOWNLOAD_TEXT });
  return controls.count().catch(() => 0);
}

/**
 * Walk up from a Download button to the smallest ancestor that is a whole
 * tender card: it must carry a title and tender details, but only this one
 * Download control.
 */
async function resolveCardForControl(
  control: Locator,
): Promise<Locator | null> {
  let node = control;
  let widest: Locator | null = null;

  for (let up = 0; up < 8; up += 1) {
    const parent = node.locator("xpath=..").first();
    if ((await parent.count().catch(() => 0)) === 0) {
      break;
    }
    // Growing past a single card would make the Download button ambiguous
    if ((await countDownloadControlsIn(parent)) > 1) {
      break;
    }
    widest = parent;
    if (looksLikeCompleteCard(await safeInnerText(parent))) {
      return parent;
    }
    node = parent;
  }

  return widest;
}

/** "Mumbai, Maharashtra" style location line, not a comma inside a sentence. */
export function isLocationLine(text: string): boolean {
  const parts = text.trim().split(",");
  if (parts.length !== 2) {
    return false;
  }
  return parts.every((part) => {
    const value = part.trim();
    return (
      /^[A-Za-z][A-Za-z .'()-]*$/.test(value) &&
      value.length <= 30 &&
      value.split(/\s+/).length <= 3
    );
  });
}
/** Label rows that surround the tender name on a card. */
const CARD_META_LINE =
  /^(gem\s+category|category|closing|opening|bid\b|est\.?\s|estimated|value|emd|tender\s+value|days?\s+left|ref\s*no|quantity|published)/i;
const AUTHORITY_HINT =
  /(department|dept\b|ministry|corporation|municipal|authority|board|council|commission|nigam|limited|ltd\b|university|institute|railway|university|panchayat)/i;

export function isTitleCandidate(line: string): boolean {
  const text = line.trim();
  if (text.length < 8) {
    return false;
  }
  if (CARD_ACTION_TEXT.test(text)) {
    return false;
  }
  if (isLocationLine(text)) {
    return false;
  }
  if (CARD_META_LINE.test(text)) {
    return false;
  }
  return !(CLOSING_DATE_PATTERN.test(text) && text.length < 30);
}

/**
 * Cards mix the tender name with short labels ("Services", "Follow") and
 * chips, so the longest single-line candidate is the reliable pick.
 */
export function chooseBestTitle(candidates: string[]): string {
  let best = "";
  for (const candidate of candidates) {
    const text = candidate.replace(/\s+/g, " ").trim();
    if (text.length > 250 || !isTitleCandidate(text)) {
      continue;
    }
    if (text.length > best.length) {
      best = text;
    }
  }
  return best;
}

export function pickTitleFromLines(lines: string[]): string {
  return chooseBestTitle(lines);
}

export function parseCardLocation(lines: string[]): {
  city: string;
  state: string;
} {
  const line = lines.find((candidate) => isLocationLine(candidate));
  if (!line) {
    return { city: "", state: "" };
  }
  const [city, state] = line.split(",").map((part) => part.trim());
  return { city: city || "", state: state || "" };
}

/** BidAssist detail URLs embed the buying department as a slug. */
export function deriveAuthorityFromUrl(url: string): string {
  const match = url.match(/bidassist\.com\/[^/]+\/([^/]+)\/detail/i);
  if (!match) {
    return "";
  }
  return match[1]!
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** GEM cards name the tender only in their "[GEM] Category: <name>" row. */
export function pickGemCategoryName(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^(?:gem\s+)?category\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return "";
}

export function pickAuthority(lines: string[], detailUrl: string): string {
  const fromLines = lines.find(
    (line) => AUTHORITY_HINT.test(line) && !CARD_META_LINE.test(line),
  );
  return (fromLines || deriveAuthorityFromUrl(detailUrl) || "").trim();
}

/** Collect link and heading texts, then keep the most title-like one. */
async function readCardTitle(card: Locator, lines: string[]): Promise<string> {
  const candidates: string[] = [];

  const anchors = card.locator('a[href*="detail" i], a[href*="tender" i]');
  const anchorCount = Math.min(await anchors.count().catch(() => 0), 6);
  for (let i = 0; i < anchorCount; i += 1) {
    candidates.push(await safeInnerText(anchors.nth(i)));
  }

  const headings = card.locator("h1, h2, h3, h4, h5");
  const headingCount = Math.min(await headings.count().catch(() => 0), 3);
  for (let i = 0; i < headingCount; i += 1) {
    candidates.push(await safeInnerText(headings.nth(i)));
  }

  return chooseBestTitle(candidates) || pickTitleFromLines(lines);
}

async function readCardInfo(
  card: Locator,
  cardIndex: number,
): Promise<BidassistCardInfo> {
  const text = (await safeInnerText(card)).trim();
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const contentLines = lines.filter((line) => !CARD_ACTION_TEXT.test(line));

  let title = await readCardTitle(card, lines);
  if (!title || normalizeText(title) === normalizeText(CATEGORY_LABEL)) {
    title = pickGemCategoryName(lines) || title;
  }
  title = title || `BidAssist tender ${cardIndex + 1}`;

  const links = card.locator("a[href]");
  const link =
    (await links.count().catch(() => 0)) > 0
      ? (await links
          .first()
          .getAttribute("href", { timeout: READ_TIMEOUT_MS })
          .catch(() => null)) || ""
      : "";
  const absoluteUrl = link
    ? link.startsWith("http")
      ? link
      : `https://bidassist.com${link.startsWith("/") ? "" : "/"}${link}`
    : "";

  const sourcePortalMatch = text.match(
    /\b(GEM|GeM|Maha\s*Tender|CPP|eProcure|NIC)\b/i,
  );
  const amountMatch = text.match(
    /(?:₹|INR|Rs\.?)\s*[\d,]+(?:\.\d+)?(?:\s*(?:Cr|Lakh|Lakhs|L))?/i,
  );
  const dateMatch = text.match(CLOSING_DATE_PATTERN);

  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const authority = pickAuthority(contentLines, absoluteUrl);
  const { city, state } = parseCardLocation(lines);
  const detailLines = contentLines.filter((line) => {
    const normalized = line.replace(/\s+/g, " ");
    return normalized !== normalizedTitle && normalized !== authority;
  });

  return {
    title: normalizedTitle,
    authority,
    description: detailLines.slice(0, 4).join(" ").slice(0, 500),
    category: CATEGORY_LABEL,
    sourceTenderPortal: sourcePortalMatch?.[1] || "",
    city,
    state,
    closingDate: dateMatch?.[0] || "",
    tenderAmountText: amountMatch?.[0] || "",
    tenderDetailUrl: absoluteUrl,
    cardIndex,
  };
}

/** Discover tender cards visible on the current results page only. */
export async function discoverTenderCardsOnCurrentPage(options: {
  page: Page;
  logger: Logger;
  discoveredCardKeys: Set<string>;
  startIndex: number;
}): Promise<{
  pageTenders: DiscoveredBidassistTender[];
  duplicatesOnPage: number;
}> {
  const { page, logger, discoveredCardKeys, startIndex } = options;
  const pageKeys = new Set<string>();
  const pageTenders: DiscoveredBidassistTender[] = [];
  let duplicatesOnPage = 0;

  const controls = downloadControls(page);
  const count = await controls.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) {
      continue;
    }
    const card = await resolveCardForControl(control);
    if (!card) {
      continue;
    }
    const info = await readCardInfo(card, startIndex + pageTenders.length);
    const cardKey = buildBidassistCardKey(info);
    if (pageKeys.has(cardKey)) {
      continue;
    }
    pageKeys.add(cardKey);

    if (discoveredCardKeys.has(cardKey)) {
      duplicatesOnPage += 1;
      logger.info(`BIDASSIST_DUPLICATE_SKIPPED=${cardKey}`);
      continue;
    }

    const record: DiscoveredBidassistTender = {
      ...info,
      index: startIndex + pageTenders.length,
      cardIndex: startIndex + pageTenders.length,
      cardKey,
    };
    pageTenders.push(record);
    logger.info(
      `BIDASSIST_CARD_DISCOVERED index=${record.index} title=${record.title}`,
    );
  }

  logger.info(`BIDASSIST_PAGE_TENDERS_DISCOVERED=${pageTenders.length}`);
  return { pageTenders, duplicatesOnPage };
}

export async function getFirstTenderCardKey(
  page: Page,
): Promise<string | null> {
  const controls = downloadControls(page);
  const count = await controls.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) {
      continue;
    }
    const card = await resolveCardForControl(control);
    if (!card) {
      continue;
    }
    const info = await readCardInfo(card, 0);
    return buildBidassistCardKey(info);
  }
  return null;
}

async function waitForTenderResultsReady(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
  pageNumber: number;
}): Promise<void> {
  const { page, config, logger, pageNumber } = options;
  await waitForBidassistResults(page, logger);
  await verifyResultsFilters({
    page,
    config,
    logger,
    requireOpeningDate: true,
  });
  logger.info(`BIDASSIST_FILTERS_PRESERVED_ON_PAGE=${pageNumber}`);
}

async function assertPageDiscoveryHealthy(options: {
  page: Page;
  logger: Logger;
  pageTenderCount: number;
}): Promise<"ok" | "empty"> {
  const { page, logger, pageTenderCount } = options;
  if (pageTenderCount > 0) {
    return "ok";
  }

  const visibleDownloads = await countVisibleDownloadControls(page);
  logger.info(`BIDASSIST_VISIBLE_DOWNLOAD_BUTTON_COUNT=${visibleDownloads}`);

  if (visibleDownloads > 0) {
    await saveFailureScreenshot({ page, folderId: "card-discovery", logger });
    throw new AutomationError(
      "BIDASSIST_CARD_DISCOVERY_FAILED",
      `${visibleDownloads} Download buttons are visible but no tender card was resolved`,
    );
  }

  await waitForBidassistResults(page, logger);
  const retryDownloads = await countVisibleDownloadControls(page);
  if (retryDownloads > 0) {
    return "ok";
  }
  return "empty";
}

/** Re-find a card after the results list rerenders. */
async function relocateCard(
  page: Page,
  tender: DiscoveredBidassistTender,
): Promise<Locator | null> {
  const controls = downloadControls(page);
  const count = await controls.count().catch(() => 0);
  const wantedTitle = normalizeText(tender.title);
  let titleMatch: Locator | null = null;

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) {
      continue;
    }
    const card = await resolveCardForControl(control);
    if (!card) {
      continue;
    }
    const info = await readCardInfo(card, i);
    if (buildBidassistCardKey(info) === tender.cardKey) {
      return card;
    }
    if (!titleMatch && normalizeText(info.title) === wantedTitle) {
      titleMatch = card;
    }
  }
  return titleMatch;
}

/** The single Download control belonging to this card. */
async function findCardDownloadControl(card: Locator): Promise<Locator | null> {
  const groups: Locator[] = [
    card.getByRole("button", { name: /^download$/i }),
    card
      .locator('button, a, [role="button"]')
      .filter({ hasText: DOWNLOAD_TEXT }),
  ];

  for (const group of groups) {
    const count = await group.count().catch(() => 0);
    const usable: Locator[] = [];
    for (let i = 0; i < count; i += 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      if (!(await candidate.isEnabled().catch(() => true))) {
        continue;
      }
      usable.push(candidate);
    }
    if (usable.length === 1) {
      return usable[0]!;
    }
    if (usable.length > 1) {
      return null;
    }
  }
  return null;
}

/** Close overlays that would swallow the click, without changing filters. */
async function dismissTransientOverlays(page: Page): Promise<void> {
  const calendar = page
    .locator('[class*="calendar" i], [class*="datepicker" i]')
    .first();
  if (await calendar.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

async function saveFailureScreenshot(options: {
  page: Page;
  folderId: string;
  logger: Logger;
}): Promise<void> {
  try {
    const dir = resolveProjectPath("debug");
    ensureDir(dir);
    const safeId = options.folderId.replace(/[<>:"/\\|?*]/g, "_");
    const file = path.join(dir, `bidassist-${safeId}-failure.png`);
    await options.page.screenshot({ path: file, fullPage: true });
    options.logger.info(`BIDASSIST_FAILURE_SCREENSHOT=${file}`);
  } catch {
    // ignore
  }
}

export async function processBidassistTender(options: {
  page: Page;
  tender: DiscoveredBidassistTender;
  position: string;
  config: BidassistConfig;
  dayRoot: string;
  tempDownloadDir: string;
  logger: Logger;
  attemptedIds: Set<string>;
}): Promise<"completed" | "skipped" | "failed"> {
  const {
    page,
    tender,
    position,
    config,
    dayRoot,
    tempDownloadDir,
    logger,
    attemptedIds,
  } = options;
  const info: BidassistCardInfo = tender;

  const provisional = deriveBidassistIds({
    detailUrl: info.tenderDetailUrl,
    title: info.title,
    authority: info.authority,
    closingDate: info.closingDate,
  });

  logger.info(
    `BIDASSIST_TENDER_START=${position} id=${provisional.folderId} title=${info.title}`,
  );

  if (attemptedIds.has(provisional.folderId)) {
    logger.info(`BIDASSIST_DUPLICATE_SKIPPED=${provisional.folderId}`);
    return "skipped";
  }
  attemptedIds.add(provisional.folderId);

  const folder = tenderFolderPath(dayRoot, provisional.folderId);
  if (isBidassistTenderComplete(folder)) {
    logger.info(`BIDASSIST_ALREADY_COMPLETE_SKIP=${provisional.folderId}`);
    return "skipped";
  }

  ensureDir(folder);
  saveDownloadState(folder, {
    folderId: provisional.folderId,
    bidassistId: provisional.bidassistId,
    status: "downloading",
    title: info.title,
    tenderDetailUrl: info.tenderDetailUrl || null,
    updatedAt: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    error: null,
  });

  try {
    const card = await relocateCard(page, tender);
    if (!card) {
      throw new Error(`Tender card no longer on the page: ${info.title}`);
    }
    await card.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(500);
    await dismissTransientOverlays(page);

    const downloadButton = await findCardDownloadControl(card);
    if (!downloadButton) {
      throw new Error(
        `Card does not expose exactly one usable Download control: ${info.title}`,
      );
    }
    await downloadButton.scrollIntoViewIfNeeded().catch(() => undefined);
    logger.info(`BIDASSIST_DOWNLOAD_BUTTON_FOUND=${provisional.folderId}`);

    logger.info(`BIDASSIST_DOWNLOAD_START=${provisional.folderId}`);
    const { zipPath, suggestedFilename } = await downloadZipForCard({
      page,
      downloadButton,
      config,
      logger,
      tempDownloadDir,
      tenderId: provisional.folderId,
    });

    const ids = deriveBidassistIds({
      detailUrl: info.tenderDetailUrl,
      zipFileName: suggestedFilename,
      title: info.title,
      authority: info.authority,
      closingDate: info.closingDate,
    });

    // If ZIP name yields a better id, rename folder when still provisional
    let tenderFolder = folder;
    if (
      ids.folderId !== provisional.folderId &&
      !fs.existsSync(tenderFolderPath(dayRoot, ids.folderId))
    ) {
      const nextFolder = tenderFolderPath(dayRoot, ids.folderId);
      fs.renameSync(folder, nextFolder);
      tenderFolder = nextFolder;
      attemptedIds.add(ids.folderId);
    }

    const originalZipFile = storeOriginalZip({
      tempZipPath: zipPath,
      tenderFolder,
      suggestedFilename,
    });
    logger.info(`BIDASSIST_DOWNLOAD_COMPLETE=${ids.folderId}`);

    saveDownloadState(tenderFolder, {
      folderId: ids.folderId,
      bidassistId: ids.bidassistId,
      status: "downloaded",
      title: info.title,
      tenderDetailUrl: info.tenderDetailUrl || null,
      originalZipFile,
      updatedAt: new Date().toISOString(),
      error: null,
    });

    const originalPath = path.join(tenderFolder, "original", originalZipFile);
    const documents = await extractAndPrefixDocuments({
      zipPath: originalPath,
      tenderFolder,
      logger,
    });

    saveDownloadState(tenderFolder, {
      folderId: ids.folderId,
      bidassistId: ids.bidassistId,
      status: "extracted",
      title: info.title,
      tenderDetailUrl: info.tenderDetailUrl || null,
      originalZipFile,
      updatedAt: new Date().toISOString(),
      error: null,
    });

    const listingMetadata = writeBidassistMetadata({
      tenderFolder,
      card: info,
      bidassistId: ids.bidassistId,
      folderId: ids.folderId,
      originalZipFile,
      documents,
      openingDateFilterFrom: openingDateFromIso(
        process.env.BIDASSIST_OPENING_DATE_FROM || config.openingDateFrom,
      ),
      openingDateFilterTo: config.openingDateTo
        ? openingDateFromIso(config.openingDateTo)
        : null,
      category: config.category,
      logger,
    });

    logger.info(`BIDASSIST_DOCUMENT_EXTRACTION_START=${ids.bidassistId}`);
    const extractedDocumentPaths = documents.map((doc) =>
      path.join(tenderFolder, "documents", doc.storedName),
    );
    const documentMetadata = await extractBidAssistDocumentMetadata({
      tenderFolder,
      extractedDocumentPaths,
      listingMetadata: listingMetadata as unknown as Record<string, unknown>,
    });

    const htmlFieldCount = documentMetadata.extractionSources
      .filter((s) => s.fileType === "HTML")
      .reduce((n, s) => n + s.extractedFields.length, 0);
    const pdfFieldCount = documentMetadata.extractionSources
      .filter((s) => s.fileType === "PDF")
      .reduce((n, s) => n + s.extractedFields.length, 0);
    logger.info(`BIDASSIST_HTML_METADATA_EXTRACTED=${htmlFieldCount}`);
    logger.info(`BIDASSIST_PDF_METADATA_EXTRACTED=${pdfFieldCount}`);

    const mergedRecord = mergeBidAssistMetadata({
      listingMetadata: listingMetadata as unknown as Record<string, unknown>,
      documentMetadata,
    });
    const metadata = mergedRecord as unknown as BidassistMetadata;

    logger.info(
      `BIDASSIST_TENDER_VALUE_TEXT=${metadata.tenderValueText ?? "null"}`,
    );
    logger.info(
      `BIDASSIST_TENDER_VALUE_NUMERIC=${metadata.tenderValue ?? "null"}`,
    );
    logger.info(`BIDASSIST_EMD_TEXT=${metadata.emdText ?? "null"}`);
    logger.info(`BIDASSIST_EMD_NUMERIC=${metadata.emdAmount ?? "null"}`);
    logger.info(`BIDASSIST_METADATA_MERGED=${ids.bidassistId}`);

    // Persist enriched local metadata when KEEP_LOCAL_METADATA_JSON is set
    if (
      process.env.KEEP_LOCAL_METADATA_JSON?.trim().toLowerCase() === "true" ||
      process.env.KEEP_LOCAL_METADATA_JSON?.trim() === "1"
    ) {
      fs.writeFileSync(
        path.join(tenderFolder, "metadata.json"),
        JSON.stringify(metadata, null, 2),
        "utf8",
      );
    }

    const sync = await upsertBidassistMetadata({
      metadata,
      localFolderPath: tenderFolder,
      documentArchiveAvailable:
        Boolean(originalZipFile) && documents.length > 0,
      logger,
    });

    if (sync.ok) {
      if (sync.id) {
        await runAndPersistPrescreen({
          tenderId: sync.id,
          sourcePortal: "BIDASSIST",
          sourceTenderId: ids.bidassistId,
          input: buildBidassistPrescreenInput(
            metadata,
            Boolean(originalZipFile) && documents.length > 0,
          ),
          metadataHash: sync.contentHash,
          logger,
        });
      }
      const verified = await verifyBidassistMetadataRow(ids.bidassistId);
      if (verified.ok) {
        logger.info(`SUPABASE_TENDER_VERIFIED=BA-${ids.bidassistId}`);
      } else {
        logger.warn(
          `SUPABASE_TENDER_VERIFY_FAILED=BA-${ids.bidassistId} ${verified.error}`,
        );
      }
    }

    fs.writeFileSync(
      path.join(tenderFolder, "agenttender-metadata-sync.json"),
      JSON.stringify(
        {
          sourcePortal: "BIDASSIST",
          sourceTenderId: ids.bidassistId,
          contentHash: sync.contentHash,
          syncedAt: new Date().toISOString(),
          ok: sync.ok,
          error: sync.error,
          databaseId: sync.id,
          tenderValue: metadata.tenderValue ?? null,
          emdAmount: metadata.emdAmount ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );

    if (!sync.ok) {
      logger.error(
        `SUPABASE_METADATA_UPSERT_FAILED=${ids.folderId} ${sync.error}`,
      );
      if (isSupabaseRequired()) {
        saveDownloadState(tenderFolder, {
          folderId: ids.folderId,
          bidassistId: ids.bidassistId,
          status: "failed",
          title: info.title,
          tenderDetailUrl: info.tenderDetailUrl || null,
          originalZipFile,
          updatedAt: new Date().toISOString(),
          error: sync.error || "Supabase metadata upsert failed",
        });
        return "failed";
      }
    }

    saveDownloadState(tenderFolder, {
      folderId: ids.folderId,
      bidassistId: ids.bidassistId,
      status: "completed",
      title: info.title,
      tenderDetailUrl: info.tenderDetailUrl || null,
      originalZipFile,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    });

    logger.info(`BIDASSIST_TENDER_COMPLETE=${position} id=${ids.folderId}`);
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`BIDASSIST_TENDER_FAILED=${provisional.folderId}: ${message}`);
    saveDownloadState(folder, {
      ...(loadDownloadState(folder) || {
        folderId: provisional.folderId,
        bidassistId: provisional.bidassistId,
        status: "failed",
        updatedAt: new Date().toISOString(),
      }),
      folderId: provisional.folderId,
      bidassistId: provisional.bidassistId,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    });
    await saveFailureScreenshot({
      page,
      folderId: `download-${provisional.folderId}`,
      logger,
    });
    if (!config.continueOnError) {
      throw error;
    }
    return "failed";
  }
}

export async function runBidassistCrawl(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
  limit: number;
}): Promise<BidassistCrawlSummary> {
  const { page, config, logger, limit } = options;
  const dayRoot = bidassistDayRoot(config);
  ensureDir(dayRoot);
  const tempDownloadDir = path.join(dayRoot, ".playwright-downloads");
  ensureDir(tempDownloadDir);

  const opened = await openIndianActiveTenders({ page, config, logger });
  await ensureCategorySelected({
    page,
    config,
    logger,
    categoryRouteApplied: opened.categoryRouteApplied,
  });
  try {
    await applyOpeningDateFilter({
      page,
      openingDateFrom: config.openingDateFrom,
      openingDateTo: config.openingDateTo,
      logger,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`BIDASSIST_OPENING_DATE_FILTER_FAILED=${message}`);
    await saveFailureScreenshot({ page, folderId: "opening-date", logger });
    throw error instanceof AutomationError
      ? error
      : new AutomationError("BIDASSIST_OPENING_DATE_FILTER_NOT_APPLIED", message);
  }

  let resultsUrl = page.url();
  let currentPageNumber =
    (await getCurrentPaginationPage(page)) ?? 1;
  let currentPageUrl = resultsUrl;
  let processedCount = 0;
  let totalDiscovered = 0;
  let duplicateSkipped = 0;
  let pagesVisited = 0;

  const discoveredCardKeys = new Set<string>();
  const attemptedIds = new Set<string>();
  const selectedTenders: DiscoveredBidassistTender[] = [];

  const summary: BidassistCrawlSummary = {
    discovered: 0,
    selected: 0,
    completed: 0,
    skippedExisting: 0,
    duplicateSkipped: 0,
    failed: 0,
    notDownloaded: 0,
    pagesVisited: 0,
    lastPageVisited: currentPageNumber,
  };

  // Strictly sequential across pages: finish every card on the page before Next
  while (shouldContinuePagination({ processedCount, limit })) {
    pagesVisited += 1;
    currentPageNumber =
      (await getCurrentPaginationPage(page)) ?? currentPageNumber;
    currentPageUrl = page.url();
    resultsUrl = currentPageUrl;
    logger.info(`BIDASSIST_CURRENT_PAGE=${currentPageNumber}`);

    await waitForTenderResultsReady({
      page,
      config,
      logger,
      pageNumber: currentPageNumber,
    });

    let { pageTenders, duplicatesOnPage } =
      await discoverTenderCardsOnCurrentPage({
        page,
        logger,
        discoveredCardKeys,
        startIndex: totalDiscovered,
      });
    duplicateSkipped += duplicatesOnPage;

    const health = await assertPageDiscoveryHealthy({
      page,
      logger,
      pageTenderCount: pageTenders.length,
    });
    if (health === "ok" && pageTenders.length === 0) {
      // Visible downloads appeared after the settle wait — rediscover once
      ({ pageTenders, duplicatesOnPage } = await discoverTenderCardsOnCurrentPage({
        page,
        logger,
        discoveredCardKeys,
        startIndex: totalDiscovered,
      }));
      duplicateSkipped += duplicatesOnPage;
    }

    totalDiscovered += pageTenders.length;
    const slots = remainingSlots({ processedCount, limit });
    const pageQueue =
      slots === Number.POSITIVE_INFINITY
        ? pageTenders
        : pageTenders.slice(0, slots);

    for (const tender of pageQueue) {
      if (!shouldContinuePagination({ processedCount, limit })) {
        break;
      }

      if (discoveredCardKeys.has(tender.cardKey)) {
        duplicateSkipped += 1;
        logger.info(`BIDASSIST_DUPLICATE_SKIPPED=${tender.cardKey}`);
        continue;
      }
      discoveredCardKeys.add(tender.cardKey);
      selectedTenders.push(tender);
      processedCount += 1;

      const positionLabel =
        limit > 0
          ? `${processedCount}/${limit}`
          : `${processedCount}`;

      const outcome = await processBidassistTender({
        page,
        tender,
        position: positionLabel,
        config,
        dayRoot,
        tempDownloadDir,
        logger,
        attemptedIds,
      });

      if (outcome === "completed") summary.completed += 1;
      else if (outcome === "skipped") summary.skippedExisting += 1;
      else summary.failed += 1;

      if (shouldContinuePagination({ processedCount, limit })) {
        await restoreResultsPage({
          page,
          config,
          logger,
          resultsUrl,
          expectedPage: currentPageNumber,
        });
      }
    }

    summary.lastPageVisited = currentPageNumber;

    if (!shouldContinuePagination({ processedCount, limit })) {
      break;
    }

    if (pageTenders.length === 0 && health === "empty") {
      const movedEmpty = await moveToNextBidAssistPage({
        page,
        currentPageNumber,
        firstCardKey: await getFirstTenderCardKey(page),
        logger,
        getFirstCardKey: () => getFirstTenderCardKey(page),
      });
      if (!movedEmpty.moved) {
        if (movedEmpty.reason === "unchanged") {
          await saveFailureScreenshot({
            page,
            folderId: `pagination-page-${currentPageNumber}`,
            logger,
          });
        }
        break;
      }
      currentPageNumber = movedEmpty.toPage ?? currentPageNumber + 1;
      continue;
    }

    const firstCardKey = await getFirstTenderCardKey(page);
    const moved = await moveToNextBidAssistPage({
      page,
      currentPageNumber,
      firstCardKey,
      logger,
      getFirstCardKey: () => getFirstTenderCardKey(page),
    });

    if (!moved.moved) {
      if (moved.reason === "unchanged") {
        await saveFailureScreenshot({
          page,
          folderId: `pagination-page-${currentPageNumber}`,
          logger,
        });
      }
      break;
    }

    currentPageNumber = moved.toPage ?? currentPageNumber + 1;
  }

  summary.discovered = totalDiscovered;
  summary.selected = selectedTenders.length;
  summary.duplicateSkipped = duplicateSkipped;
  summary.pagesVisited = pagesVisited;
  summary.notDownloaded = Math.max(
    0,
    summary.selected -
      summary.completed -
      summary.skippedExisting -
      summary.failed,
  );

  logger.info(`BIDASSIST_TENDERS_DISCOVERED=${summary.discovered}`);
  logger.info(`BIDASSIST_TENDERS_SELECTED=${summary.selected}`);
  return summary;
}

/** Return to the same filtered results page after a download or detail detour. */
async function restoreResultsPage(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
  resultsUrl: string;
  expectedPage: number;
}): Promise<void> {
  const { page, config, logger, resultsUrl, expectedPage } = options;
  const base = resultsUrl.split("?")[0]!;

  if (!page.url().startsWith(base)) {
    await page
      .goto(resultsUrl, { waitUntil: "domcontentloaded", timeout: 120_000 })
      .catch(() => undefined);
  }

  await waitForBidassistResults(page, logger);
  await verifyResultsFilters({
    page,
    config,
    logger,
    requireOpeningDate: true,
  });

  const active = await getCurrentPaginationPage(page);
  if (active !== null) {
    logger.info(`BIDASSIST_CURRENT_PAGE=${active}`);
  } else {
    logger.info(`BIDASSIST_CURRENT_PAGE=${expectedPage}`);
  }
}
