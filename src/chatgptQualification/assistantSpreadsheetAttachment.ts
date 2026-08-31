/**
 * Detect ChatGPT assistant spreadsheet cards for RUN_EXCEL_SCREENING.
 *
 * Completion signals (any one is enough — download icon may be hover-only):
 *   1. "Download ... screened workbook" link in the latest assistant turn
 *   2. Visible generated filename (*.xlsx, prefer *-screened-* + run id)
 *   3. Spreadsheet file card containing that filename
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { isDailyScreeningFilenameBeforeRunDate } from "../runScreening/buildDailyScreeningOperatorPrompt.js";

const SCREENED_WORKBOOK_LINK_RE =
  /download[\s\S]{0,80}screened[\s\S]{0,40}workbook/i;
const XLSX_LOOSE_RE = /[^\s<>"'()]+\.xlsx/gi;
const DEFAULT_INPUT_XLSX = "Tender247.xlsx";

export const SCREENING_STABILITY_POLLS = 1;

export type AssistantSpreadsheetHit = {
  filename: string;
  locator: Locator;
};

export type GeneratedScreeningWorkbook = {
  filename: string;
  cardLocator: Locator;
  assistantMessageLocator: Locator;
  downloadLinkLocator: Locator | null;
  linkFound: boolean;
  filenameFound: boolean;
  cardFound: boolean;
};

export type ScreeningScanDiagnostics = {
  assistantCount: number;
  innerTextPreview: string;
  linkCount: number;
  linkTexts: string[];
  xlsxTextNodeCount: number;
  fileCardCount: number;
  downloadLinkFound: boolean;
  filenameFound: boolean;
  fileCardFound: boolean;
  filename: string | null;
  artifactLikelyPresent: boolean;
};

export type SpreadsheetScanResult = {
  filename: string | null;
  filenameMatchCount: number;
  downloadButtonCount: number;
  downloadButtonFound: boolean;
  downloadLocator: Locator | null;
  names: string[];
  cardLocator: Locator | null;
  assistantMessageLocator: Locator | null;
};

function normalizeChatText(raw: string): string {
  return raw
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
}

function extractXlsxNames(raw: string | null | undefined, inputFileName?: string): string[] {
  if (!raw) return [];
  const input = (inputFileName || DEFAULT_INPUT_XLSX).replace(/\s+/g, " ").trim().toLowerCase();
  const text = normalizeChatText(raw);
  const matches = text.match(XLSX_LOOSE_RE) || [];
  const names: string[] = [];
  for (const match of matches) {
    const name = path.basename(match.trim().replace(/[.,;:]+$/g, ""));
    if (!name || !/\.xlsx$/i.test(name)) continue;
    if (name.toLowerCase() === input) continue;
    names.push(name);
  }
  return names;
}

function pickOutputName(
  names: string[],
  inputFileName?: string,
  correlationId?: string,
): string | null {
  const input = (inputFileName || "").replace(/\s+/g, " ").trim().toLowerCase();
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const notInput = unique.filter((name) => name.toLowerCase() !== input);
  const screened = notInput.filter((name) => /screened/i.test(name));
  const pool = screened.length > 0 ? screened : notInput;
  if (correlationId) {
    const correlated = pool.find(
      (name) =>
        /screened/i.test(name) &&
        name.toUpperCase().includes(correlationId.toUpperCase()) &&
        /\.xlsx$/i.test(name),
    );
    if (correlated) return correlated;
    const byId = pool.find((name) =>
      name.toUpperCase().includes(correlationId.toUpperCase()),
    );
    if (byId) return byId;
  }
  return pool.find((name) => /\.xlsx$/i.test(name)) || pool[0] || null;
}

export async function isScreeningGenerationActive(page: Page): Promise<boolean> {
  const stop = page.getByRole("button", {
    name: /stop generating|stop response/i,
  });
  if ((await stop.count().catch(() => 0)) > 0) {
    if (await stop.last().isVisible().catch(() => false)) return true;
  }
  return false;
}

export async function countAssistantMessages(page: Page): Promise<number> {
  return page
    .locator('[data-message-author-role="assistant"]')
    .count()
    .catch(() => 0);
}

function latestAssistantLocator(page: Page): Locator {
  return page.locator('[data-message-author-role="assistant"]').last();
}

function isComposerOrUserLeak(scope: Locator): Promise<number> {
  return scope
    .locator(
      '#prompt-textarea, textarea#prompt-textarea, [data-testid="composer"], [data-message-author-role="user"]',
    )
    .count()
    .catch(() => 0);
}

/**
 * Latest assistant *response*, not the whole page.
 * ChatGPT often renders the spreadsheet card as a sibling of the markdown
 * bubble inside the conversation turn — so prefer the turn wrapper when it
 * does not also contain the composer or a user message.
 */
