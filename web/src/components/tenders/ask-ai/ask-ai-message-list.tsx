"use client";

import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { AskAiEmptyState, AskAiQuickActions } from "@/components/tenders/ask-ai/ask-ai-empty-state";
import { AskAiFeedback } from "@/components/tenders/ask-ai/ask-ai-feedback";
import { AskAiMessageView } from "@/components/tenders/ask-ai/ask-ai-message";
import type {
  AskAiMessage,
} from "@/components/tenders/ask-ai/types";

import type { TenderSmartQuestion } from "@/lib/ai/tender-chat-ui";

export function AskAiMessageList({
  tenderId,
  messages,
  busy,
  stickToBottom,
  onStickToBottomChange,
  showJumpToLatest,
  onJumpToLatest,
  onQuickAction,
  questions = [],
  onRetry,
  onReindex,
  reindexState,
}: {
  tenderId?: string;
  messages: AskAiMessage[];
  busy: boolean;
  stickToBottom: boolean;
  onStickToBottomChange: (value: boolean) => void;
  showJumpToLatest: boolean;
  onJumpToLatest: () => void;
  onQuickAction: (question: TenderSmartQuestion) => void;
  questions?: TenderSmartQuestion[];
  onRetry: (assistantIndex: number) => void;
  onReindex?: () => void;
  reindexState?: "idle" | "indexing" | "indexed" | "failed";
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stickToBottom) return;
    const node = bottomRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "end" });
    }
  }, [messages, stickToBottom]);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    onStickToBottomChange(distance < 80);
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-slate-50/60 px-3 py-3"
        data-testid="ask-ai-message-list"
      >
        {messages.length === 0 ? (
          <AskAiEmptyState questions={questions} disabled={busy} onSelect={onQuickAction} />
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={message.id} className="group">
                <AskAiMessageView
                  message={message}
                  showActions={message.role === "assistant"}
                  onRetry={
                    message.role === "assistant" &&
                    (message.error || message.cancelled)
                      ? () => onRetry(index)
                      : undefined
                  }
                  onReindex={onReindex}
                  reindexState={reindexState}
                />
                {tenderId && message.backendMessageId && message.role === "assistant" && !message.incomplete && !message.error && !message.cancelled ? <div className="ml-8"><AskAiFeedback tenderId={tenderId} messageId={message.backendMessageId} answer={message.content} initialFeedback={message.feedback} /></div> : null}
                {message.role === "assistant" && message.content && !message.incomplete && !message.error && !message.cancelled ? <div className="ml-8 mt-3"><AskAiQuickActions questions={questions} disabled={busy} onSelect={onQuickAction} /></div> : null}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {showJumpToLatest ? (
        <button
          type="button"
          onClick={onJumpToLatest}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          aria-label="Jump to latest message"
        >
          <ArrowDown className="size-3" aria-hidden />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}


