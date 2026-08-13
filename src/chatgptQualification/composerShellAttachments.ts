/**
 * Composer editor vs shell scoping + logical attachment filename discovery.
 *
 * ChatGPT places attachment cards as SIBLINGS of the contenteditable editor,
 * not as children. Detection must use composerShell, never editor-only.
 */
import type { Locator, Page } from "playwright";

export const COMPOSER_TOKEN_ATTR = "data-agenttender-composer-token";

export type ComposerShellResolution = {
  editor: Locator;
  shell: Locator;
  editorFound: boolean;
  shellFound: boolean;
  token: string | null;
};

export type LogicalAttachmentTypes = {
  metadata: boolean;
  aiSummary: boolean;
  documentsZip: boolean;
};

export type DiscoveredComposerAttachments = {
  filenames: string[];
  logicalTypes: LogicalAttachmentTypes;
  /** Distinct logical types present (metadata + ai + zip). */
  logicalAttachmentCount: number;
  /** Structural Remove-file button count (diagnostics only). */
  structuralRemoveButtonCount: number;
};

const EDITOR_SELECTOR =
  '[contenteditable="true"]#prompt-textarea, [contenteditable="true"][aria-label*="Message" i], [contenteditable="true"][aria-label*="chat" i], [contenteditable="true"], textarea#prompt-textarea, .ProseMirror';

export function classifyLogicalAttachmentFilename(name: string): {
  metadata: boolean;
  aiSummary: boolean;
  documentsZip: boolean;
} {
  const base = name.replace(/\s+/g, " ").trim();
  const metadata = /^metadata/i.test(base) && /\.json$/i.test(base);
  const aiSummary = /^AI[_\s-]*Summary/i.test(base) && /\.pdf$/i.test(base);
  const documentsZip =
    (/^Tender[_\s-]*All[_\s-]*Documents/i.test(base) && /\.zip$/i.test(base)) ||
    (/Tender[_\s-]*All[_\s-]*Doc/i.test(base) && /\.zip$/i.test(base));
  return { metadata, aiSummary, documentsZip };
}

export function logicalTypesFromFilenames(
  filenames: string[],
): LogicalAttachmentTypes {
  const out: LogicalAttachmentTypes = {
    metadata: false,
    aiSummary: false,
    documentsZip: false,
  };
  for (const name of filenames) {
    const c = classifyLogicalAttachmentFilename(name);
    if (c.metadata) out.metadata = true;
    if (c.aiSummary) out.aiSummary = true;
    if (c.documentsZip) out.documentsZip = true;
  }
  return out;
}

/** Count only types that are required for the current tender. */
export function countMatchingExpectedLogical(
  types: LogicalAttachmentTypes,
  aiSummaryRequired: boolean,
): number {
  let n = 0;
  if (types.metadata) n += 1;
  if (types.documentsZip) n += 1;
  if (aiSummaryRequired && types.aiSummary) n += 1;
  return n;
}

export function expectedLogicalAttachmentCount(options: {
  aiSummaryRequired: boolean;
}): number {
  return options.aiSummaryRequired ? 3 : 2;
}

export function isExpectedLogicalSetComplete(options: {
  types: LogicalAttachmentTypes;
  aiSummaryRequired: boolean;
}): boolean {
  if (!options.types.metadata) return false;
  if (!options.types.documentsZip) return false;
  if (options.aiSummaryRequired && !options.types.aiSummary) return false;
  return true;
}

export function getComposerEditorLocator(page: Page): Locator {
  return page.locator(EDITOR_SELECTOR).filter({ visible: true }).last();
}

/**
 * Walk upward from editor (or token mark) to the shell that contains
 * editor + action controls, and attachment cards when present.
 * Marks the resolved shell with COMPOSER_TOKEN_ATTR when a token is provided.
 */
