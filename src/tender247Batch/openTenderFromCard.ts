import type { BrowserContext, Locator, Page, Request } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import {
  assertSameBrowserContext,
  ensureTender247DetailAuthenticated,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import {
  getLiveRowByMarker,
  parseSecurityCodeFromUrl,
  type LiveTenderCard,
} from "./liveListCards.js";

export interface OpenedLiveTender {
  detailPage: Page;
  t247Id: string;
  securityCode: string | null;
  detailUrl: string;
  securityCodeCaptured: boolean;
}

/**
 * Open a tender detail tab from a currently rendered live list card.
 * Captures security_code only from real navigation URL / detail API requests.
 */
export async function openTenderFromLiveCard(
  listPage: Page,
  context: BrowserContext,
  card: LiveTenderCard,
  config: AppConfig,
  logger: Logger,
): Promise<OpenedLiveTender> {
  const t247Id = card.t247Id;
  let securityCode: string | null = card.securityCodeFromHref;
  const capturedCodes = new Set<string>();
  if (securityCode) {
    capturedCodes.add(securityCode);
  }

  const onRequest = (req: Request): void => {
    const url = req.url();
    const fromUrl = parseSecurityCodeFromUrl(url);
    if (fromUrl) {
      capturedCodes.add(fromUrl);
    }
    if (
      url.includes(`/tender-detail/${t247Id}`) ||
      url.includes(`/tender-document-list/${t247Id}`)
    ) {
      const body = req.postData() || "";
      try {
        const parsed = JSON.parse(body) as { security_code?: string };
        if (parsed.security_code && typeof parsed.security_code === "string") {
          capturedCodes.add(parsed.security_code);
        }
      } catch {
        const m = body.match(/"security_code"\s*:\s*"([^"]+)"/);
        if (m?.[1]) {
          capturedCodes.add(m[1]);
        }
      }
    }
  };

  context.on("request", onRequest);

  try {
    await dismissTender247Interruptions(listPage, logger, config);

    const row = await getLiveRowByMarker(listPage, card.rowMarker);
    await row.waitFor({ state: "visible", timeout: 8_000 });
    await row.scrollIntoViewIfNeeded().catch(() => undefined);

    const detailPagePromise = context.waitForEvent("page", { timeout: 15_000 });

    const opened = await tryOpenDetailControl(row, card, t247Id, logger);
    if (!opened) {
      throw new Error(
        `No detail-opening control found for T247-${t247Id} on live card`,
      );
    }

    const detailPage = await detailPagePromise;
    await detailPage
      .waitForLoadState("domcontentloaded", { timeout: config.pageTimeoutMs })
      .catch(() => undefined);
    detailPage.setDefaultTimeout(config.pageTimeoutMs);
    assertSameBrowserContext(
      detailPage,
      context,
      logger,
      `T247-${t247Id} detail tab`,
    );

    logger.info(`DETAIL_TAB_OPENED T247-${t247Id}`);
    logger.info(`DETAIL_URL=${detailPage.url()}`);

    // Wait briefly for SPA/API to fire so we can capture security_code from network
    await detailPage.waitForTimeout(1_500).catch(() => undefined);

    const fromNav = parseSecurityCodeFromUrl(detailPage.url());
    if (fromNav) {
      capturedCodes.add(fromNav);
    }

    securityCode =
      [...capturedCodes].find((c) => c.length >= 8) ??
      securityCode ??
      null;

    if (securityCode) {
      logger.info("SECURITY_CODE_CAPTURED");
    } else {
      logger.warn(
        `SECURITY_CODE_NOT_CAPTURED_YET for T247-${t247Id} (will continue UI downloads)`,
      );
    }

    await dismissTender247Interruptions(detailPage, logger, config);
    await ensureTender247DetailAuthenticated(
      detailPage,
      context,
      logger,
      config,
    );

    return {
      detailPage,
      t247Id,
      securityCode,
      detailUrl: detailPage.url(),
      securityCodeCaptured: Boolean(securityCode),
    };
  } finally {
    context.off("request", onRequest);
  }
}

