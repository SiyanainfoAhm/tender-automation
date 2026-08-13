/**
 * Tender page lifecycle + centralized ChatGPT navigation.
 *
 * Navigation is allowed ONLY in NEW_PAGE / PROJECT_LOADING.
 * After COMPOSER_READY, any explicit goto/reload throws.
 */
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";

export type TenderPageLifecycleState =
  | "NEW_PAGE"
  | "PROJECT_LOADING"
  | "COMPOSER_READY"
  | "FILES_UPLOADING"
  | "FILES_LOCKED"
  | "PROMPT_READY"
  | "WAITING_FOR_SEND_SLOT"
  | "SUBMITTED"
  | "WAITING_RESPONSE"
  | "RESPONSE_COMPLETE"
  | "PERSISTING"
  | "DONE"
  | "FAILED";

const STATE_ORDER: TenderPageLifecycleState[] = [
  "NEW_PAGE",
  "PROJECT_LOADING",
  "COMPOSER_READY",
  "FILES_UPLOADING",
  "FILES_LOCKED",
  "PROMPT_READY",
  "WAITING_FOR_SEND_SLOT",
  "SUBMITTED",
  "WAITING_RESPONSE",
  "RESPONSE_COMPLETE",
  "PERSISTING",
  "DONE",
];

export type TenderPageNavMeta = {
  workerId: number;
  tenderId: string;
  state: TenderPageLifecycleState;
  projectNavigationCount: number;
  pageReloadCount: number;
  observersAttached: boolean;
};

const metaByPage = new WeakMap<Page, TenderPageNavMeta>();

function shortStack(): string {
  const stack = new Error().stack || "";
  return stack
    .split("\n")
    .slice(2, 8)
    .map((l) => l.trim())
    .join(" | ")
    .slice(0, 500);
}

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

function warn(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.warn(message);
}

export function getTenderPageNavMeta(page: Page): TenderPageNavMeta | null {
  return metaByPage.get(page) ?? null;
}

export function initTenderPageLifecycle(
  page: Page,
  workerId: number,
  tenderId: string,
): TenderPageNavMeta {
  const meta: TenderPageNavMeta = {
    workerId,
    tenderId,
    state: "NEW_PAGE",
    projectNavigationCount: 0,
    pageReloadCount: 0,
    observersAttached: false,
  };
  metaByPage.set(page, meta);
  return meta;
}

export function setTenderPageLifecycleState(
  page: Page,
  state: TenderPageLifecycleState,
  logger?: Logger,
): void {
  const meta = metaByPage.get(page);
  if (!meta) {
    throw new AutomationError(
      "CHATGPT_PAGE_LIFECYCLE_MISSING",
      `Cannot set state=${state} — page has no lifecycle meta`,
    );
  }
  meta.state = state;
  log(logger, `CHATGPT_TENDER_PAGE_STATE=${state}`);
  log(logger, `CHATGPT_WORKER_ID=${meta.workerId}`);
  log(logger, `CHATGPT_TENDER_ID=${meta.tenderId}`);
}

export function isNavigationAllowed(state: TenderPageLifecycleState): boolean {
  return state === "NEW_PAGE" || state === "PROJECT_LOADING";
}

export function assertNavigationAllowed(
  page: Page,
  kind: "goto" | "reload",
  reason: string,
): TenderPageNavMeta {
  const meta = metaByPage.get(page);
  if (!meta) {
    // Pages without lifecycle (login/anchor) — allow but log.
    return {
      workerId: 0,
      tenderId: "untracked",
      state: "NEW_PAGE",
      projectNavigationCount: 0,
      pageReloadCount: 0,
      observersAttached: false,
    };
  }
  if (!isNavigationAllowed(meta.state)) {
    throw new AutomationError(
      "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
      `Forbidden ${kind} after state=${meta.state} tender=${meta.tenderId} reason=${reason}`,
    );
  }
  return meta;
}

