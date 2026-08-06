import type { Locator, Page } from "playwright";
import { AutomationError, captureErrorScreenshot } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { getTodayDisplayDateDdMmYyyy } from "../dateUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";

/**
 * Ensure the authenticated dashboard is on Today Tenders (Fresh), not Closed/Active/etc.
 *
 * Uses a DOM-based single-card finder (data-playwright-today-card) — never clicks a
 * broad parent that also contains Closed/Active cards.
 *
 * @param mode Must be "full". Passing "single" throws — single-tender mode must never call this.
 */
export async function ensureTodayTendersSelected(
  page: Page,
  logger: Logger,
  config: AppConfig,
  mode: "single" | "full",
): Promise<void> {
  if (mode === "single") {
    throw new Error("BUG_SINGLE_MODE_CALLED_ENSURE_TODAY");
  }

  logger.info("STEP_ENSURE_TODAY_1_DISMISS_OVERLAYS");
  await dismissTender247BlockingOverlays(page, logger, config);
  logger.info("STEP_ENSURE_TODAY_1B_MINIMIZE_SUPPORT_CHAT");
  await dismissTender247SupportChat(page, logger);

  logger.info("STEP_ENSURE_TODAY_2_WAIT_DASHBOARD_CARDS");
  await waitForDashboardCards(page, config.pageTimeoutMs, logger);

  // Re-check after support chat minimize — may already be on Fresh
  logger.info("STEP_ENSURE_TODAY_FAST_READY_CHECK");
  if (await isTodayFreshAlreadyReady(page)) {
    logger.info("TENDER247_TODAY_SECTION_READY");
    logger.info("TENDER247_TODAY_TENDERS_SELECTED");
    return;
  }

  // READ-ONLY diagnostics — never clicks
  await logDashboardCardDiagnostics(page, logger);

  const closedActive = await isClosedActiveQuick(page);
  if (closedActive) {
    logger.info("TENDER247_CLOSED_SECTION_DETECTED");
  }

  logger.info("STEP_ENSURE_TODAY_CLICK_SAFE_CARD");
  const todayCard = await getTodayTenderCard(page, logger);
  await validateAndClickTodayCard(todayCard, logger);

  logger.info("STEP_ENSURE_TODAY_VERIFY_AFTER_CLICK");
  await verifyFreshAfterTodayClick(page, logger, config);

  logger.info("TENDER247_TODAY_TENDERS_SELECTED");
  logger.info("TENDER247_TODAY_SECTION_READY");
}

/**
 * DOM-based Today Tenders card finder.
 * Marks the smallest safe card with data-playwright-today-card and returns that locator.
 * Never uses div.filter({hasText}) or nth indexes for dashboard cards.
 */
