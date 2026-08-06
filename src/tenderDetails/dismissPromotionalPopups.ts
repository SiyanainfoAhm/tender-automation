import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { AutomationError, captureErrorScreenshot } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { getLocalTimestamp, getTodayIsoDate } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";

const B2B_HEADING_RE = /Tender247 B2B Marketplace/i;
const FREE_SAMPLE_HEADING = "Get Your Free Sample";
const DONT_SHOW_AGAIN = /don['\u2019]t show again/i;

type LogLike = Pick<Logger, "info" | "warn" | "error">;

const consoleLogger: LogLike = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/**
 * Dismiss Tender247 blocking overlays (B2B Marketplace + Free Sample).
 * Never fills promotional forms or interacts with CAPTCHA.
 * Uses explicit dismissal only — B2B locator handler is disabled.
 */
export async function dismissTender247BlockingOverlays(
  page: Page,
  logger: LogLike = consoleLogger,
  config?: AppConfig,
): Promise<void> {
  const ok = await dismissB2BMarketplacePopup(page, logger, config);
  if (!ok) {
    throw new AutomationError(
      "TENDER247_POPUP_DISMISS_FAILED",
      `Promotional popup remained visible: Tender247 B2B Marketplace (url=${page.url()})`,
    );
  }
  await dismissFreeSamplePopup(page, logger, config);
  await dismissTender247SupportChat(page, logger).catch(() => undefined);
}

/** @deprecated Prefer dismissTender247BlockingOverlays */
export async function dismissTender247PromotionalPopups(
  page: Page,
  logger: LogLike,
  config?: AppConfig,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger, config);
}

/** Alias used by existing call sites. */
export async function dismissPromotionalPopups(
  page: Page,
  logger: LogLike,
  config?: AppConfig,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger, config);
}

/**
 * B2B locator handler is intentionally NOT registered.
 * It was interfering with explicit dismissal. Call dismissB2BMarketplacePopup
 * after navigation instead until proven stable.
 */
export async function registerPromotionalPopupHandlers(
  _page: Page,
  logger: LogLike = consoleLogger,
): Promise<void> {
  logger.info(
    "TENDER247_B2B_LOCATOR_HANDLER_DISABLED — using explicit dismissB2BMarketplacePopup only",
  );
  // Free Sample handler also deferred while debugging popup dismissal races.
}

/**
 * Robust B2B Marketplace popup dismissal.
 * Never fills the form, never solves CAPTCHA, never submits.
 * Returns true when popup is gone (or was never visible).
 * Returns false only after all strategies fail (also writes debug artifacts).
 */
