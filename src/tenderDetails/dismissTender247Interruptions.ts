/**
 * Dismiss Tender247 UI interruptions that block crawling/downloads.
 * Idempotent: no-op when nothing is present.
 * Page-scoped only — safe for parallel workers.
 */
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";

type LogLike = Pick<Logger, "info" | "warn" | "error">;

const consoleLogger: LogLike = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export const REMINDER_TITLE_RE =
  /T247\s*ID:\s*(\d+)\s*:-\s*Set Reminder/i;
export const REMINDER_TEXT_RE = /Set Reminder/i;

/**
 * Canonical interruption dismisser for Tender247 pages.
 * Call after dashboard load, before tender clicks, after detail open,
 * before AI Summary / document downloads, after navigation, and in retry loops.
 */
export async function dismissTender247Interruptions(
  page: Page,
  logger: LogLike = consoleLogger,
  config?: AppConfig,
): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  await dismissTender247ReminderModal(page, logger);

  // Existing nuisance UI (promo / free sample / support chat).
  // Soft-fail promo/support so a transient overlay never kills a worker;
  // reminder blocking is already candidate-fatal above.
  try {
    await dismissTender247BlockingOverlays(page, logger, config);
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
    ) {
      throw error;
    }
    logger.warn(
      `TENDER247_INTERRUPTION_PROMO_SOFT_FAIL=${
        error instanceof Error ? error.message.slice(0, 200) : String(error)
      }`,
    );
  }

  await dismissTender247SupportChat(page, logger).catch(() => undefined);
}

/**
 * Detect and close the "Set Reminder" modal via its modal-local X only.
 * Never fills fields or clicks Submit.
 */
export async function dismissTender247ReminderModal(
  page: Page,
  logger: LogLike = consoleLogger,
): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  const title = await findVisibleReminderTitle(page);
  if (!title) {
    return;
  }

  const titleText = ((await title.innerText().catch(() => "")) || "").trim();
  const idMatch = titleText.match(REMINDER_TITLE_RE);
  const tenderId = idMatch?.[1] ?? extractTenderIdNear(titleText);

  logger.info("TENDER247_REMINDER_MODAL_DETECTED=true");
  console.log("TENDER247_REMINDER_MODAL_DETECTED=true");
  if (tenderId) {
    logger.info(`TENDER247_REMINDER_MODAL_TENDER_ID=${tenderId}`);
    console.log(`TENDER247_REMINDER_MODAL_TENDER_ID=${tenderId}`);
  }

  const modal = await resolveReminderModalContainer(title);
  if (!modal) {
    // Still try Escape once if we saw the title but cannot resolve a container.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(250);
    if (!(await isReminderModalVisible(page))) {
      logDismissed(logger);
      return;
    }
    throwReminderBlocking(tenderId);
  }

  // Attempt 1: modal-local close/X
  let closed = await clickModalLocalClose(modal!, page, logger);
  if (closed) {
    logDismissed(logger);
    return;
  }

  // Attempt 2: Escape once, then re-check
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);
  if (!(await isReminderModalVisible(page))) {
    logDismissed(logger);
    return;
  }

  // Attempt 3: one more close retry
  closed = await clickModalLocalClose(modal!, page, logger);
  if (closed || !(await isReminderModalVisible(page))) {
    logDismissed(logger);
    return;
  }

  throwReminderBlocking(tenderId);
}

export async function isReminderModalVisible(page: Page): Promise<boolean> {
  return (await findVisibleReminderTitle(page)) !== null;
}

async function findVisibleReminderTitle(page: Page): Promise<Locator | null> {
  // Prefer full title pattern first.
  const full = page.getByText(REMINDER_TITLE_RE);
  const fullCount = await full.count().catch(() => 0);
  for (let i = 0; i < Math.min(fullCount, 5); i += 1) {
    const el = full.nth(i);
    if (await el.isVisible().catch(() => false)) {
      return el;
    }
  }

  // Fallback: "Set Reminder" near Mail Date / email fields.
  const setReminder = page.getByText(REMINDER_TEXT_RE);
  const count = await setReminder.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 8); i += 1) {
    const el = setReminder.nth(i);
    if (!(await el.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await el.innerText().catch(() => "")) || "").trim();
    if (/T247\s*ID/i.test(text) || /Set Reminder/i.test(text)) {
      // Confirm it looks like the reminder dialog, not a nav label.
      const container = await resolveReminderModalContainer(el);
      if (!container) continue;
      const hasMailDate =
        (await container.getByText(/Mail Date/i).count().catch(() => 0)) > 0;
      const hasEmail =
        (await container
          .getByPlaceholder(/email/i)
          .or(container.getByText(/Enter your email/i))
          .count()
          .catch(() => 0)) > 0;
      const hasSubmit =
        (await container.getByRole("button", { name: /submit/i }).count().catch(() => 0)) >
        0;
      if (hasMailDate || hasEmail || hasSubmit) {
        return el;
      }
    }
  }
  return null;
}

