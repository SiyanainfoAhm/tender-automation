import "server-only";
import { after } from "next/server";

import {
  runWithDocumentSessionAsync,
} from "@/server/storage/tenderAutomationDocumentFunctions";

/**
 * Schedule AI indexing without blocking the HTTP response body.
 *
 * Prefer (in order):
 * 1) Vercel `waitUntil` — keeps the isolate alive after the response
 * 2) Next.js `after()` — same intent on supported Next runtimes
 * 3) Fire-and-forget — last resort (may die on serverless when the request ends)
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
      : Promise.resolve().then(task);
    return promise.catch((error) => {
      console.error(
        "[ai-rag] scheduled indexing failed",
        error instanceof Error ? error.message : error,
      );
    });
  };

  try {
    after(() => run());
    return;
  } catch {
    // `after()` is only available in a Next.js request context.
  }

  // Last resort — may not survive serverless request teardown.
  console.warn(
    "[ai-rag] scheduleAiIndexing falling back to fire-and-forget (no waitUntil/after)",
  );
  void run();
}
