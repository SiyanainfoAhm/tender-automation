import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import {
  assertSameBrowserContext,
  ensureTender247DetailAuthenticated,
} from "./ensureTender247LoggedIn.js";
import type { TenderListItem } from "./types.js";

export interface OpenSingleTenderResult {
  page: Page;
  item: TenderListItem;
}

interface SvgCandidate {
  index: number;
  locator: Locator;
  centerX: number;
  centerY: number;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Direct single-tender open — never touches Today/Closed dashboard selection.
 * Confirmed live: eye icon opens a NEW TAB in the same BrowserContext.
 *
 * Flow: dismiss promo → minimize chat → find ID → complete bordered row →
 * lower-right SVG geometry (heart|eye|share) → middle = eye → new tab.
 */
export async function openSingleTenderDirectly(
  page: Page,
  context: BrowserContext,
  requestedT247Id: string,
  config: AppConfig,
  logger: Logger,
): Promise<OpenSingleTenderResult> {
  const id = requestedT247Id.replace(/\D/g, "");
  if (!id) {
    throw new AutomationError(
      "TENDER247_REQUESTED_TENDER_NOT_FOUND",
      "Requested T247 ID is empty",
    );
  }

  await dismissTender247BlockingOverlays(page, logger, config);
  await dismissTender247SupportChat(page, logger);

  const idRegex = new RegExp(`T247\\s*ID\\s*[-:]?\\s*${id}\\b`, "i");
  const idLocator = page.getByText(idRegex).first();

  try {
    await idLocator.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    logger.info(`T247-${id} not initially visible; scrolling to find`);
    await scrollUntilIdVisible(page, idLocator, logger);
  }

  logger.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);

  const completeTenderRow = await resolveCompleteTenderRow(idLocator, id, logger);

  // Minimize support chat before view-control detection (can overlay right icons)
  await dismissTender247SupportChat(page, logger);
  await completeTenderRow.waitFor({ state: "visible", timeout: 5_000 });

  const viewControl = await findEyeByLowerRightGeometry(
    page,
    completeTenderRow,
    id,
    logger,
  );

  const detailPagePromise = context.waitForEvent("page", { timeout: 15_000 });
  try {
    await viewControl.click({ timeout: 5_000 });
  } catch {
    logger.warn("Normal click failed/intercepted; retrying with force:true");
    await viewControl.click({ timeout: 5_000, force: true });
  }
  logger.info("TENDER247_VIEW_CLICKED");

  const detailPage = await detailPagePromise;
  await detailPage
    .waitForLoadState("domcontentloaded", { timeout: config.pageTimeoutMs })
    .catch(() => undefined);
  detailPage.setDefaultTimeout(config.pageTimeoutMs);
  assertSameBrowserContext(detailPage, context, logger, `T247-${id} detail tab`);
  logger.info(`TENDER247_DETAIL_NEW_TAB_OPENED url=${detailPage.url()}`);

  await dismissTender247BlockingOverlays(detailPage, logger, config);
  await dismissTender247SupportChat(detailPage, logger);
  await ensureTender247DetailAuthenticated(detailPage, context, logger, config);
  await waitForAnyDetailMarker(
    detailPage,
    Math.min(config.pageTimeoutMs, 30_000),
    logger,
  );
  logger.info("TENDER247_DETAIL_PAGE_OPENED");

  const listTitle = await readCardTitle(completeTenderRow);
  const listClosingDate = await readCardClosingDate(completeTenderRow);

  return {
    page: detailPage,
    item: {
      t247Id: id,
      detailUrl: detailPage.url(),
      listTitle,
      listClosingDate,
    },
  };
}

async function scrollUntilIdVisible(
  page: Page,
  idLocator: Locator,
  logger: Logger,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    if (await idLocator.isVisible().catch(() => false)) {
      return;
    }
    await page.mouse.wheel(0, Math.max(700, 800));
    await page.waitForTimeout(400);
  }
  await idLocator.waitFor({ state: "visible", timeout: 5_000 });
  logger.info("Requested ID became visible after scroll");
}

/**
 * Extract T247 IDs from text. Digits must follow "T247 ID", never the "247" in "T247".
 * "T247 ID- 101466917" → ["101466917"]
 */