export async function resolveComposerShell(
  page: Page,
  options?: { composerToken?: string },
): Promise<ComposerShellResolution> {
  const editor = getComposerEditorLocator(page);
  const editorFound =
    (await editor.count().catch(() => 0)) > 0 &&
    (await editor.isVisible().catch(() => false));

  let start: Locator = editor;
  const token = options?.composerToken ?? null;

  if (token) {
    const marked = page.locator(`[${COMPOSER_TOKEN_ATTR}="${token}"]`);
    if ((await marked.count().catch(() => 0)) > 0) {
      start = marked.first();
    }
  }

  if (!editorFound && (await start.count().catch(() => 0)) === 0) {
    return {
      editor,
      shell: page.locator("body"),
      editorFound: false,
      shellFound: false,
      token,
    };
  }

  const markToken = token || `agenttender-shell-${Date.now().toString(36)}`;

  let evaluateError = "";
  const markedOk = await start
    .evaluate(
      // NOTE: keep this callback flat — no nested function declarations.
      // tsx/esbuild injects __name() which breaks Playwright serialization.
      (node, tokenAttr) => {
        Array.from(document.querySelectorAll(`[${tokenAttr.name}]`))
          .filter((n) => n.getAttribute(tokenAttr.name) === tokenAttr.value)
          .forEach((n) => n.removeAttribute(tokenAttr.name));

        let el: Element | null =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as Element)
            : (node as Node).parentElement;

        const actionAncestors: Element[] = [];
        for (let depth = 0; el && depth < 16; depth += 1) {
          const hasEditor =
            Boolean(
              el.querySelector(
                '[contenteditable="true"], textarea#prompt-textarea, .ProseMirror',
              ),
            ) || (el as HTMLElement).isContentEditable === true;
          const buttons = Array.from(el.querySelectorAll("button"));
          const joined = buttons
            .map(
              (b) =>
                `${b.getAttribute("aria-label") || ""} ${b.getAttribute("data-testid") || ""} ${b.textContent || ""}`,
            )
            .join(" | ");
          const hasActions =
            /send|stop/i.test(joined) ||
            /microphone|voice|speech|mic/i.test(joined) ||
            /add files|upload|attach|\+/i.test(joined) ||
            buttons.length >= 2 ||
            Boolean(el.querySelector('input[type="file"]'));
          if (hasEditor && hasActions) {
            actionAncestors.push(el);
          }
          el = el.parentElement;
        }

        if (actionAncestors.length === 0) {
          const fallback =
            (node as Element).parentElement || (node as Element);
          fallback.setAttribute(tokenAttr.name, tokenAttr.value);
          return { ok: true, reason: "no-action-ancestors" };
        }

        let withFiles: Element | null = null;
        for (let i = 0; i < actionAncestors.length; i += 1) {
          const candidate = actionAncestors[i]!;
          const tag = candidate.tagName;
          if (tag === "BODY" || tag === "HTML" || tag === "MAIN") continue;
          // Never treat chat history / prior messages as composer attachments.
          const composerOnlyButtons = Array.from(
            candidate.querySelectorAll("button"),
          ).filter((b) => {
            const host = b.closest(
              '[data-message-author-role], [data-testid*="conversation"], #history',
            );
            return !host;
          });
          const hasRemove = composerOnlyButtons.some((b) =>
            /remove file|delete file/i.test(b.getAttribute("aria-label") || ""),
          );
          // Compact attachment cards (siblings of editor) — NOT free-text
          // page search. Card must be small + filename + local remove/X.
          let hasCompactCard = false;
          const cards = Array.from(
            candidate.querySelectorAll(
              "[class*='file' i], [class*='attachment' i], [data-testid*='file' i], li, div",
            ),
          );
          for (let ci = 0; ci < cards.length; ci += 1) {
            const card = cards[ci] as HTMLElement;
            if (
              card.closest(
                '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside',
              )
            ) {
              continue;
            }
            const t = (card.innerText || "").replace(/\s+/g, " ").trim();
            if (!t || t.length > 180) continue;
            if (card.querySelector('[contenteditable="true"], textarea')) {
              continue;
            }
            if (
              !/\b(metadata[^\s]*\.json|AI[_\s-]*Summary[^\s]*\.pdf|Tender[_\s-]*All[_\s-]*Documents[^\s]*\.zip)\b/i.test(
                t,
              )
            ) {
              continue;
            }
            const lbs = Array.from(
              card.querySelectorAll("button, [role='button']"),
            ) as HTMLElement[];
            for (let li = 0; li < lbs.length; li += 1) {
              const lb = lbs[li]!;
              const lab = `${lb.getAttribute("aria-label") || ""} ${lb.getAttribute("title") || ""} ${lb.className || ""}`;
              if (
                /(?:Remove|Delete)\s+file/i.test(lab) ||
                lb.classList.contains("x") ||
                ((lb.textContent || "").trim() === "" &&
                  Boolean(lb.querySelector("svg")))
              ) {
                hasCompactCard = true;
                break;
              }
            }
            if (hasCompactCard) break;
          }
          if (hasRemove || hasCompactCard) {
            withFiles = candidate;
            break; // innermost shell that contains attachments
          }
        }

        const usable = actionAncestors.filter(
          (a) => a.tagName !== "BODY" && a.tagName !== "HTML",
        );
        // With files: innermost shell that contains them.
        // Without files: innermost action row (do NOT climb to <main>/page).
        const shellEl = withFiles || usable[0] || actionAncestors[0]!;
        shellEl.setAttribute(tokenAttr.name, tokenAttr.value);
        return {
          ok: true,
          reason: withFiles ? "with-files" : "innermost-actions",
          id: (shellEl as HTMLElement).id || "",
          actionCount: actionAncestors.length,
        };
      },
      { name: COMPOSER_TOKEN_ATTR, value: markToken },
    )
    .catch((error: unknown) => {
      evaluateError =
        error instanceof Error ? error.message : String(error);
      return null;
    });

  if (evaluateError) {
    console.log(`CHATGPT_COMPOSER_SHELL_EVAL_ERROR=${evaluateError}`);
  }

  let shell: Locator;
  const markSucceeded =
    markedOk &&
    typeof markedOk === "object" &&
    (markedOk as { ok?: boolean }).ok === true;
  if (markSucceeded) {
    shell = page.locator(`[${COMPOSER_TOKEN_ATTR}="${markToken}"]`).first();
  } else {
    shell = editor
      .locator(
        'xpath=ancestor::form[1] | ancestor::*[.//button[@data-testid="send-button"] or .//button[contains(translate(@aria-label,"SEND","send"),"send")]][1]',
      )
      .first();
    if ((await shell.count().catch(() => 0)) === 0) {
      shell = editor;
    }
    if (token) {
      await shell
        .evaluate(
          (element, tokenAttr) => {
            element.setAttribute(tokenAttr.name, tokenAttr.value);
          },
          { name: COMPOSER_TOKEN_ATTR, value: markToken },
        )
        .catch(() => undefined);
    }
  }

  const shellFound =
    (await shell.count().catch(() => 0)) > 0 &&
    (await shell.isVisible().catch(() => false));

  return {
    editor,
    shell,
    editorFound,
    shellFound,
    token: markToken,
  };
}