export async function dismissB2BMarketplacePopup(
  page: Page,
  logger: LogLike = consoleLogger,
  config?: AppConfig,
): Promise<boolean> {
  // STEP 1 — FIND THE POPUP
  const heading = page.getByText(B2B_HEADING_RE).first();
  if (!(await heading.isVisible().catch(() => false))) {
    return true;
  }

  logger.info("TENDER247_B2B_POPUP_DETECTED");

  // STEP 2 — TRY "DON'T SHOW AGAIN"
  const dontShowAgain = page.getByText(DONT_SHOW_AGAIN).first();
  if (await dontShowAgain.isVisible().catch(() => false)) {
    try {
      await dontShowAgain.scrollIntoViewIfNeeded().catch(() => undefined);
      await dontShowAgain.click({ timeout: 3_000, force: true });
      await page.waitForTimeout(1_000);
      if (!(await heading.isVisible().catch(() => false))) {
        logger.info("TENDER247_B2B_POPUP_DISMISSED:DONT_SHOW_AGAIN");
        return true;
      }
      logger.warn("Don't show again clicked but popup still visible");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Don't show again click failed: ${message}`);
    }
  } else {
    logger.warn("Don't show again control not visible");
  }

  // STEP 3 — FIND ACTUAL POPUP CONTAINER
  const popup = await resolveB2bPopupContainer(page, heading, logger);
  if (!popup) {
    logger.warn("Could not resolve B2B popup container from heading ancestors");
  }

  // STEP 4 — DEBUG ALL CLICKABLE ELEMENTS IN POPUP
  if (popup) {
    await logPopupClickableDiagnostics(popup, logger);
  }

  // STEP 5 — TRY CLOSE LOCATORS (upper-right geometry filter)
  let closeCandidate: Locator | null = null;
  if (popup) {
    closeCandidate = await findUpperRightCloseCandidate(popup, logger);
    if (closeCandidate) {
      if (await tryClickCandidate(closeCandidate, heading, page, logger, "CLOSE_ICON")) {
        return true;
      }
    } else {
      logger.warn("No upper-right close candidate found via role/aria/button:has(svg)");
    }
  }

  // STEP 6 — SVG X FALLBACK
  if (popup) {
    const svgClose = await findSvgCloseCandidate(popup, logger);
    if (svgClose) {
      closeCandidate = svgClose;
      if (await tryClickCandidate(svgClose, heading, page, logger, "CLOSE_ICON_SVG")) {
        return true;
      }
    } else {
      logger.warn("No SVG-based close candidate found in upper-right");
    }
  }

  // STEP 7 — ESCAPE FALLBACK
  logger.info("Trying Escape fallback for B2B popup");
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);
  if (!(await heading.isVisible().catch(() => false))) {
    logger.info("TENDER247_B2B_POPUP_DISMISSED:ESCAPE");
    return true;
  }

  // STEP 8 — DOM CLICK FALLBACK on previously identified close candidate
  if (closeCandidate) {
    logger.info("Trying DOM click() fallback on identified close candidate");
    try {
      await closeCandidate.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(300);
      if (!(await heading.isVisible().catch(() => false))) {
        logger.info("TENDER247_B2B_POPUP_DISMISSED:DOM_CLICK");
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`DOM click fallback failed: ${message}`);
    }
  }

  // STEP 9 — VERIFY (still visible after all strategies)
  await page.waitForTimeout(300);
  const stillVisible = await heading.isVisible().catch(() => false);
  if (!stillVisible) {
    logger.info("TENDER247_B2B_POPUP_DISMISSED:LATE_HIDE");
    return true;
  }

  // STEP 10 — SCREENSHOT + HTML DEBUG
  await saveB2bFailureArtifacts(page, heading, popup, logger, config);
  logger.error(
    `TENDER247_POPUP_DISMISS_FAILED popup="Tender247 B2B Marketplace" url=${page.url()}`,
  );
  return false;
}

