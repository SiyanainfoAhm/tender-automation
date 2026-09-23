import "server-only";

import {
  runWithDocumentSessionAsync,
} from "@/server/storage/tenderAutomationDocumentFunctions";

type WaitUntilFn = (promise: Promise<unknown>) => void;

function getWaitUntil(): WaitUntilFn | null {
  try {
    // Optional Vercel runtime helper (keeps work alive after the response).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vercel = require("@vercel/functions") as {
      waitUntil?: WaitUntilFn;
    };
    if (typeof vercel.waitUntil === "function") return vercel.waitUntil;
  } catch {
    // package may be absent locally
  }
  return null;
}

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

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(run());
    return;
  }

  try {
    // Next 16 supports after() in Route Handlers / Server Actions.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextServer = require("next/server") as {
      after?: (fn: () => void | Promise<unknown>) => void;
    };
    if (typeof nextServer.after === "function") {
      nextServer.after(() => run());
      return;
    }
  } catch {
    // fall through
  }

  // Last resort — may not survive serverless request teardown.
  console.warn(
    "[ai-rag] scheduleAiIndexing falling back to fire-and-forget (no waitUntil/after)",
  );
  void run();
}
