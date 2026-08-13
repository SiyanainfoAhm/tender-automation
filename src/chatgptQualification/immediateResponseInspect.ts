/**
 * Non-blocking response DOM inspection for the ChatGPT wait loop.
 * Never uses Playwright auto-wait (default timeout can be minutes).
 */
import type { Page } from "playwright";
import crypto from "node:crypto";
import type { ResponseActivitySnapshot } from "./responseWaitPolicy.js";
import { cleanAssistantAnswerTextForPoll } from "./responseTextClean.js";

export const RESPONSE_INSPECT_TIMEOUT_MS = 3_000;

export type ImmediateAssistantInspection = {
  assistantCount: number;
  /** Text for message at index = assistantCountBefore (the new response). */
  latestText: string;
  textLength: number;
  textHash: string;
  stopVisible: boolean;
  generationLabel: string;
  active: boolean;
};

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Single evaluate — count + text + stop indicator — no Playwright waits.
 */
export async function inspectLatestAssistantImmediately(
  page: Page,
  assistantCountBefore: number,
): Promise<ImmediateAssistantInspection> {
  const raw = await page.evaluate((before) => {
    const assistants = Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"]'),
    );
    const assistantCount = assistants.length;
    const idx = assistantCount > before ? before : -1;

    let latestText = "";
    if (idx >= 0 && idx < assistants.length) {
      const el = assistants[idx] as HTMLElement;
      const root = el.cloneNode(true) as HTMLElement;
      const removeSelectors = [
        "details",
        "summary",
        "button",
        '[role="button"]',
        "nav",
        '[data-testid*="copy"]',
        '[data-testid*="share"]',
        '[data-testid*="regen"]',
        '[data-testid*="feedback"]',
        '[class*="citation"]',
        '[class*="sources"]',
      ];
      for (let s = 0; s < removeSelectors.length; s += 1) {
        const nodes = root.querySelectorAll(removeSelectors[s]!);
        for (let n = 0; n < nodes.length; n += 1) {
          nodes[n]!.remove();
        }
      }
      const markdown = root.querySelector(
        '.markdown, .prose, [class*="markdown"], [data-message-content]',
      );
      latestText = (markdown?.textContent || root.textContent || "").trim();
    }

    const buttons = Array.from(document.querySelectorAll("button"));
    let stopVisible = false;
    for (let i = 0; i < buttons.length; i += 1) {
      const b = buttons[i] as HTMLElement;
      const label = `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`;
      if (!/stop generating|stop response|^stop$/i.test(label)) continue;
      const style = window.getComputedStyle(b);
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        (b.offsetParent !== null || style.position === "fixed")
      ) {
        stopVisible = true;
        break;
      }
    }

    let generationLabel = "idle";
    let streaming = false;
    if (idx >= 0 && idx < assistants.length) {
      const current = assistants[idx] as HTMLElement;
      if (
        current.querySelector(
          '[data-testid*="streaming"], .result-streaming, [class*="result-streaming"], [aria-busy="true"], [role="progressbar"]',
        )
      ) {
        streaming = true;
        generationLabel = "generating";
      }
      const labelEl = current.querySelector("*");
      const bubbleText = (current.textContent || "").slice(0, 200);
      if (/^\s*Thinking\b/i.test(bubbleText) || /\bThinking\b/i.test(bubbleText.slice(0, 40))) {
        generationLabel = "thinking";
      } else if (/\bSearching\b/i.test(bubbleText.slice(0, 40))) {
        generationLabel = "searching";
      } else if (/\bWorking\b/i.test(bubbleText.slice(0, 40))) {
        generationLabel = "working";
      }
      void labelEl;
    }
    if (stopVisible) generationLabel = "stop";

    return {
      assistantCount,
      latestText,
      stopVisible,
      generationLabel,
      streaming,
    };
  }, assistantCountBefore);

  const latestText = cleanAssistantAnswerTextForPoll(raw.latestText || "");
  const textHash = crypto
    .createHash("sha1")
    .update(latestText.slice(0, 8000))
    .digest("hex")
    .slice(0, 16);

  return {
    assistantCount: raw.assistantCount,
    latestText,
    textLength: latestText.length,
    textHash,
    stopVisible: raw.stopVisible,
    generationLabel: raw.generationLabel,
    active: raw.stopVisible || raw.streaming || raw.generationLabel !== "idle",
  };
}

export async function inspectLatestAssistantBounded(
  page: Page,
  assistantCountBefore: number,
  timeoutMs: number = RESPONSE_INSPECT_TIMEOUT_MS,
): Promise<ImmediateAssistantInspection> {
  return withTimeout(
    inspectLatestAssistantImmediately(page, assistantCountBefore),
    timeoutMs,
    "CHATGPT_ASSISTANT_INSPECTION_TIMEOUT",
  );
}

export function inspectionToActivitySnapshot(
  insp: ImmediateAssistantInspection,
): ResponseActivitySnapshot {
  return {
    assistantCount: insp.assistantCount,
    textLength: insp.textLength,
    textFingerprint: insp.textHash,
    active: insp.active,
    generationLabel: insp.generationLabel,
    stopVisible: insp.stopVisible,
  };
}

/** Fast rate-limit probe — never waits the default page timeout. */
export async function isRateLimitVisibleImmediate(page: Page): Promise<boolean> {
  try {
    return await withTimeout(
      page.evaluate(() => {
        const text = (document.body?.innerText || "").slice(0, 20_000);
        return /Too many requests|temporarily limited access|making requests too quickly/i.test(
          text,
        );
      }),
      1_500,
      "CHATGPT_RATE_LIMIT_PROBE_TIMEOUT",
    );
  } catch {
    return false;
  }
}
