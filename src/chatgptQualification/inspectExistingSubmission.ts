/**
 * Inspect an existing ChatGPT conversation before any prompt/Send/retry.
 *
 * Absolute rule: if an assistant response exists for this submission,
 * prompt/send/upload are forbidden — consume the response instead.
 */
import type { Page } from "playwright";
import type { Logger } from "../logger.js";
import { tryParseCanonicalQualificationJson } from "./canonicalJsonCompletion.js";
import { isConversationUrl } from "./chatInteraction.js";

export type ExistingSubmissionInspection = {
  promptSubmitted: boolean;
  conversationUrl: string | null;
  userMessagePresent: boolean;
  assistantMessagePresent: boolean;
  assistantText: string;
  validQualificationJsonPresent: boolean;
  promptEntryAllowed: boolean;
  sendAllowed: boolean;
  uploadAllowed: boolean;
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

/**
 * Read-only DOM inspect of the current page for this tender's submission/response.
 */
export async function inspectExistingSubmissionAndResponse(options: {
  page: Page;
  expectedT247Id: string;
  logger?: Logger;
}): Promise<ExistingSubmissionInspection> {
  const { page, expectedT247Id, logger } = options;
  const url = page.url();
  const conversationUrl = isConversationUrl(url) ? url : null;

  const snapshot = await page
    .evaluate((tenderId) => {
      const users = Array.from(
        document.querySelectorAll('[data-message-author-role="user"]'),
      ) as HTMLElement[];
      const assistants = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]'),
      ) as HTMLElement[];

      const idRe = new RegExp(`T247-${tenderId}\\b|\\b${tenderId}\\b`, "i");
      let userMessagePresent = false;
      for (let i = users.length - 1; i >= 0; i -= 1) {
        const text = (users[i]!.innerText || "").trim();
        if (!idRe.test(text)) continue;
        if (
          /Evaluate this tender for Siyana Info Solutions/i.test(text) ||
          /ONE JSON object only|previous status|not valid JSON|For tender T247-/i.test(
            text,
          )
        ) {
          userMessagePresent = true;
          break;
        }
      }

      let assistantText = "";
      // Any assistant node blocks duplicate Send — including empty/generating.
      const assistantMessagePresent = assistants.length > 0;
      if (assistantMessagePresent) {
        const latest = assistants[assistants.length - 1]!;
        const md = latest.querySelector(
          ".markdown, [class*='markdown'], .prose",
        ) as HTMLElement | null;
        assistantText = (md?.innerText || latest.innerText || "").trim();
      }

      return {
        userMessagePresent,
        assistantMessagePresent,
        assistantText,
        userCount: users.length,
        assistantCount: assistants.length,
      };
    }, expectedT247Id)
    .catch(() => ({
      userMessagePresent: false,
      assistantMessagePresent: false,
      assistantText: "",
      userCount: 0,
      assistantCount: 0,
    }));

  const jsonParse = snapshot.assistantText
    ? tryParseCanonicalQualificationJson(
        snapshot.assistantText,
        expectedT247Id,
      )
    : { ok: false as const, reason: "no_text" };

  const validQualificationJsonPresent = jsonParse.ok === true;
  const promptSubmitted =
    Boolean(conversationUrl) && snapshot.userMessagePresent;

  // Response exists (even partial) OR submitted user message → no more prompt/send.
  const blockDuplicate =
    snapshot.assistantMessagePresent || promptSubmitted;

  const result: ExistingSubmissionInspection = {
    promptSubmitted,
    conversationUrl,
    userMessagePresent: snapshot.userMessagePresent,
    assistantMessagePresent: snapshot.assistantMessagePresent,
    assistantText: snapshot.assistantText,
    validQualificationJsonPresent,
    promptEntryAllowed: !blockDuplicate,
    sendAllowed: !blockDuplicate,
    uploadAllowed: !blockDuplicate,
  };

  log(logger, `CHATGPT_PRE_PROMPT_EXISTING_USER_MESSAGE=${result.userMessagePresent}`);
  log(
    logger,
    `CHATGPT_PRE_PROMPT_EXISTING_ASSISTANT_MESSAGE=${result.assistantMessagePresent}`,
  );
  log(
    logger,
    `CHATGPT_PRE_PROMPT_EXISTING_VALID_JSON=${result.validQualificationJsonPresent}`,
  );

  if (result.assistantMessagePresent) {
    log(logger, "CHATGPT_EXISTING_RESPONSE_DETECTED=true");
    log(logger, "CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
  } else if (result.promptSubmitted) {
    log(logger, "CHATGPT_PROMPT_SUBMITTED=true");
    log(logger, "CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
  }

  return result;
}

/** Pure policy: may automation enter another qualification prompt? */
export function mayEnterQualificationPrompt(inspection: {
  promptSubmitted: boolean;
  assistantMessagePresent: boolean;
  conversationUrl?: string | null;
}): boolean {
  if (inspection.assistantMessagePresent) return false;
  if (inspection.promptSubmitted) return false;
  if (
    inspection.conversationUrl &&
    /\/c\/[^/?#]+/i.test(inspection.conversationUrl)
  ) {
    // Conversation URL alone is not enough without user message, but
    // prefer blocking when already on /c/ with unknown state — callers
    // should inspect first.
  }
  return true;
}

/** Pure policy: after assistant exists, Send/upload forbidden. */
export function maySendOrUploadAfterResponse(options: {
  assistantMessagePresent: boolean;
  promptSubmitted: boolean;
}): boolean {
  if (options.assistantMessagePresent) return false;
  if (options.promptSubmitted) return false;
  return true;
}
