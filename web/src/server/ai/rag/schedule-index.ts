import "server-only";

import {
  runWithDocumentSessionAsync,
} from "@/server/storage/tenderAutomationDocumentFunctions";

/**
 * Schedule AI indexing without blocking the upload response.
 * Prefer Next.js `after()` when available; fall back to fire-and-forget.
 *
 * Pass `sessionToken` so SharePoint reads still authenticate after the
 * HTTP request ends (cookies() is unavailable outside request scope).
 */
export function scheduleAiIndexing(
  task: () => Promise<unknown>,
  options?: { sessionToken?: string | null },
): void {
  const token = options?.sessionToken?.trim() || null;
  const run = () => {
    const promise = token
      ? runWithDocumentSessionAsync(token, task)
      : task();
    void promise.catch((error) => {
      console.error(
        "[ai-rag] scheduled indexing failed",
        error instanceof Error ? error.message : error,
      );
    });
  };

  try {
    // Next 16 supports after() in Route Handlers / Server Actions.
    // Dynamic import keeps this module usable from scripts/tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextServer = require("next/server") as {
      after?: (fn: () => void) => void;
    };
    if (typeof nextServer.after === "function") {
      nextServer.after(run);
      return;
    }
  } catch {
    // fall through
  }

  run();
}