function extractT247Ids(text: string): string[] {
  const ids: string[] = [];
  const regex = /T247\s*ID\s*[-:]?\s*(\d+)/gi;

  for (const match of text.matchAll(regex)) {
    const id = match[1];
    if (id) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Outer bordered tender row (≈1010x136), NOT the left 791px content card.
 * Uses Playwright locators only — no page.evaluate.
 */
async function resolveCompleteTenderRow(
  idLocator: Locator,
  id: string,
  logger: Logger,
): Promise<Locator> {
  const candidate = idLocator.locator(
    'xpath=ancestor::div[contains(@class,"border") and contains(@class,"w-full")][1]',
  );

  const visible = await candidate.isVisible().catch(() => false);
  if (!visible) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      "Could not identify full tender row (bordered w-full ancestor not visible)",
    );
  }

  const rowBox = await candidate.boundingBox();
  const rowText = ((await candidate.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const ids = extractT247Ids(rowText);
  const uniqueIds = Array.from(new Set(ids));
  logger.info(`COMPLETE_ROW_T247_IDS=${JSON.stringify(uniqueIds)}`);

  const svgCount = await candidate.locator("svg").count();

  if (!rowBox || svgCount < 4 || rowBox.width < 850) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      `Could not identify full tender row (box=${rowBox ? `${Math.round(rowBox.width)}x${Math.round(rowBox.height)}` : "null"}, svg=${svgCount})`,
    );
  }

  if (uniqueIds.length !== 1 || uniqueIds[0] !== id) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      `Complete row T247 ID mismatch: expected ${id}, got ${JSON.stringify(uniqueIds)}`,
    );
  }

  logger.info("TENDER247_COMPLETE_ROW_FOUND");
  logger.info(
    `COMPLETE_ROW_SIZE=${Math.round(rowBox.width)}x${Math.round(rowBox.height)}`,
  );
  logger.info(`COMPLETE_ROW_SVG_COUNT=${svgCount}`);

  return candidate;
}

/**
 * Detect eye/view via lower-right SVG geometry inside the complete tender row.
 * TOP right = Reminders mail/WhatsApp; BOTTOM right = heart | eye | share.
 * No page.evaluate / locator.evaluate.
 */
