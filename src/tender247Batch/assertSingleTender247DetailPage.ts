import type { BrowserContext, Page } from "playwright";

export class Tender247SequentialInvariantError extends Error {
  readonly code = "T247_SEQUENTIAL_DETAIL_INVARIANT_VIOLATION";
  constructor(message: string) {
    super(message.startsWith("T247_SEQUENTIAL_DETAIL_INVARIANT_VIOLATION")
      ? message
      : `T247_SEQUENTIAL_DETAIL_INVARIANT_VIOLATION ${message}`);
    this.name = "Tender247SequentialInvariantError";
  }
}

export function countActiveTender247DetailPages(
  context: BrowserContext,
  listPage?: Page | null,
): number {
  return context.pages().filter((page) => {
    if (page.isClosed()) return false;
    if (listPage && page === listPage) return false;
    const url = page.url();
    return /\/(?:auth\/)?tender\/\d+/i.test(url);
  }).length;
}

export function assertSingleTender247DetailPage(
  context: BrowserContext,
  listPage: Page | null | undefined,
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void },
): number {
  const count = countActiveTender247DetailPages(context, listPage ?? undefined);
  logger?.info(`T247_ACTIVE_DETAIL_PAGE_COUNT=${count}`);
  if (count > 1) {
    throw new Tender247SequentialInvariantError(
      `T247_SEQUENTIAL_DETAIL_INVARIANT_VIOLATION activeTender247Pages=${count} (max=1)`,
    );
  }
  return count;
}

export async function closeExtraTender247DetailPages(
  context: BrowserContext,
  listPage: Page | null | undefined,
): Promise<void> {
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    if (listPage && page === listPage) continue;
    await page.close({ runBeforeUnload: false }).catch(() => undefined);
  }
}