async function tryOpenDetailControl(
  row: Locator,
  card: LiveTenderCard,
  t247Id: string,
  logger: Logger,
): Promise<boolean> {
  const page = row.page();
  // 1) Prefer real href if present on the card
  if (card.href) {
    const link = row.locator(`a[href*="/auth/tender/${t247Id}/"]`).first();
    if (await link.isVisible().catch(() => false)) {
      logger.info(`OPEN_VIA_HREF for T247-${t247Id}`);
      await clickControl(link, logger, page);
      return true;
    }
  }

  // 2) Corrigendum / tender-detail text link
  const corrigendum = row
    .getByRole("link", { name: /corrigendum|tender\s*detail|view\s*detail/i })
    .first();
  if (await corrigendum.isVisible().catch(() => false)) {
    logger.info(`OPEN_VIA_CORRIGENDUM_LINK for T247-${t247Id}`);
    await clickControl(corrigendum, logger, page);
    return true;
  }

  const anyCorrText = row.getByText(/Corrigendum/i).first();
  if (await anyCorrText.isVisible().catch(() => false)) {
    const clickable = anyCorrText
      .locator('xpath=ancestor-or-self::a[1] | ancestor-or-self::*[@role="button"][1]')
      .first();
    if (await clickable.count().catch(() => 0)) {
      logger.info(`OPEN_VIA_CORRIGENDUM_TEXT for T247-${t247Id}`);
      await clickControl(clickable, logger, page);
      return true;
    }
  }

  // 3) Eye / view by aria or title
  const eyeNamed = row
    .locator(
      '[aria-label*="view" i], [aria-label*="eye" i], [title*="view" i], [title*="eye" i]',
    )
    .first();
  if (await eyeNamed.isVisible().catch(() => false)) {
    logger.info(`OPEN_VIA_ARIA_VIEW for T247-${t247Id}`);
    await clickControl(eyeNamed, logger, page);
    return true;
  }

  // 4) Lower-right SVG geometry (heart | eye | share) — middle = eye
  const eyeSvg = await findEyeByLowerRightGeometry(row, t247Id, logger);
  if (eyeSvg) {
    logger.info(`OPEN_VIA_EYE_SVG for T247-${t247Id}`);
    await clickControl(eyeSvg, logger, page);
    return true;
  }

  return false;
}

async function clickControl(
  control: Locator,
  logger: Logger,
  page?: Page,
): Promise<void> {
  try {
    await control.click({ timeout: 5_000 });
  } catch {
    if (page) {
      await dismissTender247Interruptions(page, logger).catch((error) => {
        if (
          error instanceof AutomationError &&
          error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
        ) {
          throw error;
        }
      });
    }
    logger.warn("Normal click failed/intercepted; retrying with force:true");
    await control.click({ timeout: 5_000, force: true });
  }
}

interface SvgCandidate {
  index: number;
  locator: Locator;
  centerX: number;
  centerY: number;
}

async function findEyeByLowerRightGeometry(
  completeTenderRow: Locator,
  t247Id: string,
  logger: Logger,
): Promise<Locator | null> {
  const rowBox = await completeTenderRow.boundingBox();
  if (!rowBox) {
    return null;
  }

  const svgs = completeTenderRow.locator("svg");
  const svgCount = await svgs.count();
  const candidates: SvgCandidate[] = [];

  for (let i = 0; i < svgCount; i += 1) {
    const svg = svgs.nth(i);
    const box = await svg.boundingBox().catch(() => null);
    if (!box || box.width < 8 || box.height < 8) {
      continue;
    }
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const inRight = centerX >= rowBox.x + rowBox.width * 0.55;
    const inLower = centerY >= rowBox.y + rowBox.height * 0.45;
    if (!inRight || !inLower) {
      continue;
    }
    candidates.push({ index: i, locator: svg, centerX, centerY });
  }

  if (candidates.length < 3) {
    logger.warn(
      `Eye geometry: only ${candidates.length} lower-right SVGs for T247-${t247Id}`,
    );
    if (candidates.length === 0) {
      return null;
    }
    // Best effort: rightmost mid-height among candidates
    candidates.sort((a, b) => a.centerX - b.centerX);
    const mid = candidates[Math.floor(candidates.length / 2)]!;
    return mid.locator;
  }

  candidates.sort((a, b) => a.centerX - b.centerX || a.centerY - b.centerY);
  // Prefer a horizontal triplet: take three rightmost and pick middle
  const rightThree = candidates.slice(-3);
  rightThree.sort((a, b) => a.centerX - b.centerX);
  const eye = rightThree[1]!;
  logger.info(
    `Eye geometry: selected middle of right-three SVGs for T247-${t247Id}`,
  );
  return eye.locator;
}