async function latestAssistantResponseScope(page: Page): Promise<Locator | null> {
  const assistant = latestAssistantLocator(page);
  if ((await assistant.count().catch(() => 0)) === 0) return null;

  const turns = page
    .locator(
      '[data-testid^="conversation-turn"], [data-turn="assistant"], article:has([data-message-author-role="assistant"])',
    )
    .filter({ has: page.locator('[data-message-author-role="assistant"]') });
  const turnCount = await turns.count().catch(() => 0);
  if (turnCount > 0) {
    const turn = turns.last();
    if ((await isComposerOrUserLeak(turn)) === 0) return turn;
  }

  const marked = assistant.locator(
    'xpath=ancestor::*[@data-turn="assistant" or starts-with(@data-testid,"conversation-turn")][1]',
  );
  if ((await marked.count().catch(() => 0)) > 0) {
    const turn = marked.first();
    if ((await isComposerOrUserLeak(turn)) === 0) return turn;
  }

  return assistant;
}

function screenedWorkbookLinkLocators(scope: Locator): Locator[] {
  return [
    scope.getByRole("link", { name: /download.*screened.*workbook/i }),
    scope.getByRole("button", { name: /download.*screened.*workbook/i }),
    scope.locator("a, button, [role='link'], [role='button']").filter({
      hasText: /download.*screened.*workbook/i,
    }),
    scope.getByText(/download.*completed.*screened.*workbook/i),
    scope.getByText(/download.*screened.*workbook/i),
  ];
}

function normalizeXlsxBasename(name: string): string {
  const base = path
    .basename(name.trim())
    .replace(/\s+/g, " ")
    .trim();
  // Chrome/Edge append (1), (2), … when the target filename already exists locally.
  return base.replace(/\s*\(\d+\)(?=\.xlsx$)/i, "").toLowerCase();
}

/** True when name is exactly `{DD-MM-YY}_daily Tenders.xlsx` (optionally a specific day). */
export function isDailyScreeningOutputFilename(
  name: string,
  expectedDailyFilename?: string,
): boolean {
  const base = normalizeXlsxBasename(name);
  if (!base.endsWith(".xlsx")) return false;
  if (expectedDailyFilename) {
    return base === normalizeXlsxBasename(expectedDailyFilename);
  }
  return /^\d{2}-\d{2}-\d{2}_daily tenders\.xlsx$/i.test(base);
}

function isScreenedOutputFilename(
  name: string,
  inputFileName?: string,
  expectedDailyFilename?: string,
): boolean {
  const base = path.basename(name.trim());
  if (!/\.xlsx$/i.test(base)) return false;
  const input = (inputFileName || DEFAULT_INPUT_XLSX)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (base.toLowerCase() === input) return false;
  // When the operator daily name is known, accept ONLY that file — never
  // run-screened-siyana / other dates / generic *-screened-*.xlsx.
  if (expectedDailyFilename) {
    return isDailyScreeningOutputFilename(base, expectedDailyFilename);
  }
  if (/\d{2}-\d{2}-\d{2}_daily\s+tenders\.xlsx$/i.test(base)) return true;
  return /screened/i.test(base);
}

/**
 * Scroll the conversation and locate today's daily screening Excel if GPT
 * already produced it in this chat (no re-upload needed).
 *
 * While scrolling upward: if we see a `{DD-MM-YY}_daily Tenders.xlsx` whose
 * date is *before* the pipeline run date — and today's file is still missing —
 * today's Excel does not exist yet → caller should prompt and generate.
 */
export type DailyScreeningChatLookupResult =
  | {
      status: "found";
      workbook: GeneratedScreeningWorkbook;
    }
  | {
      status: "missing_generate";
      reason: "older_daily_found" | "not_found";
      olderFilename?: string;
    };

function dailyFilenamePattern(filename: string): RegExp {
  const escaped = filename
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(escaped, "i");
}

/** ChatGPT file cards label as "Spreadsheet" or "Open file" depending on UI version. */
const FILE_CARD_LABEL_RE = /^(Spreadsheet|Open file)$/i;

function downloadLocators(scope: Locator): Locator[] {
  return [
    scope.getByRole("button", { name: /download file/i, includeHidden: true }),
    scope.getByRole("button", { name: /^download$/i, includeHidden: true }),
    scope.locator('button[aria-label*="Download file" i]'),
    scope.locator('[aria-label*="Download file" i]'),
    scope.locator('[role="button"][aria-label*="Download" i]'),
    scope.locator('button[title*="Download" i]'),
    scope.getByRole("link", { name: /download file/i }),
    scope.locator('a[download*=".xlsx" i], a[href*=".xlsx" i]'),
  ];
}

async function firstAttached(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const n = await locator.count().catch(() => 0);
    if (n > 0) return locator.last();
  }
  return null;
}

async function turnHasDownloadControl(turn: Locator): Promise<boolean> {
  return Boolean(await firstAttached(downloadLocators(turn)));
}

async function turnHasFileCardLabel(turn: Locator): Promise<boolean> {
  return (
    (await turn.getByText(FILE_CARD_LABEL_RE).count().catch(() => 0)) > 0
  );
}