async function resolveReminderModalContainer(
  title: Locator,
): Promise<Locator | null> {
  // Prefer dialog/role ancestors.
  const dialog = title.locator(
    'xpath=ancestor::*[@role="dialog" or @aria-modal="true"][1]',
  );
  if (
    (await dialog.count().catch(() => 0)) > 0 &&
    (await dialog.isVisible().catch(() => false))
  ) {
    return dialog;
  }

  // Walk ancestors until Submit + email/Mail Date appear (reminder form).
  for (let depth = 1; depth <= 12; depth += 1) {
    const ancestor = title.locator(
      `xpath=ancestor::*[self::div or self::section or self::aside or self::form][${depth}]`,
    );
    if (!(await ancestor.count().catch(() => 0))) {
      break;
    }
    if (!(await ancestor.isVisible().catch(() => false))) {
      continue;
    }
    const hasSubmit =
      (await ancestor.getByRole("button", { name: /submit/i }).count().catch(() => 0)) >
        0 ||
      (await ancestor.getByText(/^Submit$/i).count().catch(() => 0)) > 0;
    const hasMailDate =
      (await ancestor.getByText(/Mail Date/i).count().catch(() => 0)) > 0;
    const hasEmail =
      (await ancestor
        .locator('input[type="email"], input[placeholder*="email" i]')
        .count()
        .catch(() => 0)) > 0 ||
      (await ancestor.getByText(/Enter your email/i).count().catch(() => 0)) > 0;
    const hasWhatsApp =
      (await ancestor.getByText(/WhatsApp/i).count().catch(() => 0)) > 0;

    if (hasSubmit && (hasMailDate || hasEmail || hasWhatsApp)) {
      return ancestor;
    }
  }

  // Fallback: nearest reasonably sized ancestor of the title.
  const fallback = title.locator(
    'xpath=ancestor::*[self::div or self::section][position()<=6][1]',
  );
  if (
    (await fallback.count().catch(() => 0)) > 0 &&
    (await fallback.isVisible().catch(() => false))
  ) {
    return fallback;
  }
  return null;
}

async function clickModalLocalClose(
  modal: Locator,
  page: Page,
  logger: LogLike,
): Promise<boolean> {
  const modalBox = await modal.boundingBox().catch(() => null);

  const candidates: Locator[] = [
    modal.locator(
      '#reminder-close, button[aria-label*="close" i], button[title*="close" i]',
    ),
    modal.getByRole("button", { name: /close|dismiss|cancel|^×$|^x$/i }),
    modal.locator(
      '[aria-label*="close" i], [title*="close" i], [data-dismiss], button.close, .close, .btn-close',
    ),
    modal.locator('button:has(svg), [role="button"]:has(svg)'),
  ];

  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const aria =
        (await candidate.getAttribute("aria-label").catch(() => "")) || "";
      const title =
        (await candidate.getAttribute("title").catch(() => "")) || "";
      const labelText = (
        (await candidate.innerText().catch(() => "")) || ""
      ).trim();
      const looksLikeSubmit = labelText.toLowerCase() === "submit";
      if (looksLikeSubmit) continue;

      const labeledClose =
        /close|dismiss/i.test(aria) ||
        /close|dismiss/i.test(title) ||
        /^(×|x|✕|✖)$/i.test(labelText);

      // Prefer upper-right small close icon when geometry is available.
      // Reminder overlay is often fullscreen; panel X may sit mid-viewport —
      // labeled close controls must still be accepted.
      if (modalBox && !labeledClose) {
        const box = await candidate.boundingBox().catch(() => null);
        if (box) {
          const inUpperRight =
            box.width <= 64 &&
            box.height <= 64 &&
            box.x >= modalBox.x + modalBox.width * 0.55 &&
            box.y <= modalBox.y + modalBox.height * 0.45;
          if (!inUpperRight) {
            continue;
          }
        }
      }

      // Prefer DOM click — avoids overlay interception timeouts on aria-modal.
      try {
        await candidate.evaluate((el: HTMLElement) => el.click());
      } catch {
        try {
          await candidate.click({ force: true, timeout: 2_000 });
        } catch {
          continue;
        }
      }

      await page.waitForTimeout(300);
      if (!(await isReminderModalVisible(page))) {
        return true;
      }
      logger.warn("TENDER247_REMINDER_MODAL_CLOSE_CLICKED_STILL_VISIBLE");
    }
  }

  // SVG X in upper-right of this modal only.
  if (modalBox) {
    const svgs = modal.locator("svg");
    const svgCount = await svgs.count().catch(() => 0);
    for (let i = 0; i < Math.min(svgCount, 20); i += 1) {
      const svg = svgs.nth(i);
      if (!(await svg.isVisible().catch(() => false))) continue;
      const box = await svg.boundingBox().catch(() => null);
      if (!box) continue;
      const inUpperRight =
        box.width <= 48 &&
        box.height <= 48 &&
        box.x >= modalBox.x + modalBox.width * 0.55 &&
        box.y <= modalBox.y + modalBox.height * 0.4;
      if (!inUpperRight) continue;

      const clickable = svg.locator(
        'xpath=ancestor::button[1] | ancestor::a[1] | ancestor::*[@role="button"][1] | parent::*',
      );
      const target =
        (await clickable.count().catch(() => 0)) > 0 ? clickable.first() : svg;
      try {
        await target.evaluate((el: HTMLElement) => el.click());
      } catch {
        await target
          .click({ force: true, timeout: 2_000 })
          .catch(() => undefined);
      }
      await page.waitForTimeout(300);
      if (!(await isReminderModalVisible(page))) {
        return true;
      }
    }
  }

  return false;
}

function extractTenderIdNear(text: string): string | null {
  const m = text.match(/T247\s*ID:\s*(\d+)/i) || text.match(/\b(\d{6,})\b/);
  return m?.[1] ?? null;
}

function logDismissed(logger: LogLike): void {
  logger.info("TENDER247_REMINDER_MODAL_DISMISSED=true");
  console.log("TENDER247_REMINDER_MODAL_DISMISSED=true");
}

function throwReminderBlocking(tenderId: string | null): never {
  throw new AutomationError(
    "TENDER247_REMINDER_MODAL_BLOCKING",
    `TENDER247_REMINDER_MODAL_BLOCKING${tenderId ? ` tenderId=${tenderId}` : ""}`,
  );
}
