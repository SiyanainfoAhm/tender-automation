/**
 * Client helper for Ask AI SSE streaming + on-demand index polling.
 */
import {
  parseSseChunk,
  type AskAiRetrievalMeta,
  type AskAiSource,
  type AskAiStreamEvent,
  type AskAiStreamStage,
} from "@/lib/ai/ask-ai-stream";

export type AskAiPhase =
  | "idle"
  | "retrieving"
  | "generating"
  | "indexing"
  | "complete"
  | "error"
  | "cancelled";

export type StreamAskAiHandlers = {
  onStatus?: (message: string, stage: AskAiStreamStage) => void;
  onDelta?: (text: string) => void;
  onSources?: (sources: AskAiSource[], warnings: string[]) => void;
  onDone?: (meta?: AskAiRetrievalMeta) => void;
  onError?: (error: {
    code: string;
    message: string;
    retryable: boolean;
  }) => void;
};

export const ASK_AI_PREPARING_KNOWLEDGE_MESSAGE =
  "Preparing AI knowledge for this tender. This is required only once.";

export type AiIndexStatusPoll = {
  state: "ready" | "indexing" | "failed" | "none" | "no_documents";
  activeChunkCount: number;
  indexedSources: number;
  failedSources: number;
  pendingSources: number;
  inflight: boolean;
  jobStatus?: string | null;
  message: string | null;
};

export async function fetchAiIndexStatus(
  tenderId: string,
  signal?: AbortSignal,
): Promise<AiIndexStatusPoll> {
  const response = await fetch(`/api/tenders/${tenderId}/ai-index-status`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || "Unable to check AI index status.");
  }
  return (await response.json()) as AiIndexStatusPoll;
}

/** Poll until ready / failed / timeout / stuck-none. */
export async function waitForAiIndexReady(options: {
  tenderId: string;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  /** Stop if poll stays `none` this many times after indexing was requested. */
  maxConsecutiveNone?: number;
  onTick?: (poll: AiIndexStatusPoll) => void;
}): Promise<AiIndexStatusPoll> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxConsecutiveNone = options.maxConsecutiveNone ?? 3;
  const started = Date.now();
  let consecutiveNone = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const poll = await fetchAiIndexStatus(options.tenderId, options.signal);
    options.onTick?.(poll);
    if (poll.state === "ready") return poll;
    if (poll.state === "failed" || poll.state === "no_documents") return poll;

    if (poll.state === "none") {
      consecutiveNone += 1;
      if (consecutiveNone >= maxConsecutiveNone) {
        return {
          ...poll,
          state: "failed",
          message:
            "Indexing did not start. Please retry indexing.",
        };
      }
    } else {
      consecutiveNone = 0;
    }

    if (Date.now() - started >= timeoutMs) {
      return {
        ...poll,
        state: "failed",
        message:
          poll.message ||
          "Preparing AI knowledge timed out. Please retry indexing.",
      };
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => resolve(), intervalMs);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

export async function streamAskAiRequest(options: {
  tenderId: string;
  message: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  action?: string | null;
  signal?: AbortSignal;
  handlers: StreamAskAiHandlers;
}): Promise<void> {
  const response = await fetch(`/api/tenders/${options.tenderId}/ask-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      message: options.message,
      conversation: options.conversation,
      action: options.action ?? undefined,
      stream: true,
    }),
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") || "";

  // Non-SSE fallback (explicit non-stream or unexpected content-type).
  if (!contentType.includes("text/event-stream")) {
    const data = (await response.json().catch(() => null)) as {
      answer?: string;
      warnings?: string[];
      sources?: AskAiSource[];
      error?: string;
      retrievalMeta?: AskAiRetrievalMeta;
    } | null;
    if (!response.ok) {
      options.handlers.onError?.({
        code: "UNKNOWN_ERROR",
        message: data?.error || "Ask AI couldn't complete this request.",
        retryable: true,
      });
      return;
    }
    if (data?.retrievalMeta?.indexStatus === "indexing") {
      options.handlers.onStatus?.(
        ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
        "indexing",
      );
      options.handlers.onDone?.(data.retrievalMeta);
      return;
    }
    if (!data?.answer) {
      options.handlers.onError?.({
        code: "UNKNOWN_ERROR",
        message: data?.error || "Ask AI couldn't complete this request.",
        retryable: true,
      });
      return;
    }
    options.handlers.onStatus?.("Preparing grounded answer...", "generating");
    options.handlers.onDelta?.(data.answer);
    options.handlers.onSources?.(data.sources || [], data.warnings || []);
    options.handlers.onDone?.(data.retrievalMeta);
    return;
  }

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    options.handlers.onError?.({
      code: response.status === 403 ? "FORBIDDEN" : "UNKNOWN_ERROR",
      message: data?.error || "Ask AI couldn't complete this request.",
      retryable: response.status >= 500,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawError = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        dispatchEvent(event, options.handlers);
        if (event.type === "error") sawError = true;
      }
    }
    if (buffer.trim()) {
      const parsed = parseSseChunk(`${buffer}\n\n`);
      for (const event of parsed.events) {
        dispatchEvent(event, options.handlers);
        if (event.type === "error") sawError = true;
      }
    }
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      options.handlers.onError?.({
        code: "REQUEST_CANCELLED",
        message: "Request cancelled.",
        retryable: false,
      });
      return;
    }
    if (!sawError) {
      options.handlers.onError?.({
        code: "UNKNOWN_ERROR",
        message: "Response interrupted.",
        retryable: false,
      });
    }
  }
}

function dispatchEvent(
  event: AskAiStreamEvent,
  handlers: StreamAskAiHandlers,
) {
  switch (event.type) {
    case "status":
      handlers.onStatus?.(event.message, event.stage);
      break;
    case "delta":
      handlers.onDelta?.(event.text);
      break;
    case "sources":
      handlers.onSources?.(event.sources, event.warnings);
      break;
    case "done":
      handlers.onDone?.(event.retrievalMeta);
      break;
    case "error":
      handlers.onError?.({
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      });
      break;
  }
}