function conversationTurnLocators(page: Page): Locator {
  return page.locator(
    '[data-testid^="conversation-turn"], [data-turn="user"], [data-turn="assistant"], article:has([data-message-author-role="user"]), article:has([data-message-author-role="assistant"])',
  );
}

async function findRunUserTurnIndex(
  page: Page,
  minUserIndex: number,
): Promise<number> {
  const turns = conversationTurnLocators(page);
  const turnCount = await turns.count().catch(() => 0);
  let userSeen = 0;
  for (let t = 0; t < turnCount; t += 1) {
    const turn = turns.nth(t);
    const userInTurn = await turn
      .locator('[data-message-author-role="user"]')
      .count()
      .catch(() => 0);
    if (userInTurn === 0) continue;
    if (userSeen === minUserIndex) return t;
    userSeen += 1;
  }
  return -1;
}

function assistantTurnLocators(page: Page): Locator {
  return page.locator(
    '[data-testid^="conversation-turn"]:has([data-message-author-role="assistant"]), [data-turn="assistant"], article:has([data-message-author-role="assistant"])',
  );
}

/** True when the assistant turn shows a downloadable daily Excel card, not prompt prose. */
async function assistantTurnHasDailyWorkbookArtifact(
  turn: Locator,
  expectedFilename: string,
): Promise<Locator | null> {
  const card = await cardForFilename(turn, expectedFilename);
  if (!card) return null;
  const hasFileCardLabel = await turnHasFileCardLabel(turn);
  const hasDownload = await turnHasDownloadControl(turn);
  const cardInTurn = turn
    .locator("div, article, section, li, a, button, span")
    .filter({ hasText: dailyFilenamePattern(expectedFilename) })
    .filter({ hasText: FILE_CARD_LABEL_RE });
  if ((await cardInTurn.count().catch(() => 0)) > 0) {
    return (await cardInTurn.count()) > 0 ? cardInTurn.last() : card;
  }
  if ((hasFileCardLabel || hasDownload) && hasDownload) return card;
  const turnText = await turn.innerText().catch(() => "");
  const normalizedTurnText = turnText.replace(/\s+/g, " ");
  if (
    hasDownload &&
    dailyFilenamePattern(expectedFilename).test(normalizedTurnText)
  ) {
    return card;
  }
  if (
    hasFileCardLabel &&
    dailyFilenamePattern(expectedFilename).test(normalizedTurnText)
  ) {
    return card;
  }
  return null;
}

/** Newest assistant turn only — for post-send wait (never matches user prompt text). */
export async function findLatestAssistantDailyWorkbook(
  page: Page,
  expectedFilename: string,
): Promise<GeneratedScreeningWorkbook | null> {
  const expected = expectedFilename.trim();
  if (!expected) return null;
  const turns = assistantTurnLocators(page);
  const turnCount = await turns.count().catch(() => 0);
  if (turnCount === 0) return null;
  const latestTurn = turns.nth(turnCount - 1);
  const card = await assistantTurnHasDailyWorkbookArtifact(latestTurn, expected);
  if (!card) return null;
  await card.scrollIntoViewIfNeeded().catch(() => undefined);
  return {
    filename: expected,
    cardLocator: card,
    assistantMessageLocator: latestTurn,
    downloadLinkLocator: null,
    linkFound: false,
    filenameFound: true,
    cardFound: true,
  };
}