async function findEyeByLowerRightGeometry(
  page: Page,
  completeTenderRow: Locator,
  id: string,
  logger: Logger,
): Promise<Locator> {
  const rowBox = await completeTenderRow.boundingBox();
  if (!rowBox) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_BOX_MISSING",
      "Complete tender row has no bounding box",
    );
  }

  const svgs = completeTenderRow.locator("svg");
  const svgCount = await svgs.count();
  logger.info(`TENDER247_COMPLETE_ROW_SVG_COUNT=${svgCount}`);

  const allSvgInfo: SvgCandidate[] = [];
  for (let i = 0; i < svgCount; i += 1) {
    const svg = svgs.nth(i);
    const box = await svg.boundingBox().catch(() => null);
    if (!box) {
      logger.info(`ROW_SVG[${i}] no-bounding-box`);
      continue;
    }

    const aria = (await svg.getAttribute("aria-label").catch(() => null)) || "";
    const title = (await svg.getAttribute("title").catch(() => null)) || "";
    const className = (await svg.getAttribute("class").catch(() => null)) || "";
    const parentClass =
      (await svg
        .locator("xpath=..")
        .getAttribute("class")
        .catch(() => null)) || "";
    const grandparentClass =
      (await svg
        .locator("xpath=../..")
        .getAttribute("class")
        .catch(() => null)) || "";

    logger.info(
      `ROW_SVG[${i}] x=${Math.round(box.x)} y=${Math.round(box.y)} width=${Math.round(box.width)} height=${Math.round(box.height)} aria="${aria}" title="${title}" class="${className}" parentClass="${parentClass}" grandparentClass="${grandparentClass}"`,
    );

    if (!(await svg.isVisible().catch(() => false))) {
      continue;
    }

    allSvgInfo.push({
      index: i,
      locator: svg,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
      box,
    });
  }

  const rightThreshold = rowBox.x + rowBox.width * 0.65;
  const lowerThreshold = rowBox.y + rowBox.height * 0.45;

  let lowerRight = allSvgInfo.filter(
    (c) => c.centerX > rightThreshold && c.centerY > lowerThreshold,
  );

  logger.info(`TENDER247_LOWER_RIGHT_SVG_CANDIDATES=${lowerRight.length}`);

  // Current Tender247 UI often shows a single lower-right view control
  // (bordered cursor-pointer box) instead of heart|eye|share trio.
  if (lowerRight.length === 1) {
    const only = lowerRight[0]!;
    logger.info("TENDER247_VIEW_CONTROL_SELECTED_SINGLE_LOWER_RIGHT");
    return resolveClickableWrapper(only.locator, logger);
  }

  if (lowerRight.length === 2) {
    // Prefer the rightmost (typically the view/eye after heart)
    const sorted = [...lowerRight].sort((a, b) => a.centerX - b.centerX);
    const eyeSvg = sorted[sorted.length - 1]!;
    logger.info("TENDER247_VIEW_CONTROL_SELECTED_FROM_PAIR");
    return resolveClickableWrapper(eyeSvg.locator, logger);
  }

  if (lowerRight.length === 0) {
    // Fallback: any right-side cursor-pointer SVG in the row (view button)
    const rightSide = allSvgInfo.filter((c) => c.centerX > rightThreshold);
    for (const candidate of [...rightSide].sort((a, b) => b.centerY - a.centerY)) {
      const parentClass =
        (await candidate.locator
          .locator("xpath=..")
          .getAttribute("class")
          .catch(() => null)) || "";
      const grandparentClass =
        (await candidate.locator
          .locator("xpath=../..")
          .getAttribute("class")
          .catch(() => null)) || "";
      if (
        /cursor-pointer/i.test(parentClass) ||
        /cursor-pointer/i.test(grandparentClass) ||
        /border/.test(grandparentClass)
      ) {
        logger.info("TENDER247_VIEW_CONTROL_SELECTED_RIGHT_CURSOR_FALLBACK");
        return resolveClickableWrapper(candidate.locator, logger);
      }
    }

    await saveViewControlDebugArtifacts(page, completeTenderRow, id, logger);
    throw new AutomationError(
      "TENDER247_VIEW_CONTROL_NOT_FOUND",
      `No lower-right SVG candidates in complete tender row for T247-${id}`,
    );
  }

  if (lowerRight.length > 3) {
    lowerRight = pickLowestTightTrio(lowerRight, logger);
  }

  if (lowerRight.length < 3) {
    // Prefer rightmost among remaining lower-right icons
    const sorted = [...lowerRight].sort((a, b) => a.centerX - b.centerX);
    const eyeSvg = sorted[sorted.length - 1]!;
    logger.info(
      `TENDER247_VIEW_CONTROL_SELECTED_RIGHTMOST_OF_${lowerRight.length}`,
    );
    return resolveClickableWrapper(eyeSvg.locator, logger);
  }

  // Exactly 3 (or reduced to 3): sort left-to-right → index 1 = eye
  const trio = lowerRight.slice(0, 3).sort((a, b) => a.centerX - b.centerX);
  const eyeSvg = trio[1]!;
  logger.info("TENDER247_VIEW_CONTROL_SELECTED_BY_GEOMETRY");
  logger.info("VIEW_CONTROL_INDEX=1");
  logger.info("TENDER247_VIEW_BUTTON_FOUND_BY_ACTION_GROUP");

  let viewControl = await resolveClickableWrapper(eyeSvg.locator, logger);

  const viewBox = await viewControl.boundingBox();
  if (!viewBox) {
    await saveViewControlDebugArtifacts(page, completeTenderRow, id, logger);
    throw new AutomationError(
      "TENDER247_VIEW_CONTROL_NOT_FOUND",
      `Selected view control has no bounding box for T247-${id}`,
    );
  }

  const viewCenterX = viewBox.x + viewBox.width / 2;
  const viewCenterY = viewBox.y + viewBox.height / 2;
  if (viewCenterX <= rightThreshold || viewCenterY <= lowerThreshold) {
    // Wrapper drifted — fall back to the SVG itself
    logger.warn("Clickable wrapper left lower-right area; using eye SVG");
    viewControl = eyeSvg.locator;
  }

  const finalBox = (await viewControl.boundingBox()) ?? viewBox;
  logger.info(
    `TENDER247_VIEW_CONTROL_BOX=${Math.round(finalBox.x)},${Math.round(finalBox.y)},${Math.round(finalBox.width)},${Math.round(finalBox.height)}`,
  );

  return viewControl;
}

/**
 * When >3 lower-right SVGs (Reminders mail/WhatsApp above heart|eye|share),
 * pick the lowest vertically-tight group of 3.
 */