/** Attach main-frame observability (does not navigate). */
export function attachChatGptNavigationObservers(
  page: Page,
  logger?: Logger,
): void {
  const meta = metaByPage.get(page);
  if (meta?.observersAttached) return;
  if (meta) meta.observersAttached = true;

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    const m = metaByPage.get(page);
    log(
      logger,
      `CHATGPT_MAIN_FRAME_NAVIGATED=${url} state=${m?.state ?? "unknown"} tender=${m?.tenderId ?? "unknown"}`,
    );
  });

  page.on("load", () => {
    const m = metaByPage.get(page);
    log(
      logger,
      `CHATGPT_PAGE_LOAD_EVENT url=${page.url()} state=${m?.state ?? "unknown"}`,
    );
  });

  page.on("domcontentloaded", () => {
    const m = metaByPage.get(page);
    log(
      logger,
      `CHATGPT_DOMCONTENTLOADED_EVENT url=${page.url()} state=${m?.state ?? "unknown"}`,
    );
  });
}

/**
 * ONLY allowed entry for explicit ChatGPT page.goto in tender lifecycle.
 */
export async function chatGptPageGoto(
  page: Page,
  url: string,
  options: {
    reason: string;
    logger?: Logger;
    waitUntil?: "domcontentloaded" | "load" | "commit";
    timeout?: number;
    /** When true, page is not under tender lifecycle (login/anchor). */
    untracked?: boolean;
  },
): Promise<void> {
  const from = page.url();
  let meta: TenderPageNavMeta | null = metaByPage.get(page) ?? null;

  if (!options.untracked) {
    meta = assertNavigationAllowed(page, "goto", options.reason);
  }

  const workerId = meta?.workerId ?? 0;
  const tenderId = meta?.tenderId ?? "untracked";
  const state = meta?.state ?? "NEW_PAGE";

  log(options.logger, "CHATGPT_NAVIGATION_CALL");
  log(options.logger, `workerId=${workerId}`);
  log(options.logger, `tenderId=${tenderId}`);
  log(options.logger, `state=${state}`);
  log(options.logger, `from=${from}`);
  log(options.logger, `to=${url}`);
  log(options.logger, `reason=${options.reason}`);
  log(options.logger, `stack=${shortStack()}`);

  if (meta && !options.untracked) {
    if (meta.projectNavigationCount >= 1) {
      warn(options.logger, "CHATGPT_PROJECT_NAVIGATION_LOOP_DETECTED=true");
      throw new AutomationError(
        "CHATGPT_PROJECT_NAVIGATION_LOOP",
        `Second explicit goto forbidden on same page tender=${tenderId} count=${meta.projectNavigationCount} reason=${options.reason}`,
      );
    }
    meta.projectNavigationCount += 1;
    log(
      options.logger,
      `CHATGPT_PROJECT_NAVIGATION_COUNT=${meta.projectNavigationCount}`,
    );
  }

  await page.goto(url, {
    waitUntil: options.waitUntil ?? "domcontentloaded",
    timeout: options.timeout ?? 120_000,
  });
}

/**
 * ONLY allowed entry for explicit ChatGPT page.reload — normally forbidden.
 */
export async function chatGptPageReload(
  page: Page,
  options: {
    reason: string;
    logger?: Logger;
    waitUntil?: "domcontentloaded" | "load" | "commit";
    timeout?: number;
  },
): Promise<void> {
  const meta = assertNavigationAllowed(page, "reload", options.reason);

  warn(options.logger, "CHATGPT_RELOAD_CALL");
  warn(options.logger, `workerId=${meta.workerId}`);
  warn(options.logger, `tenderId=${meta.tenderId}`);
  warn(options.logger, `state=${meta.state}`);
  warn(options.logger, `reason=${options.reason}`);
  warn(options.logger, `stack=${shortStack()}`);

  // Reloads are never part of the normal tender path.
  throw new AutomationError(
    "CHATGPT_RELOAD_FORBIDDEN",
    `page.reload is forbidden in ChatGPT tender lifecycle tender=${meta.tenderId} reason=${options.reason}`,
  );
}

export function getProjectNavigationCount(page: Page): number {
  return metaByPage.get(page)?.projectNavigationCount ?? 0;
}

export function getPageReloadCount(page: Page): number {
  return metaByPage.get(page)?.pageReloadCount ?? 0;
}

export function clearTenderPageLifecycle(page: Page): void {
  metaByPage.delete(page);
}

/** True if state has reached COMPOSER_READY or later (nav forbidden). */
export function isAtOrPastComposerReady(page: Page): boolean {
  const meta = metaByPage.get(page);
  if (!meta) return false;
  const idx = STATE_ORDER.indexOf(meta.state);
  const readyIdx = STATE_ORDER.indexOf("COMPOSER_READY");
  if (idx < 0 || readyIdx < 0) return false;
  return idx >= readyIdx;
}