async function scrollChatToBottom(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const main =
        document.querySelector('[class*="react-scroll"]') ||
        document.querySelector("main") ||
        document.scrollingElement;
      if (main) main.scrollTop = main.scrollHeight || 0;
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Daily Excel in an assistant reply at or after the run's user message (post-send wait). */
export async function findDailyWorkbookInAssistantAfterUserMessage(
  page: Page,
  options: {
    expectedFilename: string;
    /** 0-based user index from send baseline (userCountBefore). */
    minUserIndex: number;
  },
): Promise<GeneratedScreeningWorkbook | null> {
  const expected = options.expectedFilename.trim();
  if (!expected) return null;
  await scrollChatToBottom(page);

  const runTurnIndex = await findRunUserTurnIndex(page, options.minUserIndex);
  const turns = conversationTurnLocators(page);
  const turnCount = await turns.count().catch(() => 0);

  if (runTurnIndex >= 0) {
    for (let t = turnCount - 1; t > runTurnIndex; t -= 1) {
      const turn = turns.nth(t);
      const hasAssistant =
        (await turn
          .locator('[data-message-author-role="assistant"]')
          .count()
          .catch(() => 0)) > 0;
      if (!hasAssistant) continue;

      const card = await assistantTurnHasDailyWorkbookArtifact(turn, expected);
      if (!card) continue;
      await card.scrollIntoViewIfNeeded().catch(() => undefined);
      return {
        filename: expected,
        cardLocator: card,
        assistantMessageLocator: turn,
        downloadLinkLocator: null,
        linkFound: false,
        filenameFound: true,
        cardFound: true,
      };
    }
  }

  // Turn markers missing or file card not marked visible — bottom assistant fallback.
  return findLatestAssistantDailyWorkbook(page, expected);
}

export async function findExistingDailyScreeningWorkbookInChat(
  page: Page,
  options: {
    expectedFilename: string;
    /** Pipeline run date ISO (YYYY-MM-DD). Used to detect older daily Excels. */
    runDate: string;
    logger?: { info: (m: string) => void; warn?: (m: string) => void };
    maxScrolls?: number;
    /** Post-send wait: only scan bottom of chat; never scroll up for older files. */
    bottomOnly?: boolean;
    /** Post-send wait: only the newest assistant turn (avoid yesterday's file). */
    latestAssistantOnly?: boolean;
  },
): Promise<DailyScreeningChatLookupResult> {
  const expected = options.expectedFilename.trim();
  const runDate = String(options.runDate || "").trim().slice(0, 10);
  if (!expected) {
    return { status: "missing_generate", reason: "not_found" };
  }
  const maxScrolls = options.maxScrolls ?? 24;
  const bottomOnly = options.bottomOnly === true;
  const latestAssistantOnly = options.latestAssistantOnly === true;
  options.logger?.info(
    `CHATGPT_SCREENING_LOOK_FOR_EXISTING=${expected}${bottomOnly ? " bottomOnly=true" : ""}${latestAssistantOnly ? " latestAssistantOnly=true" : ""}`,
  );

  const tryMatchToday = async (): Promise<GeneratedScreeningWorkbook | null> => {
    if (latestAssistantOnly) {
      return findLatestAssistantDailyWorkbook(page, expected);
    }
    const turns = assistantTurnLocators(page);
    const turnCount = await turns.count().catch(() => 0);
    for (let i = turnCount - 1; i >= 0; i -= 1) {
      const turn = turns.nth(i);
      const card = await assistantTurnHasDailyWorkbookArtifact(turn, expected);
      if (!card) continue;
      if (!(await card.isVisible().catch(() => false))) continue;
      await card.scrollIntoViewIfNeeded().catch(() => undefined);
      return {
        filename: expected,
        cardLocator: card,
        assistantMessageLocator: turn,
        downloadLinkLocator: null,
        linkFound: false,
        filenameFound: true,
        cardFound: true,
      };
    }
    return null;
  };

  const findOlderDailyOnPage = async (): Promise<string | null> => {
    if (!runDate) return null;
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const matches = text.match(
      /\d{2}-\d{2}-\d{2}_daily\s+Tenders\.xlsx/gi,
    );
    if (!matches?.length) return null;
    for (const raw of matches) {
      const name = raw.replace(/\s+/g, " ").trim();
      if (name.toLowerCase() === expected.toLowerCase()) continue;
      if (isDailyScreeningFilenameBeforeRunDate(name, runDate)) {
        return name;
      }
    }
    return null;
  };

  const scrollChatUp = async () => {
    await page
      .evaluate(() => {
        const main =
          document.querySelector('[class*="react-scroll"]') ||
          document.querySelector("main") ||
          document.scrollingElement;
        if (main) main.scrollTop = Math.max(0, (main.scrollTop || 0) - 900);
        window.scrollBy(0, -900);
      })
      .catch(() => undefined);
    await page.waitForTimeout(350);
  };

  // Start at the bottom — today's file is usually the newest attachment.
  await scrollChatToBottom(page);
  let found = await tryMatchToday();
  if (found) {
    options.logger?.info(`CHATGPT_SCREENING_EXISTING_FOUND=${expected}`);
    return { status: "found", workbook: found };
  }

  if (bottomOnly) {
    await scrollChatToBottom(page);
    found = await tryMatchToday();
    if (found) {
      options.logger?.info(
        "CHATGPT_SCREENING_EXISTING_FOUND_AFTER_BOTTOM_SCROLL=true",
      );
      options.logger?.info(`CHATGPT_SCREENING_EXISTING_FOUND=${expected}`);
      return { status: "found", workbook: found };
    }
    return { status: "missing_generate", reason: "not_found" };
  }

  // Scroll upward through history — stop early if an older daily Excel appears
  // (today's file would sit below older ones; missing today ⇒ generate).
  for (let i = 0; i < maxScrolls; i += 1) {
    await scrollChatUp();
    found = await tryMatchToday();
    if (found) {
      options.logger?.info(
        `CHATGPT_SCREENING_EXISTING_FOUND_AFTER_SCROLL=${i + 1}`,
      );
      options.logger?.info(`CHATGPT_SCREENING_EXISTING_FOUND=${expected}`);
      return { status: "found", workbook: found };
    }
    const older = await findOlderDailyOnPage();
    if (older) {
      options.logger?.info(
        `CHATGPT_SCREENING_OLDER_DAILY_FOUND=${older}`,
      );
      options.logger?.info(
        "CHATGPT_SCREENING_EXISTING_NOT_FOUND=true (older daily proves today missing — will generate)",
      );
      await scrollChatToBottom(page);
      return {
        status: "missing_generate",
        reason: "older_daily_found",
        olderFilename: older,
      };
    }
  }

  options.logger?.info("CHATGPT_SCREENING_EXISTING_NOT_FOUND=true");
  await scrollChatToBottom(page);
  return { status: "missing_generate", reason: "not_found" };
}

async function firstExisting(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const n = await locator.count().catch(() => 0);
    if (n > 0) return locator.last();
  }
  return null;
}

