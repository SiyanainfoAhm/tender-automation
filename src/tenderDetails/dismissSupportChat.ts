import type { FrameLocator, Page } from "playwright";
import type { Logger } from "../logger.js";

type LogLike = Pick<Logger, "info" | "warn" | "error">;

/**
 * Minimize Tender247 Support / Zendesk live-chat panel when it covers the page.
 * Leaves the small floating Help button alone. Never interacts with chat messages.
 */
export async function dismissTender247SupportChat(
  page: Page,
  logger?: LogLike,
): Promise<void> {
  const log = logger ?? {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
    error: (m: string) => console.error(m),
  };

  const open = await isSupportChatPanelOpen(page);
  if (!open) {
    return;
  }

  log.info("TENDER247_SUPPORT_CHAT_DETECTED");

  // Prefer page-level minimize controls first
  if (await tryMinimizeOnScope(page, log)) {
    await waitUntilPanelCollapsed(page);
    if (!(await isSupportChatPanelOpen(page))) {
      log.info("TENDER247_SUPPORT_CHAT_MINIMIZED");
      return;
    }
  }

  // Zendesk widgets usually live in iframes
  const frameCandidates = [
    page.frameLocator('iframe[title*="messaging" i]'),
    page.frameLocator('iframe[title*="support" i]'),
    page.frameLocator('iframe[title*="widget" i]'),
    page.frameLocator('iframe[name*="zendesk" i]'),
    page.frameLocator('iframe#webWidget'),
    page.frameLocator('iframe[id*="webWidget" i]'),
    page.frameLocator('iframe[class*="zendesk" i]'),
  ];

  for (const frame of frameCandidates) {
    if (await tryMinimizeInFrame(frame, log)) {
      await waitUntilPanelCollapsed(page);
      if (!(await isSupportChatPanelOpen(page))) {
        log.info("TENDER247_SUPPORT_CHAT_MINIMIZED");
        return;
      }
    }
  }

  // Last resort: Escape (often collapses Zendesk)
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(400);
  if (!(await isSupportChatPanelOpen(page))) {
    log.info("TENDER247_SUPPORT_CHAT_MINIMIZED");
    return;
  }

  log.warn("Support chat panel still visible after minimize attempts");
}

async function isSupportChatPanelOpen(page: Page): Promise<boolean> {
  const texts = [
    page.getByText("Tender247 Support", { exact: true }),
    page.getByText("Tender247 Live Support", { exact: true }),
    page.getByText(/Tender247\s+Live\s+Support/i),
    page.getByText(/Tender247\s+Support/i),
  ];
  for (const t of texts) {
    if (await t.first().isVisible().catch(() => false)) {
      // Require a reasonably large panel — not just a tiny launcher label
      const box = await t.first().boundingBox().catch(() => null);
      if (box && box.width >= 120 && box.height >= 20) {
        return true;
      }
      // Header text can be small; also check for open widget chrome nearby
      return true;
    }
  }

  // Open Zendesk messaging window iframe (not the launcher)
  const openIframe = page.locator(
    'iframe[title*="messaging" i], iframe[title*="Message" i], iframe#webWidget, iframe[name*="Messaging" i]',
  );
  if (await openIframe.first().isVisible().catch(() => false)) {
    const box = await openIframe.first().boundingBox().catch(() => null);
    // Large panel vs tiny launcher
    if (box && (box.width > 220 || box.height > 220)) {
      return true;
    }
  }

  return false;
}

async function tryMinimizeOnScope(
  page: Page,
  log: LogLike,
): Promise<boolean> {
  const candidates = [
    page.getByRole("button", { name: /minimize|collapse|reduce/i }),
    page.locator(
      'button[aria-label*="minimize" i], button[title*="minimize" i], [aria-label*="minimize" i], [title*="minimize" i]',
    ),
    page.locator(
      'button[aria-label*="collapse" i], button[title*="collapse" i], [aria-label*="collapse" i]',
    ),
    // Header "-" control beside the arrow (exact hyphen / minus glyphs)
    page.getByRole("button", { name: /^[-−–—]$/ }),
    page.locator("button").filter({ hasText: /^[-−–—]$/ }),
  ];

  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      const el = group.nth(i);
      if (!(await el.isVisible().catch(() => false))) {
        continue;
      }
      try {
        await el.click({ timeout: 3_000, force: true });
        log.info("Clicked support-chat minimize control (page scope)");
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

async function tryMinimizeInFrame(
  frame: FrameLocator,
  log: LogLike,
): Promise<boolean> {
  const candidates = [
    frame.getByRole("button", { name: /minimize|collapse|reduce/i }),
    frame.locator(
      'button[aria-label*="minimize" i], button[title*="minimize" i], [aria-label*="minimize" i], [title*="minimize" i]',
    ),
    frame.locator(
      'button[aria-label*="collapse" i], button[title*="collapse" i]',
    ),
    frame.getByRole("button", { name: /^[-−–—]$/ }),
    frame.locator("button").filter({ hasText: /^[-−–—]$/ }),
  ];

  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      const el = group.nth(i);
      if (!(await el.isVisible().catch(() => false))) {
        continue;
      }
      try {
        await el.click({ timeout: 3_000, force: true });
        log.info("Clicked support-chat minimize control (iframe)");
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

async function waitUntilPanelCollapsed(page: Page): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await isSupportChatPanelOpen(page))) {
      return;
    }
    await page.waitForTimeout(200);
  }
}
