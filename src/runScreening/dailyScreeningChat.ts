/**
 * Persistent daily screening ChatGPT conversation (same /c/ chat every day).
 * Accepts /c/, /g/.../c/, and legacy /share/ links (share tries Continue; never opens Project Home).
 */
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { chatGptPageGoto } from "../chatgptQualification/tenderPageNav.js";
import { isConversationUrl } from "../chatgptQualification/chatInteraction.js";

/** Writable daily screening chat (conversation — not Project Home). */
export const DEFAULT_SIYANA_SCREENING_CHAT_URL =
  "https://chatgpt.com/g/g-p-6a6af1fde80c8191a7b497acfa2e0755/c/6a8d22d3-d898-83ee-9576-1a1330f31467";

export function isScreeningChatUrl(url: string): boolean {
  const text = String(url || "").trim();
  if (!text) return false;
  if (!/chatgpt\.com/i.test(text)) return false;
  if (isConversationUrl(text)) return true;
  return /\/share\/[a-z0-9-]+/i.test(text);
}

export function resolveScreeningChatUrl(
  config: Pick<AppConfig, "chatgptScreeningChatUrl">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromConfig = config.chatgptScreeningChatUrl?.trim() || "";
  const fromEnv = env.CHATGPT_SCREENING_CHAT_URL?.trim() || "";
  const candidate = fromConfig || fromEnv || DEFAULT_SIYANA_SCREENING_CHAT_URL;
  if (!isScreeningChatUrl(candidate)) {
    throw new AutomationError(
      "CHATGPT_SCREENING_CHAT_URL_INVALID",
      `CHATGPT_SCREENING_CHAT_URL must be a chatgpt.com conversation (/c/ or /g/.../c/) or /share/ URL (got: ${candidate})`,
    );
  }
  return candidate;
}

async function tryContinueSharedChat(page: Page, logger?: Logger): Promise<void> {
  const continueRe =
    /continue (this )?chat|continue (the )?conversation|continue chatting|open in chat|use this chat/i;
  const candidates = [
    page.getByRole("button", { name: continueRe }),
    page.getByRole("link", { name: continueRe }),
    page.locator("a, button, [role='button']").filter({ hasText: continueRe }),
  ];
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const loc of candidates) {
      const target = loc.first();
      if (await target.isVisible({ timeout: 2_000 }).catch(() => false)) {
        logger?.info("CHATGPT_SCREENING_SHARE_CONTINUE_CLICK=true");
        console.log("CHATGPT_SCREENING_SHARE_CONTINUE_CLICK=true");
        await target.click({ timeout: 10_000 }).catch(() => undefined);
        await page
          .waitForURL((u) => isConversationUrl(u.toString()), { timeout: 20_000 })
          .catch(() => undefined);
        await page.waitForTimeout(1_500);
        return;
      }
    }
    await page.waitForTimeout(1_000);
  }
}

async function waitForComposer(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() => {
        const editor =
          document.querySelector(
            '[contenteditable="true"]#prompt-textarea, #prompt-textarea, [contenteditable="true"][data-testid*="composer" i], [contenteditable="true"]',
          ) || document.querySelector("textarea");
        return Boolean(editor);
      })
      .catch(() => false);
    if (ready) return;
    await page.waitForTimeout(500);
  }
  throw new AutomationError(
    "CHATGPT_SCREENING_COMPOSER_NOT_READY",
    "Screening chat composer did not become ready",
  );
}

/**
 * Open the configured daily screening conversation and wait for the composer.
 * Always reuses this chat URL — does not navigate to Project Home.
 */
export async function openPersistentScreeningChat(options: {
  page: Page;
  config: AppConfig;
  logger: Logger;
}): Promise<{ chatUrl: string }> {
  const { page, config, logger } = options;
  const targetUrl = resolveScreeningChatUrl(config);
  logger.info(`CHATGPT_SCREENING_CHAT_URL=${targetUrl}`);
  console.log(`CHATGPT_SCREENING_CHAT_URL=${targetUrl}`);
  logger.info("CHATGPT_SCREENING_MODE_CHAT=true");
  console.log("CHATGPT_SCREENING_MODE_CHAT=true");

  await chatGptPageGoto(page, targetUrl, {
    reason: "open_persistent_screening_chat",
    logger,
    waitUntil: "domcontentloaded",
    timeout: Math.max(60_000, config.pageTimeoutMs || 90_000),
    untracked: true,
  });

  if (/\/share\//i.test(targetUrl) || /\/share\//i.test(page.url())) {
    logger.info("CHATGPT_SCREENING_SHARE_PAGE=true");
    console.log("CHATGPT_SCREENING_SHARE_PAGE=true");
    await tryContinueSharedChat(page, logger);
  }

  await waitForComposer(page, 120_000);

  const current = page.url();
  if (!isConversationUrl(current) && /\/share\//i.test(current)) {
    throw new AutomationError(
      "CHATGPT_SCREENING_SHARE_NOT_CONTINUED",
      "Still on a read-only /share/ page — set CHATGPT_SCREENING_CHAT_URL to a writable /c/ chat URL",
    );
  }

  logger.info(`CHATGPT_SCREENING_CHAT_OPENED=${current}`);
  console.log(`CHATGPT_SCREENING_CHAT_OPENED=${current}`);
  return { chatUrl: current };
}