async function collectScopeText(scope: Locator): Promise<string> {
  const text = await scope
    .evaluate((el) => {
      const chunks: string[] = [];
      const visit = (node: Element | ShadowRoot) => {
        if (node instanceof HTMLElement) {
          chunks.push(node.innerText || "");
        }
        const root: ParentNode = node;
        for (const child of Array.from(root.querySelectorAll("*"))) {
          if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
          if (child.shadowRoot) visit(child.shadowRoot);
        }
      };
      visit(el);
      return chunks.join("\n");
    })
    .catch(async () => (await scope.innerText().catch(() => "")) || "");
  return normalizeChatText(text);
}

async function cardForFilename(
  scope: Locator,
  filename: string,
): Promise<Locator | null> {
  const withBoth = scope
    .locator("div, article, section, li, a, button, span")
    .filter({ hasText: filename })
    .filter({ hasText: FILE_CARD_LABEL_RE });
  if ((await withBoth.count().catch(() => 0)) > 0) {
    return withBoth.last();
  }
  const nameLoc = scope.getByText(filename, { exact: false }).last();
  if ((await nameLoc.count().catch(() => 0)) === 0) {
    const anyScreened = scope.getByText(/screened.*\.xlsx|\.xlsx.*screened/i).last();
    if ((await anyScreened.count().catch(() => 0)) > 0) return anyScreened;
    return null;
  }
  const withFileCard = nameLoc.locator(
    'xpath=ancestor::*[contains(translate(normalize-space(.),"SPREADSHEET","spreadsheet"),"spreadsheet") or contains(normalize-space(.),"Open file")][1]',
  );
  if ((await withFileCard.count().catch(() => 0)) > 0) {
    return withFileCard.first();
  }
  const parent = nameLoc.locator("xpath=ancestor::*[1]");
  if ((await parent.count().catch(() => 0)) > 0) return parent.first();
  return nameLoc;
}

async function maybeDumpAssistantHtml(scope: Locator): Promise<void> {
  if (process.env.CHATGPT_SCREENING_DEBUG !== "1") return;
  try {
    const html = await scope.evaluate((el) => (el as HTMLElement).outerHTML);
    const dir = path.join(process.cwd(), "debug");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "chatgpt-latest-assistant.html"),
      html,
      "utf8",
    );
  } catch {
    // debug dump is best-effort
  }
}

