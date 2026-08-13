/**
 * Clear current composerShell: attachment cards + prompt text.
 *
 * IMPORTANT:
 * - NEVER page.goto / page.reload
 * - NEVER fall back to page.locator("body")
 * - NEVER click Share / project menu / chrome outside attachment cards
 * - Empty composer → immediate clean return (no remove attempts)
 */
import type { Locator, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  discoverComposerAttachments,
  resolveComposerShell,
  type DiscoveredComposerAttachments,
} from "./composerShellAttachments.js";
import { isProjectHomeUrl } from "./openProject.js";
import { isAtOrPastComposerReady } from "./tenderPageNav.js";
import { AutomationError } from "../browserUtils.js";

/** One bounded cleanup pass — not an endless remove loop. */
const MAX_ATTACHMENT_REMOVAL_ROUNDS = 3;
const REMOVE_WAIT_MS = 400;

const UNSAFE_REMOVE_NAME_RE =
  /\b(share|more options|more|rename|pin chat|pin|archive|delete project|delete chat|move to project|remove from project|send|add files|upload|voice|microphone|mic)\b/i;

export type ClearCurrentComposerResult = {
  beforeCount: number;
  afterCount: number;
  removedNames: string[];
  textCleared: boolean;
  clean: boolean;
  recoveredWithFreshComposer: boolean;
  displayedNamesBefore: string[];
  displayedNamesAfter: string[];
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

function warn(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.warn(message);
}

async function logicalSnapshot(
  page: Page,
  composerToken?: string,
): Promise<DiscoveredComposerAttachments> {
  return discoverComposerAttachments(page, { composerToken });
}

/**
 * Click remove ONLY inside the attachment card for this filename,
 * and ONLY if that card is inside the token-marked composerShell.
 * Uses page.evaluate (not locator.evaluate) to avoid 30s locator timeouts.
 */
async function clickCardLocalRemove(
  page: Page,
  shellToken: string,
  fileName: string,
  logger?: Logger,
): Promise<boolean> {
  const result = await page
    .evaluate(
      ({ tokenAttr, tokenValue, targetName }) => {
        const root = document.querySelector(
          `[${tokenAttr}="${tokenValue}"]`,
        ) as HTMLElement | null;
        if (!root) {
          return {
            clicked: false,
            cardFound: false,
            buttonFound: false,
            buttonName: "",
            insideCard: false,
            insideComposer: false,
            rejected: "no_shell",
          };
        }

        const target = String(targetName || "").replace(/\s+/g, " ").trim();
        if (!target) {
          return {
            clicked: false,
            cardFound: false,
            buttonFound: false,
            buttonName: "",
            insideCard: false,
            insideComposer: true,
            rejected: "",
          };
        }
        const targetLower = target.toLowerCase();
        const targetStem = targetLower.replace(/\.(json|pdf|zip)$/i, "");
        const unsafe =
          /\b(share|more options|more|rename|pin chat|pin|archive|delete project|delete chat|move to project|remove from project|send|add files|upload|voice|microphone|mic)\b/i;

        const buttons = Array.from(
          root.querySelectorAll("button, [role='button']"),
        ) as HTMLElement[];
        for (let i = 0; i < buttons.length; i += 1) {
          const b = buttons[i]!;
          if (
            b.closest(
              '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside',
            )
          ) {
            continue;
          }
          const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`.replace(
            /\s+/g,
            " ",
          );
          if (unsafe.test(label)) continue;
          const m = label.match(
            /(?:Remove|Delete)\s+file(?:\s+\d+)?:?\s*(.+)$/i,
          );
          if (!m || !m[1]) continue;
          const parsed = m[1].replace(/\s+/g, " ").trim().toLowerCase();
          if (
            parsed === targetLower ||
            parsed.includes(targetStem) ||
            targetLower.includes(parsed.replace(/\.(json|pdf|zip)$/i, ""))
          ) {
            b.click();
            return {
              clicked: true,
              cardFound: true,
              buttonFound: true,
              buttonName: label.trim().slice(0, 120),
              insideCard: true,
              insideComposer: true,
              rejected: "",
            };
          }
        }

        const cards = Array.from(
          root.querySelectorAll(
            "[class*='file' i], [class*='attachment' i], [data-testid*='file' i], li, div",
          ),
        ) as HTMLElement[];
        for (let i = 0; i < cards.length; i += 1) {
          const card = cards[i]!;
          if (
            card.closest(
              '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside',
            )
          ) {
            continue;
          }
          const text = (card.innerText || "").replace(/\s+/g, " ").trim();
          if (!text || text.length > 180) continue;
          if (card.querySelector('[contenteditable="true"], textarea')) continue;
          if (
            !text.toLowerCase().includes(targetStem) &&
            !text.toLowerCase().includes(targetLower)
          ) {
            continue;
          }

          const localButtons = Array.from(
            card.querySelectorAll("button, [role='button']"),
          ) as HTMLElement[];
          for (let j = 0; j < localButtons.length; j += 1) {
            const lb = localButtons[j]!;
            if (!card.contains(lb)) continue;
            const lab = `${lb.getAttribute("aria-label") || ""} ${lb.getAttribute("title") || ""} ${lb.className || ""}`.replace(
              /\s+/g,
              " ",
            );
            if (unsafe.test(lab)) continue;
            const isRemove =
              /(?:Remove|Delete)\s+file/i.test(lab) ||
              /\b(remove|delete|dismiss)\b/i.test(lab) ||
              lb.classList.contains("x") ||
              ((lb.textContent || "").trim() === "" &&
                Boolean(lb.querySelector("svg")));
            if (!isRemove) continue;
            lb.click();
            return {
              clicked: true,
              cardFound: true,
              buttonFound: true,
              buttonName: lab.trim().slice(0, 120) || "icon-x",
              insideCard: true,
              insideComposer: true,
              rejected: "",
            };
          }
        }

        return {
          clicked: false,
          cardFound: false,
          buttonFound: false,
          buttonName: "",
          insideCard: false,
          insideComposer: true,
          rejected: "",
        };
      },
      {
        tokenAttr: "data-agenttender-composer-token",
        tokenValue: shellToken,
        targetName: fileName,
      },
    )
    .catch(() => ({
      clicked: false,
      cardFound: false,
      buttonFound: false,
      buttonName: "",
      insideCard: false,
      insideComposer: false,
      rejected: "evaluate_failed",
    }));

  log(logger, `CHATGPT_ATTACHMENT_CARD_FOUND=${result.cardFound}`);
  log(logger, `CHATGPT_ATTACHMENT_CARD_FILENAME=${fileName}`);
  log(
    logger,
    `CHATGPT_ATTACHMENT_CARD_INSIDE_COMPOSER=${result.insideComposer}`,
  );
  log(
    logger,
    `CHATGPT_ATTACHMENT_REMOVE_BUTTON_FOUND=${result.buttonFound}`,
  );
  if (result.buttonName) {
    log(
      logger,
      `CHATGPT_ATTACHMENT_REMOVE_BUTTON_NAME=${result.buttonName}`,
    );
  }
  log(
    logger,
    `CHATGPT_ATTACHMENT_REMOVE_BUTTON_INSIDE_CARD=${result.insideCard}`,
  );
  log(
    logger,
    `CHATGPT_ATTACHMENT_REMOVE_BUTTON_INSIDE_COMPOSER=${result.insideComposer}`,
  );

  if (
    result.rejected === "outside_composer" ||
    result.rejected === "no_shell"
  ) {
    warn(
      logger,
      `CHATGPT_ATTACHMENT_REMOVE_SHELL_MISS=${result.rejected}`,
    );
    return false;
  }

  if (result.buttonName && UNSAFE_REMOVE_NAME_RE.test(result.buttonName)) {
    warn(logger, "CHATGPT_UNSAFE_ATTACHMENT_REMOVE_TARGET_REJECTED=true");
    warn(logger, `CHATGPT_UNSAFE_TARGET_NAME=${result.buttonName}`);
    return false;
  }

  return result.clicked === true;
}

async function clearComposerPromptText(
  page: Page,
  shell: Locator,
  logger?: Logger,
): Promise<void> {
  const editor = shell
    .locator(
      '[contenteditable="true"], #prompt-textarea, textarea[placeholder*="Message" i], textarea[placeholder*="New chat" i]',
    )
    .first();
  if (await editor.isVisible().catch(() => false)) {
    await editor.click({ timeout: 3_000 }).catch(() => undefined);
    await page.keyboard.press("Control+A").catch(() => undefined);
    await page.keyboard.press("Backspace").catch(() => undefined);
    await page.keyboard.press("Meta+A").catch(() => undefined);
    await page.keyboard.press("Backspace").catch(() => undefined);
    log(logger, "CHATGPT_COMPOSER_TEXT_CLEARED=true");
  }
}

export async function clearCurrentComposer(
  page: Page,
  options?: { composerToken?: string; logger?: Logger },
): Promise<ClearCurrentComposerResult> {
  const logger = options?.logger;
  const composerToken = options?.composerToken;

  log(logger, "CHATGPT_COMPOSER_CLEANUP_START=true");

  const before = await logicalSnapshot(page, composerToken);
  log(
    logger,
    `CHATGPT_CURRENT_COMPOSER_FILENAMES=${JSON.stringify(before.filenames)}`,
  );
  log(
    logger,
    `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${before.logicalAttachmentCount}`,
  );
  log(
    logger,
    `CHATGPT_STALE_ATTACHMENT_COUNT=${before.logicalAttachmentCount}`,
  );

  // EMPTY COMPOSER FAST PATH — never run remove logic.
  if (before.logicalAttachmentCount === 0) {
    log(logger, "CHATGPT_STALE_ATTACHMENTS_FOUND=0");
    log(logger, "CHATGPT_COMPOSER_CLEAN=true");
    log(logger, "CHATGPT_FRESH_COMPOSER_VERIFIED=true");
    return {
      beforeCount: 0,
      afterCount: 0,
      removedNames: [],
      textCleared: true,
      clean: true,
      recoveredWithFreshComposer: false,
      displayedNamesBefore: [],
      displayedNamesAfter: [],
    };
  }

  warn(
    logger,
    `CHATGPT_STALE_ATTACHMENTS_FOUND=${before.logicalAttachmentCount}`,
  );

  const resolution = await resolveComposerShell(page, { composerToken });
  if (!resolution.shellFound) {
    warn(
      logger,
      "CHATGPT_COMPOSER_SHELL_NOT_FOUND — treating as clean (no body fallback)",
    );
    return {
      beforeCount: 0,
      afterCount: 0,
      removedNames: [],
      textCleared: false,
      clean: true,
      recoveredWithFreshComposer: false,
      displayedNamesBefore: [],
      displayedNamesAfter: [],
    };
  }

  const shell = resolution.shell;
  const shellToken = resolution.token;
  if (!shellToken) {
    warn(logger, "CHATGPT_COMPOSER_SHELL_TOKEN_MISSING=true");
    return {
      beforeCount: before.logicalAttachmentCount,
      afterCount: before.logicalAttachmentCount,
      removedNames: [],
      textCleared: false,
      clean: false,
      recoveredWithFreshComposer: false,
      displayedNamesBefore: before.filenames,
      displayedNamesAfter: before.filenames,
    };
  }

  const removedNames: string[] = [];

  for (let round = 0; round < MAX_ATTACHMENT_REMOVAL_ROUNDS; round += 1) {
    const discovered = await logicalSnapshot(page, composerToken || shellToken);
    if (!discovered.filenames.length) break;

    const target = discovered.filenames[0]!;
    log(logger, `CHATGPT_STALE_ATTACHMENT_REMOVING=${target}`);
    const ok = await clickCardLocalRemove(page, shellToken, target, logger);
    if (!ok) {
      warn(
        logger,
        `CHATGPT_STALE_ATTACHMENT_REMOVE_CLICK_FAILED=${target}`,
      );
      // Do NOT guess with page-wide button.first()/last() fallbacks.
      break;
    }

    await page.waitForTimeout(REMOVE_WAIT_MS);
    const afterClick = await logicalSnapshot(page, composerToken);
    const stillThere = afterClick.filenames.some(
      (n) => n.toLowerCase() === target.toLowerCase(),
    );
    if (!stillThere) {
      removedNames.push(target);
      log(logger, `CHATGPT_STALE_ATTACHMENT_REMOVED=${target}`);
    } else {
      warn(logger, `CHATGPT_STALE_ATTACHMENT_STILL_PRESENT=${target}`);
      break;
    }

    if (afterClick.logicalAttachmentCount === 0) break;
  }

  await clearComposerPromptText(page, shell, logger);

  const after = await logicalSnapshot(page, composerToken);
  log(
    logger,
    `CHATGPT_COMPOSER_ATTACHMENT_COUNT_AFTER_CLEANUP=${after.logicalAttachmentCount}`,
  );
  log(
    logger,
    `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${after.logicalAttachmentCount}`,
  );
  log(
    logger,
    `CHATGPT_CURRENT_COMPOSER_FILENAMES=${JSON.stringify(after.filenames)}`,
  );

  const clean = after.logicalAttachmentCount === 0;
  if (clean) {
    log(logger, "CHATGPT_COMPOSER_CLEAN=true");
  } else {
    warn(
      logger,
      `CHATGPT_COMPOSER_CLEAN=false remaining=${JSON.stringify(after.filenames)}`,
    );
  }

  return {
    beforeCount: before.logicalAttachmentCount,
    afterCount: after.logicalAttachmentCount,
    removedNames,
    textCleared: true,
    clean,
    recoveredWithFreshComposer: false,
    displayedNamesBefore: before.filenames,
    displayedNamesAfter: after.filenames,
  };
}

/**
 * Legacy name — MUST NOT navigate/reload.
 * Clear-in-place only. If still dirty, throw (caller opens a new page).
 */
export async function recoverFreshComposer(options: {
  page: Page;
  config: AppConfig;
  logger: Logger;
  composerToken?: string;
  workerId?: number;
}): Promise<ClearCurrentComposerResult> {
  const { page, logger, composerToken, workerId } = options;
  if (workerId != null) {
    log(logger, `CHATGPT_WORKER_ID=${workerId}`);
  }
  log(logger, "CHATGPT_COMPOSER_FRESH_RECOVERY_START=true");
  log(logger, "CHATGPT_COMPOSER_FRESH_RECOVERY_NO_NAV=true");

  if (isAtOrPastComposerReady(page)) {
    throw new AutomationError(
      "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
      "recoverFreshComposer blocked after COMPOSER_READY (no goto/reload)",
    );
  }

  const result = await clearCurrentComposer(page, { composerToken, logger });
  log(logger, `CHATGPT_COMPOSER_FRESH_RECOVERY_OK=${result.clean}`);
  return { ...result, recoveredWithFreshComposer: false };
}

export async function ensureCleanComposerForNewTender(options: {
  page: Page;
  logger: Logger;
  composerToken?: string;
  config?: AppConfig;
  workerId?: number;
}): Promise<ClearCurrentComposerResult> {
  const { page, logger, composerToken } = options;
  void options.config;
  void options.workerId;

  const result = await clearCurrentComposer(page, { composerToken, logger });
  if (!result.clean) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_NOT_CLEAN",
      `Composer still dirty after clear-in-place; open a NEW page instead of reloading. remaining=${JSON.stringify(result.displayedNamesAfter)}`,
    );
  }
  return result;
}

export async function ensureFreshWorkerComposer(options: {
  page: Page;
  config: AppConfig;
  logger: Logger;
  workerId: number;
}): Promise<{ clean: boolean; attachmentCount: number }> {
  const { page, logger, workerId } = options;
  void options.config;
  log(logger, `CHATGPT_WORKER_ID=${workerId}`);
  log(logger, "CHATGPT_WORKER_FRESH_COMPOSER_PREP=true");

  if (isAtOrPastComposerReady(page)) {
    log(logger, "CHATGPT_FRESH_COMPOSER_VERIFIED=true");
    log(logger, "CHATGPT_WORKER_FRESH_COMPOSER_READY=true");
    log(logger, "CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=0");
    return { clean: true, attachmentCount: 0 };
  }

  const result = await clearCurrentComposer(page, { logger });
  if (result.clean && isProjectHomeUrl(page.url())) {
    log(logger, "CHATGPT_FRESH_COMPOSER_VERIFIED=true");
    log(logger, `CHATGPT_WORKER_COMPOSER_ATTACHMENT_COUNT=0`);
    log(logger, `CHATGPT_WORKER_FRESH_COMPOSER_READY=true`);
    log(logger, `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=0`);
    return { clean: true, attachmentCount: 0 };
  }

  log(logger, `CHATGPT_WORKER_COMPOSER_ATTACHMENT_COUNT=${result.afterCount}`);
  log(logger, `CHATGPT_WORKER_FRESH_COMPOSER_READY=${result.clean}`);
  log(logger, `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${result.afterCount}`);

  return { clean: result.clean, attachmentCount: result.afterCount };
}