async function tryClickCandidate(
  candidate: Locator,
  heading: Locator,
  page: Page,
  logger: LogLike,
  method: string,
): Promise<boolean> {
  try {
    await candidate.click({ force: true, timeout: 3_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Close candidate Playwright click failed (${method}): ${message}`);
    try {
      await candidate.evaluate((el: HTMLElement) => el.click());
    } catch (domError) {
      const domMessage =
        domError instanceof Error ? domError.message : String(domError);
      logger.warn(`Close candidate DOM click also failed (${method}): ${domMessage}`);
      return false;
    }
  }

  await page.waitForTimeout(300);
  if (!(await heading.isVisible().catch(() => false))) {
    logger.info(`TENDER247_B2B_POPUP_DISMISSED:${method}`);
    return true;
  }
  return false;
}

/**
 * Walk ancestors from heading until container has Join for free + form fields.
 * Do not assume role=dialog. Do not depend on generated CSS class names.
 */
async function resolveB2bPopupContainer(
  _page: Page,
  heading: Locator,
  logger: LogLike,
): Promise<Locator | null> {
  // Preferred xpath: ancestor that contains "Join for free" and an input
  const xpathCandidate = heading.locator(
    'xpath=ancestor::*[.//*[contains(normalize-space(.),"Join for free")] and .//input][1]',
  );
  if (
    (await xpathCandidate.count().catch(() => 0)) > 0 &&
    (await xpathCandidate.isVisible().catch(() => false))
  ) {
    const hasCompany =
      (await xpathCandidate.getByText(/Company Name/i).count().catch(() => 0)) > 0;
    const hasCaptcha =
      (await xpathCandidate.getByText(/Enter Captcha/i).count().catch(() => 0)) > 0;
    logger.info(
      `B2B popup container via xpath ancestor (company=${hasCompany} captcha=${hasCaptcha})`,
    );
    return xpathCandidate;
  }

  // Programmatic ancestor walk
  for (let depth = 1; depth <= 15; depth += 1) {
    const ancestor = heading.locator(
      `xpath=ancestor::*[self::div or self::section or self::aside or self::form][${depth}]`,
    );
    if (!(await ancestor.count().catch(() => 0))) {
      break;
    }

    const hasJoin =
      (await ancestor.getByText(/Join for free/i).count().catch(() => 0)) > 0;
    const hasCompany =
      (await ancestor.getByText(/Company Name/i).count().catch(() => 0)) > 0;
    const hasCaptcha =
      (await ancestor.getByText(/Enter Captcha/i).count().catch(() => 0)) > 0;
    const inputCount = await ancestor.locator("input").count().catch(() => 0);

    if (hasJoin && inputCount >= 3 && (hasCompany || hasCaptcha || inputCount >= 5)) {
      logger.info(
        `B2B popup container resolved at ancestor depth=${depth} inputs=${inputCount} join=${hasJoin} company=${hasCompany} captcha=${hasCaptcha}`,
      );
      return ancestor;
    }
  }

  // Fallback: widest useful ancestor with Join for free
  for (let depth = 1; depth <= 15; depth += 1) {
    const ancestor = heading.locator(
      `xpath=ancestor::*[self::div or self::section or self::aside][${depth}]`,
    );
    if (!(await ancestor.count().catch(() => 0))) {
      break;
    }
    const hasJoin =
      (await ancestor.getByText(/Join for free/i).count().catch(() => 0)) > 0;
    const inputCount = await ancestor.locator("input").count().catch(() => 0);
    if (hasJoin && inputCount >= 1) {
      logger.info(
        `B2B popup container fallback depth=${depth} inputs=${inputCount}`,
      );
      return ancestor;
    }
  }

  return null;
}

async function logPopupClickableDiagnostics(
  popup: Locator,
  logger: LogLike,
): Promise<void> {
  logger.info("=== B2B popup clickable element diagnostics (no input values) ===");
  try {
    const rows = await popup.evaluate((root: Element) => {
      const nodes = root.querySelectorAll(
        'button, a, [role="button"], svg, img, span, div',
      );
      const out: Array<Record<string, string | boolean | number | null>> = [];
      const limit = Math.min(nodes.length, 80);
      for (let i = 0; i < limit; i += 1) {
        const el = nodes[i] as HTMLElement;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
        // Skip huge layout wrappers to keep logs useful
        if (rect.width > 600 && rect.height > 400 && el.tagName === "DIV") {
          continue;
        }
        out.push({
          index: i,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
          ariaLabel: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
          role: el.getAttribute("role"),
          className: String(el.className || "").slice(0, 120),
          visible,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          cursor: style.cursor,
          tabindex: el.getAttribute("tabindex"),
        });
      }
      return out;
    });

    for (const row of rows) {
      logger.info(
        `clickable tag=${row.tag} visible=${row.visible} text="${row.text}" aria="${row.ariaLabel}" title="${row.title}" role="${row.role}" class="${row.className}" box=(${row.x},${row.y},${row.width}x${row.height}) cursor=${row.cursor} tabindex=${row.tabindex}`,
      );
    }
    logger.info(`=== end diagnostics (${rows.length} elements logged) ===`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to collect popup clickable diagnostics: ${message}`);
  }
}

async function findUpperRightCloseCandidate(
  popup: Locator,
  logger: LogLike,
): Promise<Locator | null> {
  const popupBox = await popup.boundingBox().catch(() => null);
  if (!popupBox) {
    logger.warn("Popup bounding box unavailable");
    return null;
  }

  const groups: Locator[] = [
    popup.getByRole("button", { name: /close|dismiss/i }),
    popup.locator('[aria-label*="close" i], [title*="close" i]'),
    popup.locator('button:has(svg), [role="button"]:has(svg)'),
  ];

  for (const group of groups) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const box = await candidate.boundingBox().catch(() => null);
      if (!box) {
        continue;
      }
      if (!isUpperRightCloseBox(popupBox, box)) {
        continue;
      }
      logger.info(
        `Upper-right close candidate selected box=(${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)})`,
      );
      return candidate;
    }
  }

  // Broader small clickables in upper-right
  const broad = popup.locator(
    'button, a, [role="button"], span, i, div[class*="close" i]',
  );
  const broadCount = await broad.count().catch(() => 0);
  let best: { locator: Locator; score: number } | null = null;
  for (let i = 0; i < Math.min(broadCount, 60); i += 1) {
    const candidate = broad.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || !isUpperRightCloseBox(popupBox, box)) {
      continue;
    }
    const score = box.x - box.y;
    if (!best || score > best.score) {
      best = { locator: candidate, score };
    }
  }
  if (best) {
    const box = await best.locator.boundingBox().catch(() => null);
    logger.info(
      `Upper-right broad close candidate selected box=(${box ? Math.round(box.x) : "?"},${box ? Math.round(box.y) : "?"},${box ? Math.round(box.width) : "?"}x${box ? Math.round(box.height) : "?"})`,
    );
    return best.locator;
  }

  return null;
}

