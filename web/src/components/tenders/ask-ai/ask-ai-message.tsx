"use client";

import { useState } from "react";
import { Bot, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskAiMarkdown } from "@/components/tenders/ask-ai/ask-ai-markdown";
import { AskAiSources } from "@/components/tenders/ask-ai/ask-ai-sources";
import {
  humanizeAskAiWarning,
  isIndexNotReadyWarning,
  type AskAiMessage,
} from "@/components/tenders/ask-ai/types";
import { Button } from "@/components/ui/button";

export function AskAiMessageView({
  message,
  onRetry,
  onReindex,
  reindexState,
  showActions,
}: {
  message: AskAiMessage;
  onRetry?: () => void;
  onReindex?: () => void;
  reindexState?: "idle" | "indexing" | "indexed" | "failed";
  showActions?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-testid="ask-ai-user-message">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-slate-900 px-3 py-2 text-[13px] leading-relaxed text-white shadow-sm">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const warnings = (message.warnings || []).map(humanizeAskAiWarning);
  const uniqueWarnings = Array.from(new Set(warnings));
  const showReindex =
    Boolean(onReindex) &&
    (Boolean(message.indexFailed) || isIndexNotReadyWarning(message.warnings));

  async function copyAnswer() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content);
      }
    } catch {
      // Clipboard may be unavailable in some browsers/test environments.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="flex gap-2"
      data-testid="ask-ai-assistant-message"
      data-incomplete={message.incomplete ? "true" : "false"}
      data-cancelled={message.cancelled ? "true" : "false"}
      data-error={message.error ? "true" : "false"}
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Bot className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {!message.content && message.statusText ? (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            <span>{message.statusText}</span>
          </p>
        ) : message.content ? (
          <AskAiMarkdown content={message.content} />
        ) : null}

        {message.cancelled ? (
          <p className="mt-1.5 text-[11px] text-slate-500">Generation stopped</p>
        ) : null}

        {uniqueWarnings.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {uniqueWarnings.map((warning) => (
              <div
                key={warning}
                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900"
                data-testid="ask-ai-warning"
              >
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        {showReindex ? (
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              data-testid="ask-ai-retry-indexing"
              disabled={reindexState === "indexing"}
              onClick={onReindex}
            >
              {reindexState === "indexing"
                ? "Indexing..."
                : reindexState === "indexed"
                  ? "Indexed"
                  : "Retry Indexing"}
            </Button>
          </div>
        ) : null}

        {message.sources && message.sources.length > 0 ? (
          <AskAiSources sources={message.sources} />
        ) : null}

        {showActions && message.content && !message.statusText ? (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
              "transition-opacity",
            )}
          >
            {!message.incomplete || message.error || message.cancelled ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                onClick={() => void copyAnswer()}
                aria-label="Copy response"
              >
                {copied ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <Copy className="size-3" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
            {(message.error || message.cancelled) && onRetry ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                onClick={onRetry}
                aria-label="Retry response"
              >
                <RotateCcw className="size-3" aria-hidden />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