export async function getTodayTenderCard(
  page: Page,
  logger?: Logger,
): Promise<Locator> {
  const todayDisplayDate = getTodayDisplayDateDdMmYyyy();
  logger?.info(`Resolving Today Tenders card for date ${todayDisplayDate}`);

  // Clear any previous mark
  await page
    .evaluate(() => {
      document
        .querySelectorAll('[data-playwright-today-card="true"]')
        .forEach((el) => el.removeAttribute("data-playwright-today-card"));
    })
    .catch(() => undefined);

  const marked = await page.evaluate((todayDate: string) => {
    const forbidden = [
      "Closed Tenders",
      "Active Tenders",
      "Interested Tender",
      "Get Reminders",
    ];

    const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    const seeds: HTMLElement[] = [];
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      // Prefer leaf-ish text nodes that mention Today Tenders
      const own =
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent || "").trim())
          .join(" ") || "";
      const text = (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/Today\s*Tenders/i.test(text) && !/Today\s*Tenders/i.test(own)) {
        continue;
      }
      // Skip huge page wrappers early
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) {
        continue;
      }
      if (rect.width > 900 || rect.height > 400) {
        continue;
      }
      seeds.push(el);
    }

    let best: HTMLElement | null = null;
    let bestArea = Number.POSITIVE_INFINITY;

    for (const seed of seeds) {
      let node: HTMLElement | null = seed;
      for (let depth = 0; depth < 14 && node; depth += 1) {
        const text = (node.innerText || node.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const hasToday = /Today\s*Tenders/i.test(text);
        const hasDate = text.includes(todayDate);
        const hasForbidden = forbidden.some((f) => text.includes(f));
        const rect = node.getBoundingClientRect();
        const area = Math.max(1, rect.width * rect.height);

        // One dashboard card — not the whole row
        const reasonableBox =
          rect.width >= 80 &&
          rect.width <= 480 &&
          rect.height >= 40 &&
          rect.height <= 280;

        if (hasToday && hasDate && !hasForbidden && reasonableBox) {
          if (area < bestArea) {
            best = node;
            bestArea = area;
          }
          break; // smallest suitable ancestor for this seed
        }

        // Once text includes other cards, stop climbing this branch
        if (hasForbidden) {
          break;
        }
        node = node.parentElement;
      }
    }

    if (!best) {
      return null;
    }

    best.setAttribute("data-playwright-today-card", "true");
    return {
      text: (best.innerText || "").replace(/\s+/g, " ").trim(),
      width: Math.round(best.getBoundingClientRect().width),
      height: Math.round(best.getBoundingClientRect().height),
    };
  }, todayDisplayDate);

  if (!marked) {
    throw new AutomationError(
      "TENDER247_TODAY_CARD_NOT_FOUND",
      `Could not resolve a safe Today Tenders card for date ${todayDisplayDate} (url=${page.url()})`,
    );
  }

  logger?.info(
    `Today card marked via evaluate: box=${marked.width}x${marked.height} text="${marked.text.slice(0, 120)}"`,
  );

  const locator = page.locator('[data-playwright-today-card="true"]').first();
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  return locator;
}