function isUpperRightCloseBox(
  popupBox: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  if (box.width > 80 || box.height > 80) {
    return false;
  }
  const inRight = box.x >= popupBox.x + popupBox.width * 0.75;
  const inTop = box.y <= popupBox.y + popupBox.height * 0.25;
  return inRight && inTop;
}

async function findSvgCloseCandidate(
  popup: Locator,
  logger: LogLike,
): Promise<Locator | null> {
  const popupBox = await popup.boundingBox().catch(() => null);
  if (!popupBox) {
    return null;
  }

  const svgs = popup.locator("svg");
  const count = await svgs.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 30); i += 1) {
    const svg = svgs.nth(i);
    if (!(await svg.isVisible().catch(() => false))) {
      continue;
    }
    const box = await svg.boundingBox().catch(() => null);
    if (!box || !isUpperRightCloseBox(popupBox, box)) {
      continue;
    }

    const meta = await svg.evaluate((el: Element) => {
      const parent = el.parentElement as HTMLElement | null;
      const style = parent ? window.getComputedStyle(parent) : null;
      return {
        parentTag: parent?.tagName?.toLowerCase() ?? null,
        parentRole: parent?.getAttribute("role"),
        parentTabIndex: parent?.getAttribute("tabindex"),
        parentCursor: style?.cursor ?? null,
        parentOnclick: parent?.onclick != null || parent?.hasAttribute("onclick"),
        parentClass: String(parent?.className || "").slice(0, 120),
      };
    });

    logger.info(
      `SVG upper-right candidate parentTag=${meta.parentTag} role=${meta.parentRole} tabindex=${meta.parentTabIndex} cursor=${meta.parentCursor} onclick=${meta.parentOnclick} class="${meta.parentClass}"`,
    );

    // Prefer clickable parent: button / a / [role=button] / cursor:pointer
    const clickableParent = svg.locator(
      'xpath=ancestor::button[1] | ancestor::a[1] | ancestor::*[@role="button"][1]',
    );
    if ((await clickableParent.count().catch(() => 0)) > 0) {
      return clickableParent.first();
    }

    if (meta.parentCursor === "pointer" || meta.parentOnclick || meta.parentTabIndex != null) {
      return svg.locator("xpath=parent::*");
    }

    // Click SVG itself as last SVG attempt
    return svg;
  }

  return null;
}