export async function scanGeneratedScreeningOutput(
  page: Page,
  options: {
    correlationId: string;
    inputFileName?: string;
    assistantCountBefore?: number;
    expectedDailyFilename?: string;
  },
): Promise<{
  workbook: GeneratedScreeningWorkbook | null;
  diagnostics: ScreeningScanDiagnostics;
}> {
  const assistantCount = await countAssistantMessages(page);
  const assistantCountBefore = options.assistantCountBefore ?? 0;
  const emptyDiag = (
    overrides?: Partial<ScreeningScanDiagnostics>,
  ): ScreeningScanDiagnostics => ({
    assistantCount,
    innerTextPreview: "",
    linkCount: 0,
    linkTexts: [],
    xlsxTextNodeCount: 0,
    fileCardCount: 0,
    downloadLinkFound: false,
    filenameFound: false,
    fileCardFound: false,
    filename: null,
    artifactLikelyPresent: false,
    ...overrides,
  });

  const generationActive = await isScreeningGenerationActive(page);
  const assistantText = await page
    .locator('[data-message-author-role="assistant"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const assistantBody = assistantText.join("\n");
  const expectedDailyNorm = options.expectedDailyFilename
    ?.replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const previewScope = await latestAssistantResponseScope(page);
  let latestScopeHasScreenedOutput = false;
  let latestDailyArtifactCard: Locator | null = null;
  if (options.expectedDailyFilename && !generationActive) {
    const turns = assistantTurnLocators(page);
    const turnCount = await turns.count().catch(() => 0);
    if (turnCount > 0) {
      latestDailyArtifactCard = await assistantTurnHasDailyWorkbookArtifact(
        turns.nth(turnCount - 1),
        options.expectedDailyFilename,
      );
    }
  }
  if (previewScope) {
    const previewText = await collectScopeText(previewScope);
    latestScopeHasScreenedOutput = extractXlsxNames(
      previewText,
      options.inputFileName,
    ).some((name) =>
      isScreenedOutputFilename(
        name,
        options.inputFileName,
        options.expectedDailyFilename,
      ),
    );
  }

  const assistantHasExpectedDaily = expectedDailyNorm
    ? assistantBody.replace(/\s+/g, " ").toLowerCase().includes(expectedDailyNorm)
    : false;
  const responseComplete =
    !generationActive &&
    latestScopeHasScreenedOutput &&
    (assistantHasExpectedDaily ||
      /\bcompleted screening\b/i.test(assistantBody) ||
      /\bfinal tenders\b/i.test(assistantBody));

  // Ignore Excel cards from assistant turns that existed before this Send.
  // When expectedDailyFilename is set and assistantCountBefore is 0, allow
  // scanning any turn (reuse existing daily output already in the chat).
  // After Send, also scan when GPT finished or the latest assistant already
  // contains the screened workbook (count may lag behind DOM updates).
  if (
    assistantCountBefore > 0 &&
    assistantCount <= assistantCountBefore &&
    !responseComplete &&
    !latestScopeHasScreenedOutput &&
    !latestDailyArtifactCard
  ) {
    return {
      workbook: null,
      diagnostics: emptyDiag({
        innerTextPreview: `waiting_for_new_assistant baseline=${assistantCountBefore} current=${assistantCount} generating=${generationActive}`,
      }),
    };
  }

  if (latestDailyArtifactCard && options.expectedDailyFilename) {
    const turns = assistantTurnLocators(page);
    const turnCount = await turns.count().catch(() => 0);
    const latestTurn = turnCount > 0 ? turns.nth(turnCount - 1) : latestAssistantLocator(page);
    return {
      workbook: {
        filename: options.expectedDailyFilename,
        cardLocator: latestDailyArtifactCard,
        assistantMessageLocator: latestTurn,
        downloadLinkLocator: null,
        linkFound: false,
        filenameFound: true,
        cardFound: true,
      },
      diagnostics: emptyDiag({
        innerTextPreview: `latest_assistant_daily_artifact=${options.expectedDailyFilename}`,
        filename: options.expectedDailyFilename,
        filenameFound: true,
        fileCardFound: true,
        artifactLikelyPresent: true,
      }),
    };
  }

  let scope = previewScope;
  if (
    scope &&
    options.expectedDailyFilename &&
    responseComplete &&
    !(await collectScopeText(scope)).toLowerCase().includes(expectedDailyNorm || "")
  ) {
    // File card may sit outside the markdown bubble — widen to full page.
    scope = page.locator("body");
  }
  if (!scope) {
    return { workbook: null, diagnostics: emptyDiag() };
  }

  const assistant = latestAssistantLocator(page);
  await maybeDumpAssistantHtml(scope);

  const text = await collectScopeText(scope);
  const names = extractXlsxNames(text, options.inputFileName).filter((name) =>
    isScreenedOutputFilename(
      name,
      options.inputFileName,
      options.expectedDailyFilename,
    ),
  );
  const inputStem = (options.inputFileName || DEFAULT_INPUT_XLSX).replace(
    /\.xlsx$/i,
    "",
  );
  const preferred = new RegExp(
    `${inputStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-screened-${options.correlationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.xlsx|run-screened-siyana\\.xlsx|\\d{2}-\\d{2}-\\d{2}_daily\\s+tenders\\.xlsx`,
    "i",
  );
  let correlated = names.find(
    (name) =>
      preferred.test(name) ||
      (/screened/i.test(name) &&
        name.toUpperCase().includes(options.correlationId.toUpperCase())),
  );
  if (options.expectedDailyFilename) {
    const want = options.expectedDailyFilename.replace(/\s+/g, " ").trim().toLowerCase();
    const dailyHit = names.find(
      (name) => name.replace(/\s+/g, " ").trim().toLowerCase() === want,
    );
    if (dailyHit) correlated = dailyHit;
  }
  const filename =
    correlated ||
    pickOutputName(names, options.inputFileName, options.correlationId);
  let screenedFilename =
    filename &&
    isScreenedOutputFilename(
      filename,
      options.inputFileName,
      options.expectedDailyFilename,
    )
      ? filename
      : null;

  const downloadLink = await firstExisting(screenedWorkbookLinkLocators(scope));
  const xlsxNodes = scope.locator("text=/\\.xlsx/i");
  const xlsxTextNodeCount = await xlsxNodes.count().catch(() => 0);
  const spreadsheetNodes = scope.getByText(/^Spreadsheet$/i);
  const fileCardCount = await spreadsheetNodes.count().catch(() => 0);
  const fileCard = screenedFilename
    ? await cardForFilename(scope, screenedFilename)
    : fileCardCount > 0
      ? await cardForFilename(scope, names[0] || ".xlsx")
      : null;

  const linkTexts: string[] = [];
  const linkEls = scope.locator("a, [role='link']");
  const linkCount = await linkEls.count().catch(() => 0);
  for (let i = 0; i < Math.min(linkCount, 12); i += 1) {
    const t = (await linkEls.nth(i).innerText().catch(() => "")).trim();
    if (t) linkTexts.push(t.slice(0, 160));
  }

  const downloadLinkFound =
    Boolean(downloadLink) || SCREENED_WORKBOOK_LINK_RE.test(text);
  const filenameFound = Boolean(screenedFilename);
  const cardFound = Boolean(fileCard) && (fileCardCount > 0 || filenameFound);

  // Last-resort: any .xlsx / screened-workbook wording in this response
  // triggers descendant inspection — it is NOT itself a completion signal.
  const artifactLikelyPresent =
    text.toLowerCase().includes(".xlsx") ||
    SCREENED_WORKBOOK_LINK_RE.test(text) ||
    downloadLinkFound ||
    filenameFound ||
    cardFound;

  let generatedOutputFound =
    downloadLinkFound || filenameFound || cardFound;

  if (!generatedOutputFound && artifactLikelyPresent) {
    const descendantFile = scope
      .locator("a, button, [role='link'], [role='button']")
      .filter({ hasText: /\.xlsx/i });
    const descendantCount = await descendantFile.count().catch(() => 0);
    for (let i = descendantCount - 1; i >= 0 && !generatedOutputFound; i -= 1) {
      const nodeText = await descendantFile.nth(i).innerText().catch(() => "");
      const nodeNames = extractXlsxNames(nodeText, options.inputFileName).filter(
        (name) =>
          isScreenedOutputFilename(
            name,
            options.inputFileName,
            options.expectedDailyFilename,
          ),
      );
      if (nodeNames.length > 0) {
        generatedOutputFound = true;
        screenedFilename = nodeNames[0];
      }
    }
  }

  const diagnostics: ScreeningScanDiagnostics = {
    assistantCount,
    innerTextPreview: text.slice(0, 1000),
    linkCount,
    linkTexts,
    xlsxTextNodeCount,
    fileCardCount,
    downloadLinkFound,
    filenameFound,
    fileCardFound: cardFound,
    filename: screenedFilename,
    artifactLikelyPresent,
  };

  if (!generatedOutputFound) {
    return { workbook: null, diagnostics };
  }

  return {
    workbook: {
      filename:
        screenedFilename ||
        `${(options.inputFileName || DEFAULT_INPUT_XLSX).replace(/\.xlsx$/i, "")}-screened-${options.correlationId}.xlsx`,
      cardLocator: fileCard || downloadLink || assistant,
      assistantMessageLocator: assistant,
      downloadLinkLocator: downloadLink,
      linkFound: downloadLinkFound,
      filenameFound,
      cardFound,
    },
    diagnostics,
  };
}

export async function findGeneratedScreeningWorkbook(
  page: Page,
  options: {
    correlationId: string;
    inputFileName?: string;
    assistantCountBefore?: number;
    expectedDailyFilename?: string;
  },
): Promise<GeneratedScreeningWorkbook | null> {
  const { workbook } = await scanGeneratedScreeningOutput(page, options);
  return workbook;
}

export function logScreeningScanDiagnostics(
  diagnostics: ScreeningScanDiagnostics,
  log: (message: string) => void,
): void {
  log(`CHATGPT_SCREENING_LINK_COUNT=${diagnostics.linkCount}`);
  log(
    `CHATGPT_SCREENING_LINK_TEXTS=${JSON.stringify(diagnostics.linkTexts)}`,
  );
  log(`CHATGPT_SCREENING_XLSX_TEXT_NODE_COUNT=${diagnostics.xlsxTextNodeCount}`);
  log(`CHATGPT_SCREENING_FILE_CARD_COUNT=${diagnostics.fileCardCount}`);
  log(
    `CHATGPT_SCREENING_DOWNLOAD_LINK_FOUND=${diagnostics.downloadLinkFound}`,
  );
  log(`CHATGPT_SCREENING_FILENAME_FOUND=${diagnostics.filenameFound}`);
  log(`CHATGPT_SCREENING_FILE_CARD_FOUND=${diagnostics.fileCardFound}`);
  if (diagnostics.filename) {
    log(`CHATGPT_SCREENING_FILENAME=${diagnostics.filename}`);
  }
  log(
    `CHATGPT_SCREENING_ARTIFACT_LIKELY=${diagnostics.artifactLikelyPresent}`,
  );
  const preview = diagnostics.innerTextPreview.replace(/\s+/g, " ").trim();
  if (preview) {
    log(`CHATGPT_SCREENING_ASSISTANT_INNER_TEXT=${preview.slice(0, 1000)}`);
  }
}

/**
 * Prefer the visible generated-file link. Otherwise hover the card to reveal
 * the Download file control.
 */
export async function revealDownloadControl(
  page: Page,
  workbook: GeneratedScreeningWorkbook,
): Promise<Locator | null> {
  if (workbook.downloadLinkLocator) {
    if ((await workbook.downloadLinkLocator.count().catch(() => 0)) > 0) {
      return workbook.downloadLinkLocator;
    }
  }
  const prose = await firstExisting(
    screenedWorkbookLinkLocators(workbook.assistantMessageLocator),
  );
  if (prose) return prose;

  await workbook.cardLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await workbook.cardLocator.hover({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(300);

  const fromCard = await firstAttached(downloadLocators(workbook.cardLocator));
  if (fromCard) return fromCard;

  const fromAssistant = await firstAttached(
    downloadLocators(workbook.assistantMessageLocator),
  );
  if (fromAssistant) return fromAssistant;

  return workbook.cardLocator;
}

export async function scanLatestAssistantSpreadsheet(
  page: Page,
  options: {
    inputFileName?: string;
    correlationId?: string;
    assistantCountBefore?: number;
  },
): Promise<SpreadsheetScanResult> {
  if (!options.correlationId) {
    return {
      filename: null,
      filenameMatchCount: 0,
      downloadButtonCount: 0,
      downloadButtonFound: false,
      downloadLocator: null,
      names: [],
      cardLocator: null,
      assistantMessageLocator: null,
    };
  }
  const { workbook } = await scanGeneratedScreeningOutput(page, {
    correlationId: options.correlationId,
    inputFileName: options.inputFileName,
    assistantCountBefore: options.assistantCountBefore,
  });
  const visibleDownload = page.getByRole("button", { name: /download file/i });
  const downloadButtonCount = await visibleDownload.count().catch(() => 0);
  return {
    filename: workbook?.filename ?? null,
    filenameMatchCount: workbook?.filenameFound ? 1 : workbook ? 1 : 0,
    downloadButtonCount,
    downloadButtonFound:
      Boolean(workbook?.downloadLinkLocator) || downloadButtonCount > 0,
    downloadLocator:
      workbook?.downloadLinkLocator ||
      (downloadButtonCount > 0 ? visibleDownload.last() : null),
    names: workbook ? [workbook.filename] : [],
    cardLocator: workbook?.cardLocator ?? null,
    assistantMessageLocator: workbook?.assistantMessageLocator ?? null,
  };
}

export async function detectAssistantSpreadsheetFilename(
  page: Page,
  options: {
    assistantCountBefore: number;
    inputFileName?: string;
    correlationId?: string;
  },
): Promise<string | null> {
  if (!options.correlationId) return null;
  const hit = await findGeneratedScreeningWorkbook(page, {
    correlationId: options.correlationId,
    inputFileName: options.inputFileName,
    assistantCountBefore: options.assistantCountBefore,
  });
  return hit?.filename ?? null;
}

export async function findAssistantSpreadsheetAttachment(
  page: Page,
  options: {
    assistantCountBefore: number;
    inputFileName?: string;
    correlationId?: string;
    filename?: string;
  },
): Promise<AssistantSpreadsheetHit | null> {
  const hit = await findGeneratedScreeningWorkbook(page, {
    correlationId: options.correlationId || "RUN",
    inputFileName: options.inputFileName,
    assistantCountBefore: options.assistantCountBefore,
  });
  if (!hit) return null;
  const filename = options.filename || hit.filename;
  const download = await revealDownloadControl(page, hit);
  return { filename, locator: download || hit.cardLocator };
}

export async function resolveAssistantSpreadsheetHref(
  page: Page,
  locator: Locator,
  inputFileName?: string,
): Promise<string | null> {
  const input = (inputFileName || DEFAULT_INPUT_XLSX).toLowerCase();
  const candidates: Locator[] = [
    locator,
    locator.locator("xpath=ancestor::a[1]"),
    locator.locator("xpath=.//a[@href]"),
    page
      .locator('[data-message-author-role="assistant"]')
      .last()
      .locator('a[href*=".xlsx"], a[download*=".xlsx"]'),
  ];
  for (const candidate of candidates) {
    const n = await candidate.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const item = candidate.nth(i);
      const href = (await item.getAttribute("href").catch(() => null)) || "";
      const download = (await item.getAttribute("download").catch(() => null)) || "";
      if (!href || href === "#" || href.startsWith("javascript:")) continue;
      const blob = `${href} ${download}`.toLowerCase();
      if (blob.includes(input) && !/screened/i.test(blob)) continue;
      try {
        return new URL(href, page.url()).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function tryFindGeneratedWorkbookInLibrary(
  page: Page,
  options: {
    filename: string;
    correlationId: string;
    conversationUrl: string;
  },
): Promise<GeneratedScreeningWorkbook | null> {
  const libraryControl = page.getByRole("link", { name: /^library$/i }).or(
    page.getByRole("button", { name: /^library$/i }),
  );
  if ((await libraryControl.count().catch(() => 0)) === 0) return null;
  await libraryControl.first().click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
  const match = page.getByText(options.filename, { exact: false }).last();
  if ((await match.count().catch(() => 0)) === 0) {
    await page.goto(options.conversationUrl, { waitUntil: "domcontentloaded" }).catch(
      () => undefined,
    );
    return null;
  }
  return {
    filename: options.filename,
    cardLocator: match,
    assistantMessageLocator: match,
    downloadLinkLocator: null,
    linkFound: false,
    filenameFound: true,
    cardFound: true,
  };
}