/**
 * Discover attachment filenames inside composerShell only (not page-wide).
 *
 * SOURCE OF TRUTH = structural attachment cards in the current composer:
 *   - buttons with aria-label "Remove file: <name>" / "Delete file: <name>"
 *   - OR compact file cards that contain BOTH a logical filename AND a
 *     card-local remove/X control
 *
 * NEVER free-text search the whole shell/page for "metadata.json".
 */
// Temporary snippet file — will be inlined; delete after.
export async function discoverComposerShellAttachments(
  shell: Locator,
): Promise<DiscoveredComposerAttachments> {
  const raw = await shell
    .evaluate((root) => {
      // Flat callback only — nested fns break under tsx (__name).
      const names: string[] = [];
      const seen: Record<string, boolean> = {};

      const buttons = Array.from(
        root.querySelectorAll("button, [role='button']"),
      ) as HTMLElement[];
      for (let i = 0; i < buttons.length; i += 1) {
        const b = buttons[i]!;
        if (
          b.closest(
            '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside, [data-testid*="sidebar"]',
          )
        ) {
          continue;
        }
        const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`.replace(
          /\s+/g,
          " ",
        );
        if (
          /\b(share|more options|rename|pin chat|archive|move to project|remove from project)\b/i.test(
            label,
          )
        ) {
          continue;
        }
        const m = label.match(
          /(?:Remove|Delete)\s+file(?:\s+\d+)?:?\s*(.+)$/i,
        );
        if (m?.[1]) {
          const trimmed = m[1].replace(/\s+/g, " ").trim();
          if (trimmed && !seen[trimmed]) {
            seen[trimmed] = true;
            names.push(trimmed);
          }
        }
      }

      const cardCandidates = Array.from(
        root.querySelectorAll(
          "[class*='file' i], [class*='attachment' i], [data-testid*='file' i], li, div",
        ),
      ) as HTMLElement[];
      for (let i = 0; i < cardCandidates.length; i += 1) {
        const card = cardCandidates[i]!;
        if (
          card.closest(
            '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside, [data-testid*="sidebar"]',
          )
        ) {
          continue;
        }
        const text = (card.innerText || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 180) continue;
        if (card.querySelector('[contenteditable="true"], textarea')) continue;

        const fileMatch = text.match(
          /\b(metadata[^\s/\\]*\.json|AI[_\s-]*Summary[^\s/\\]*\.pdf|Tender[_\s-]*All[_\s-]*Documents[^\s/\\]*\.zip)\b/i,
        );
        if (!fileMatch) continue;

        const localButtons = Array.from(
          card.querySelectorAll("button, [role='button']"),
        ) as HTMLElement[];
        let hasLocalRemove = false;
        for (let j = 0; j < localButtons.length; j += 1) {
          const lb = localButtons[j]!;
          const lab = `${lb.getAttribute("aria-label") || ""} ${lb.getAttribute("title") || ""} ${lb.className || ""}`.replace(
            /\s+/g,
            " ",
          );
          if (
            /\b(share|more options|rename|pin chat|archive|move to project|remove from project|send|add files|voice|microphone)\b/i.test(
              lab,
            )
          ) {
            continue;
          }
          if (
            /(?:Remove|Delete)\s+file/i.test(lab) ||
            /\b(remove|delete|dismiss)\b/i.test(lab) ||
            lb.classList.contains("x") ||
            ((lb.textContent || "").trim() === "" &&
              Boolean(lb.querySelector("svg")))
          ) {
            hasLocalRemove = true;
            break;
          }
        }
        if (!hasLocalRemove) continue;
        const fname = fileMatch[1]!.replace(/\s+/g, "");
        if (!seen[fname]) {
          seen[fname] = true;
          names.push(fname);
        }
      }

      let structuralRemoveButtonCount = 0;
      for (let i = 0; i < buttons.length; i += 1) {
        const b = buttons[i]!;
        if (
          b.closest(
            '[data-message-author-role], [data-testid*="conversation"], #history, nav, aside',
          )
        ) {
          continue;
        }
        if (
          /(?:Remove|Delete)\s+file/i.test(b.getAttribute("aria-label") || "")
        ) {
          structuralRemoveButtonCount += 1;
        }
      }

      return { names, structuralRemoveButtonCount };
    })
    .catch(() => ({
      names: [] as string[],
      structuralRemoveButtonCount: 0,
    }));

  const filenames = raw.names.filter((n) => {
    const c = classifyLogicalAttachmentFilename(n);
    return c.metadata || c.aiSummary || c.documentsZip;
  });

  const logicalTypes = logicalTypesFromFilenames(filenames);

  return {
    filenames,
    logicalTypes,
    logicalAttachmentCount:
      Number(logicalTypes.metadata) +
      Number(logicalTypes.aiSummary) +
      Number(logicalTypes.documentsZip),
    structuralRemoveButtonCount: raw.structuralRemoveButtonCount,
  };
}

export async function discoverComposerAttachments(
  page: Page,
  options?: { composerToken?: string; aiSummaryRequired?: boolean },
): Promise<
  DiscoveredComposerAttachments & {
    resolution: ComposerShellResolution;
    expectedLogicalComplete: boolean;
    matchingExpectedCount: number;
  }
> {
  const resolution = await resolveComposerShell(page, options);
  const discovered = resolution.shellFound
    ? await discoverComposerShellAttachments(resolution.shell)
    : {
        filenames: [],
        logicalTypes: {
          metadata: false,
          aiSummary: false,
          documentsZip: false,
        },
        logicalAttachmentCount: 0,
        structuralRemoveButtonCount: 0,
      };

  const aiSummaryRequired = options?.aiSummaryRequired === true;
  const matchingExpectedCount = countMatchingExpectedLogical(
    discovered.logicalTypes,
    aiSummaryRequired,
  );
  const expectedLogicalComplete = isExpectedLogicalSetComplete({
    types: discovered.logicalTypes,
    aiSummaryRequired,
  });

  return {
    ...discovered,
    resolution,
    expectedLogicalComplete,
    matchingExpectedCount,
  };
}