async function saveB2bFailureArtifacts(
  page: Page,
  heading: Locator,
  popup: Locator | null,
  logger: LogLike,
  config?: AppConfig,
): Promise<void> {
  const screenshotRoot = config?.screenshotRoot ?? "./screenshots";
  const dir = path.join(resolveProjectPath(screenshotRoot), getTodayIsoDate());
  ensureDir(dir);
  const screenshotPath = path.join(dir, "Tender247_B2B_POPUP_FAILED.png");
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Screenshot saved: ${path.relative(process.cwd(), screenshotPath)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to save B2B failure screenshot: ${message}`);
    await captureErrorScreenshot(
      page,
      screenshotRoot,
      "Tender247",
      "TENDER247_POPUP_DISMISS_FAILED",
      logger as Logger,
    );
  }

  const debugRoot = resolveProjectPath("./debug");
  const debugDay = path.join(debugRoot, getTodayIsoDate());
  ensureDir(debugDay);
  const htmlPath = path.join(debugDay, "Tender247_B2B_popup.html");

  try {
    const target = popup ?? heading.locator("xpath=ancestor::*[.//input][1]");
    const html = await target
      .evaluate((el: Element) => {
        // Sanitized popup DOM only — no cookies/storage/credentials
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("input, textarea").forEach((node) => {
          const input = node as HTMLInputElement | HTMLTextAreaElement;
          if (input.type === "password") {
            input.value = "";
            input.setAttribute("value", "");
          } else {
            // Clear values; keep structure
            input.value = "";
            input.removeAttribute("value");
          }
        });
        return clone.outerHTML;
      })
      .catch(async () => {
        return `<!-- popup outerHTML unavailable; heading text present on page url=${page.url()} ts=${getLocalTimestamp()} -->`;
      });

    fs.writeFileSync(
      htmlPath,
      `<!-- Tender247 B2B popup DOM snapshot (sanitized). No cookies/localStorage/sessionStorage/credentials. url=${page.url()} -->\n${html}`,
      "utf8",
    );
    logger.info(`Popup HTML debug saved: ${path.relative(process.cwd(), htmlPath)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to save popup HTML debug: ${message}`);
  }
}

async function dismissFreeSamplePopup(
  page: Page,
  logger: LogLike,
  config?: AppConfig,
): Promise<void> {
  const popupHeading = page.getByText(FREE_SAMPLE_HEADING, { exact: true });
  if (!(await popupHeading.isVisible().catch(() => false))) {
    return;
  }

  logger.info("TENDER247_FREE_SAMPLE_POPUP_DETECTED");

  const close = page
    .getByRole("button", { name: /close|dismiss/i })
    .or(page.locator('[aria-label*="close" i], [title*="close" i]'))
    .first();

  // Prefer close near Free Sample heading
  const near = popupHeading
    .locator(
      'xpath=ancestor::*[self::div or self::section][position()<=8][1]//button | ancestor::*[self::div or self::section][position()<=8][1]//*[@aria-label]',
    )
    .first();

  if (await near.isVisible().catch(() => false)) {
    await near.click({ force: true, timeout: 3_000 }).catch(() => undefined);
  } else if (await close.isVisible().catch(() => false)) {
    await close.click({ force: true, timeout: 3_000 }).catch(() => undefined);
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  await page.waitForTimeout(300);
  if (await popupHeading.isVisible().catch(() => false)) {
    logger.error(
      `TENDER247_POPUP_DISMISS_FAILED popup="${FREE_SAMPLE_HEADING}" url=${page.url()}`,
    );
    if (config) {
      await captureErrorScreenshot(
        page,
        config.screenshotRoot,
        "Tender247",
        "TENDER247_POPUP_DISMISS_FAILED",
        logger as Logger,
      );
    }
    throw new AutomationError(
      "TENDER247_POPUP_DISMISS_FAILED",
      `Promotional popup remained visible: ${FREE_SAMPLE_HEADING} (url=${page.url()})`,
    );
  }

  logger.info("TENDER247_FREE_SAMPLE_POPUP_DISMISSED");
}