async function validateAndClickTodayCard(
  todayCard: Locator,
  logger: Logger,
): Promise<void> {
  const todayDisplayDate = getTodayDisplayDateDdMmYyyy();
  const cardText = ((await todayCard.innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim();
  logger.info(`TODAY_CARD_TEXT=${cardText}`);

  if (!/Today\s*Tenders/i.test(cardText)) {
    throw new AutomationError(
      "TENDER247_TODAY_CARD_LOCATOR_TOO_BROAD",
      "Candidate Today card text does not contain Today Tenders",
    );
  }
  if (!cardText.includes(todayDisplayDate)) {
    throw new AutomationError(
      "TENDER247_TODAY_CARD_LOCATOR_TOO_BROAD",
      `Candidate Today card text does not contain today's date ${todayDisplayDate}`,
    );
  }
  if (/Closed\s*Tenders/i.test(cardText)) {
    throw new AutomationError(
      "TENDER247_TODAY_CARD_LOCATOR_TOO_BROAD",
      "Today Tenders locator resolved a container that also includes Closed Tenders",
    );
  }
  if (/Active\s*Tenders/i.test(cardText)) {
    throw new AutomationError(
      "TENDER247_TODAY_CARD_LOCATOR_TOO_BROAD",
      "Today Tenders locator resolved a container that also includes Active Tenders",
    );
  }

  const box = await todayCard.boundingBox().catch(() => null);
  logger.info(
    `TODAY_CARD_BOX=(${box ? Math.round(box.x) : "?"},${box ? Math.round(box.y) : "?"},${box ? Math.round(box.width) : "?"}x${box ? Math.round(box.height) : "?"})`,
  );

  await todayCard.click({ timeout: 10_000 });
  logger.info("TENDER247_TODAY_CLICK_ATTEMPTED");
}

async function isTodayFreshAlreadyReady(page: Page): Promise<boolean> {
  const freshVisible = await page
    .getByText(/Fresh\s*\(\s*\d+\s*\)/i)
    .first()
    .isVisible()
    .catch(() => false);
  const t247Visible = await page
    .getByText(/T247\s*ID\s*[-:]/i)
    .first()
    .isVisible()
    .catch(() => false);
  const closedActive = await isClosedActiveQuick(page);
  return freshVisible && t247Visible && !closedActive;
}

async function verifyFreshAfterTodayClick(
  page: Page,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  try {
    await Promise.race([
      page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first().waitFor({
        state: "visible",
        timeout: 15_000,
      }),
      page.getByText(/T247\s*ID\s*[-:]/i).first().waitFor({
        state: "visible",
        timeout: 15_000,
      }),
    ]);
  } catch {
    logger.warn("Fresh / T247 markers soft-timeout after Today click");
  }

  await page.waitForTimeout(500);

  const closedActive = await isClosedActiveQuick(page);
  const freshVisible = await page
    .getByText(/Fresh\s*\(\s*\d+\s*\)/i)
    .first()
    .isVisible()
    .catch(() => false);
  const t247Visible = await page
    .getByText(/T247\s*ID\s*[-:]/i)
    .first()
    .isVisible()
    .catch(() => false);
  const activeTabText = await readActiveTabText(page);
  const t247Count = t247Visible ? 1 : 0;

  logger.info(
    `Post-click verify: activeTab="${activeTabText}" closedActive=${closedActive} freshVisible=${freshVisible} t247Count=${t247Count}`,
  );

  if (closedActive || /^closed\b/i.test(activeTabText)) {
    await captureErrorScreenshot(
      page,
      config.screenshotRoot,
      "Tender247",
      "TENDER247_WRONG_SECTION_SELECTED",
      logger,
    );
    throw new AutomationError(
      "TENDER247_WRONG_SECTION_SELECTED",
      "Closed Tenders became active after attempting to click Today Tenders",
    );
  }

  if (freshVisible && t247Count > 0 && !closedActive) {
    return;
  }

  await failTodaySectionNotSelected(page, logger, config, {
    activeTabText,
    todayCardVisible: true,
    todayCardClicked: true,
    freshVisible,
    t247IdCount: t247Count,
  });
}

/**
 * READ-ONLY dashboard diagnostics — never clicks.
 */
async function logDashboardCardDiagnostics(
  page: Page,
  logger: Logger,
): Promise<void> {
  const labels = [
    /Mail\s*Date/i,
    /Today\s*Tenders/i,
    /Active\s*Tenders/i,
    /Closed\s*Tenders/i,
    /Interested\s*Tender/i,
    /Get\s*Reminders/i,
  ];

  logger.info("=== Dashboard card label diagnostics (read-only) ===");
  for (const pattern of labels) {
    try {
      const el = page.getByText(pattern).first();
      const visible = await el.isVisible().catch(() => false);
      if (!visible) {
        logger.info(`cardLabel=${pattern} visible=false`);
        continue;
      }
      const box = await el.boundingBox().catch(() => null);
      const info = await el
        .evaluate((node: Element) => {
          const parent = node.parentElement;
          return {
            text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            className: String((node as HTMLElement).className || "").slice(0, 80),
            aria: node.getAttribute("aria-label"),
            parentTag: parent?.tagName?.toLowerCase() ?? null,
            parentClass: String(parent?.className || "").slice(0, 120),
            parentText: (parent?.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200),
          };
        })
        .catch(() => null);

      logger.info(
        `cardLabel visible=true text="${info?.text ?? ""}" class="${info?.className ?? ""}" aria="${info?.aria}" box=(${box ? Math.round(box.x) : "?"},${box ? Math.round(box.y) : "?"},${box ? Math.round(box.width) : "?"}x${box ? Math.round(box.height) : "?"}) parentTag=${info?.parentTag} parentClass="${info?.parentClass}" parentText="${info?.parentText}"`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`card diagnostics failed for ${pattern}: ${message}`);
    }
  }
  logger.info("=== end dashboard card diagnostics ===");
}

async function isClosedActiveQuick(page: Page): Promise<boolean> {
  const yearVisible = await page
    .getByText(/^202\d$/)
    .first()
    .isVisible()
    .catch(() => false);

  const closedTab = page.getByText(/^Closed(\s*\(|$)/i).first();
  const closedSelected =
    (await closedTab.getAttribute("aria-selected").catch(() => null)) === "true" ||
    /active|selected/i.test((await closedTab.getAttribute("class").catch(() => "")) ?? "");

  // Year dropdown + Closed tab selected, or Closed tab text alone when Fresh badge absent
  if (yearVisible && closedSelected) {
    return true;
  }

  const freshVisible = await page
    .getByText(/Fresh\s*\(\s*\d+\s*\)/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (yearVisible && !freshVisible) {
    return true;
  }

  const activeTabText = await readActiveTabText(page);
  return /^closed\b/i.test(activeTabText);
}

async function waitForDashboardCards(
  page: Page,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  try {
    await Promise.race([
      page.getByText(/Today\s*Tenders/i).first().waitFor({
        state: "visible",
        timeout: Math.min(timeoutMs, 20_000),
      }),
      page.getByText(/Closed\s*Tenders/i).first().waitFor({
        state: "visible",
        timeout: Math.min(timeoutMs, 20_000),
      }),
      page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first().waitFor({
        state: "visible",
        timeout: Math.min(timeoutMs, 20_000),
      }),
    ]);
  } catch {
    logger.warn("Dashboard cards soft-timeout; continuing Today Tenders selection");
  }
}

async function readActiveTabText(page: Page): Promise<string> {
  const selected = page.locator(
    '[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], button[aria-pressed="true"], .active[role="tab"], [class*="tab" i][class*="active" i]',
  );
  if (await selected.first().isVisible().catch(() => false)) {
    return ((await selected.first().innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  for (const label of ["Closed", "Fresh", "Active", "Interested", "Reminders"]) {
    const el = page.getByText(new RegExp(`^${label}(\\s*\\(|$)`, "i")).first();
    if (await el.isVisible().catch(() => false)) {
      const cls = (await el.getAttribute("class").catch(() => "")) ?? "";
      const selectedAttr =
        (await el.getAttribute("aria-selected").catch(() => null)) === "true" ||
        /active|selected|current/i.test(cls);
      if (selectedAttr) {
        return label;
      }
    }
  }

  const freshBadge = page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first();
  if (await freshBadge.isVisible().catch(() => false)) {
    const yearVisible = await page
      .getByText(/^202\d$/)
      .first()
      .isVisible()
      .catch(() => false);
    if (!yearVisible) {
      return (
        ((await freshBadge.innerText().catch(() => "")) || "")
          .replace(/\s+/g, " ")
          .trim() || "Fresh"
      );
    }
  }

  return "";
}

async function failTodaySectionNotSelected(
  page: Page,
  logger: Logger,
  config: AppConfig,
  info: {
    todayCardVisible: boolean;
    todayCardClicked: boolean;
    activeTabText: string;
    freshVisible: boolean;
    t247IdCount: number;
  },
): Promise<never> {
  logger.error(`TENDER247_TODAY_SECTION_NOT_SELECTED url=${page.url()}`);
  logger.error(`activeTabText=${info.activeTabText}`);
  logger.error(`Today Tenders card visible=${info.todayCardVisible}`);
  logger.error(`Today Tenders card clicked=${info.todayCardClicked}`);
  logger.error(`Fresh tab visible=${info.freshVisible}`);
  logger.error(`T247 ID count=${info.t247IdCount}`);

  await captureErrorScreenshot(
    page,
    config.screenshotRoot,
    "Tender247",
    "TENDER247_TODAY_SECTION_NOT_SELECTED",
    logger,
  );

  throw new AutomationError(
    "TENDER247_TODAY_SECTION_NOT_SELECTED",
    `Could not activate Today Tenders / Fresh results (url=${page.url()}, activeTab="${info.activeTabText}", t247Count=${info.t247IdCount})`,
  );
}