function pickLowestTightTrio(
  candidates: SvgCandidate[],
  logger: Logger,
): SvgCandidate[] {
  const sortedY = [...candidates].sort((a, b) => a.centerY - b.centerY);
  let best: SvgCandidate[] = sortedY.slice(-3);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= sortedY.length - 3; i += 1) {
    const group = sortedY.slice(i, i + 3);
    const ySpread = group[2]!.centerY - group[0]!.centerY;
    const avgY =
      (group[0]!.centerY + group[1]!.centerY + group[2]!.centerY) / 3;
    // Prefer tight vertical clusters that sit lowest in the row
    const score = ySpread * 10 - avgY;
    if (ySpread < 40 && score < bestScore) {
      bestScore = score;
      best = group;
    }
  }

  // Also try: among candidates, take the 3 with highest centerY (lowest on screen)
  const byLowest = [...candidates]
    .sort((a, b) => b.centerY - a.centerY)
    .slice(0, 3);
  const lowestSpread =
    Math.max(...byLowest.map((c) => c.centerY)) -
    Math.min(...byLowest.map((c) => c.centerY));
  if (lowestSpread < 40) {
    const avgY =
      byLowest.reduce((s, c) => s + c.centerY, 0) / byLowest.length;
    const score = lowestSpread * 10 - avgY;
    if (score < bestScore) {
      best = byLowest;
    }
  }

  logger.info(
    `Reduced ${candidates.length} lower-right SVGs to lowest tight trio (indexes=${best.map((c) => c.index).join(",")})`,
  );
  return best;
}

/**
 * Prefer a single-icon clickable ancestor; never a wrapper containing all 3 icons.
 * SVG itself is an acceptable final fallback (click bubbles).
 */
async function resolveClickableWrapper(
  eyeSvg: Locator,
  logger: Logger,
): Promise<Locator> {
  const semanticParent = eyeSvg.locator(
    'xpath=ancestor::*[self::button or self::a or @role="button" or @tabindex or contains(@class,"cursor-pointer")][1]',
  );

  const count = await semanticParent.count().catch(() => 0);
  if (count > 0) {
    const parent = semanticParent.first();
    if (await parent.isVisible().catch(() => false)) {
      const wrappedSvgs = await parent.locator("svg").count();
      const box = await parent.boundingBox().catch(() => null);
      // Reject wrappers that include the whole heart|eye|share trio
      if (wrappedSvgs < 3 && box && box.width <= 80 && box.height <= 80) {
        logger.info(
          `View clickable wrapper found (wrappedSvgs=${wrappedSvgs})`,
        );
        return parent;
      }
      logger.warn(
        `Ancestor too broad (svgs=${wrappedSvgs}); using eye SVG directly`,
      );
    }
  }

  return eyeSvg;
}

async function saveViewControlDebugArtifacts(
  page: Page,
  completeTenderRow: Locator,
  id: string,
  logger: Logger,
): Promise<void> {
  try {
    const debugDir = resolveProjectPath("debug");
    ensureDir(debugDir);

    const rowHtml = await completeTenderRow.innerHTML().catch(() => "");
    const htmlPath = path.join(debugDir, `T247-${id}-complete-row.html`);
    fs.writeFileSync(htmlPath, rowHtml, "utf8");
    logger.info(`Saved complete-row HTML: ${htmlPath}`);

    const rowShot = path.join(debugDir, `T247-${id}-complete-row.png`);
    await completeTenderRow.screenshot({ path: rowShot }).catch(() => undefined);
    logger.info(`Saved complete-row screenshot: ${rowShot}`);

    const pageShot = path.join(debugDir, `T247-${id}-full-page.png`);
    await page.screenshot({ path: pageShot, fullPage: true }).catch(() => undefined);
    logger.info(`Saved full-page screenshot: ${pageShot}`);
  } catch (error) {
    logger.warn(
      `Failed to save view-control debug artifacts: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function waitForAnyDetailMarker(
  page: Page,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const markers = [
      page.getByText(/^Brief$/i).first(),
      page.getByText(/^Description$/i).first(),
      page.getByText(/Submission\s*Date/i).first(),
      page.getByText(/Tender\s*Documents/i).first(),
      page.getByText(/AI\s*Generated\s*Tender\s*Summary/i).first(),
    ];
    for (const m of markers) {
      if (await m.isVisible().catch(() => false)) {
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  logger.warn("No detail markers yet; continuing");
}

async function readCardTitle(card: Locator): Promise<string | null> {
  const heading = card.locator("h1, h2, h3, h4, a").first();
  if (!(await heading.isVisible().catch(() => false))) {
    return null;
  }
  const text = ((await heading.innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /T247\s*ID/i.test(text)) {
    return null;
  }
  return text.slice(0, 300);
}

async function readCardClosingDate(card: Locator): Promise<string | null> {
  const text = ((await card.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = text.match(
    /(?:closing|submission|due)[:\s-]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
  );
  return match?.[1] ?? null;
}
