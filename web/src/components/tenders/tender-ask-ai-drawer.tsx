"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  streamAskAiRequest,
  waitForAiIndexReady,
  type AskAiPhase,
} from "@/lib/ai/ask-ai-client";
import { actionStatusText } from "@/lib/ai/ask-ai-actions";
import type { AskAiAction } from "@/lib/ai/ask-ai-stream";
import { AskAiHeader } from "@/components/tenders/ask-ai/ask-ai-header";
import { AskAiMessageList } from "@/components/tenders/ask-ai/ask-ai-message-list";
import { AskAiComposer } from "@/components/tenders/ask-ai/ask-ai-composer";
import type {
  AskAiMessage,
  AskAiQuickAction,
} from "@/components/tenders/ask-ai/types";
import { reindexAiKnowledgeAction } from "@/server/actions/ai-reindex";

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TenderAskAiDrawer({
  tenderId,
  tenderTitle,
  compact = false,
}: {
  tenderId: string;
  tenderTitle: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AskAiMessage[]>([]);
  const [phase, setPhase] = useState<AskAiPhase>("idle");
  const [stickToBottom, setStickToBottom] = useState(true);
  const [reindexState, setReindexState] = useState<
    "idle" | "indexing" | "indexed" | "failed"
  >("idle");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  const pendingRetryRef = useRef<{
    text: string;
    conversation: Array<{ role: "user" | "assistant"; content: string }>;
    action?: AskAiAction | null;
    assistantId: string;
  } | null>(null);
  const titleId = useId();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const busy =
    phase === "retrieving" ||
    phase === "generating" ||
    phase === "indexing";
  const showJumpToLatest = busy && !stickToBottom;

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function markAssistantIndexing(assistantId: string, statusText: string) {
    setPhase("indexing");
    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              content: "",
              statusText,
              incomplete: true,
              error: false,
              indexFailed: false,
              warnings: undefined,
            }
          : item,
      ),
    );
  }

  function markAssistantIndexFailed(assistantId: string, message: string) {
    setReindexState("failed");
    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              content: message,
              statusText: undefined,
              incomplete: true,
              error: true,
              indexFailed: true,
              warnings: [message],
            }
          : item,
      ),
    );
    setPhase("idle");
  }

  async function runStream(options: {
    text: string;
    conversation: Array<{ role: "user" | "assistant"; content: string }>;
    assistantId: string;
    action?: AskAiAction | null;
    /** Prevent recursive auto-retry after index becomes ready. */
    afterIndexRetry?: boolean;
  }) {
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase("retrieving");
    pendingRetryRef.current = {
      text: options.text,
      conversation: options.conversation,
      action: options.action,
      assistantId: options.assistantId,
    };

    let sawDelta = false;
    let indexingStarted = false;

    try {
      await streamAskAiRequest({
        tenderId,
        message: options.text,
        conversation: options.conversation,
        action: options.action ?? undefined,
        signal: abort.signal,
        handlers: {
          onStatus(statusMessage, stage) {
            if (stage === "indexing") {
              indexingStarted = true;
              markAssistantIndexing(options.assistantId, statusMessage);
              return;
            }
            setPhase(stage);
            setMessages((current) =>
              current.map((item) =>
                item.id === options.assistantId && !item.content
                  ? { ...item, statusText: statusMessage }
                  : item,
              ),
            );
          },
          onDelta(delta) {
            sawDelta = true;
            setPhase("generating");
            setMessages((current) =>
              current.map((item) =>
                item.id === options.assistantId
                  ? {
                      ...item,
                      content: `${item.content}${delta}`,
                      statusText: undefined,
                      incomplete: true,
                      cancelled: false,
                      error: false,
                      indexFailed: false,
                    }
                  : item,
              ),
            );
          },
          onSources(sources, warnings) {
            setMessages((current) =>
              current.map((item) =>
                item.id === options.assistantId
                  ? { ...item, sources, warnings }
                  : item,
              ),
            );
          },
          onDone(meta) {
            if (meta?.indexStatus === "indexing" || indexingStarted) {
              indexingStarted = true;
              markAssistantIndexing(
                options.assistantId,
                ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
              );
              return;
            }
            if (meta?.indexStatus === "failed") {
              markAssistantIndexFailed(
                options.assistantId,
                "Could not prepare AI knowledge for this tender. Please retry indexing.",
              );
              return;
            }
            setMessages((current) =>
              current.map((item) =>
                item.id === options.assistantId
                  ? {
                      ...item,
                      incomplete: false,
                      statusText: undefined,
                      cancelled: false,
                      error: false,
                      indexFailed: false,
                    }
                  : item,
              ),
            );
            setPhase("idle");
          },
          onError(error) {
            if (error.code === "REQUEST_CANCELLED") {
              setMessages((current) =>
                current.map((item) =>
                  item.id === options.assistantId
                    ? {
                        ...item,
                        incomplete: true,
                        cancelled: true,
                        error: false,
                        statusText: undefined,
                        content: item.content || "",
                      }
                    : item,
                ),
              );
              setPhase("idle");
              return;
            }

            if (error.code === "INDEX_FAILED" || error.code === "INDEXING") {
              if (error.code === "INDEXING") {
                indexingStarted = true;
                markAssistantIndexing(
                  options.assistantId,
                  error.message || ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
                );
                return;
              }
              markAssistantIndexFailed(
                options.assistantId,
                error.message ||
                  "Could not prepare AI knowledge for this tender. Please retry indexing.",
              );
              return;
            }

            setMessages((current) =>
              current.map((item) =>
                item.id === options.assistantId
                  ? {
                      ...item,
                      incomplete: true,
                      error: true,
                      cancelled: false,
                      statusText: undefined,
                      content: sawDelta
                        ? `${item.content}\n\nResponse interrupted.`
                        : error.message ||
                          "Ask AI couldn't complete this request.",
                    }
                  : item,
              ),
            );
            setPhase("idle");
          },
        },
      });

      if (abort.signal.aborted) {
        setPhase("idle");
        return;
      }

      if (indexingStarted && !options.afterIndexRetry) {
        const poll = await waitForAiIndexReady({
          tenderId,
          signal: abort.signal,
          onTick: (status) => {
            markAssistantIndexing(
              options.assistantId,
              status.message || ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
            );
          },
        });

        if (abort.signal.aborted) {
          setPhase("idle");
          return;
        }

        if (poll.state !== "ready") {
          markAssistantIndexFailed(
            options.assistantId,
            poll.message ||
              "Could not prepare AI knowledge for this tender. Please retry indexing.",
          );
          return;
        }

        // Index ready — automatically retry the original Ask AI request.
        setMessages((current) =>
          current.map((item) =>
            item.id === options.assistantId
              ? {
                  ...item,
                  content: "",
                  statusText: "Searching indexed evidence...",
                  incomplete: true,
                  error: false,
                  indexFailed: false,
                  warnings: undefined,
                  sources: undefined,
                }
              : item,
          ),
        );
        await runStream({
          ...options,
          afterIndexRetry: true,
        });
        return;
      }
    } catch (error) {
      if (abort.signal.aborted) {
        setPhase("idle");
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === options.assistantId
            ? {
                ...item,
                incomplete: true,
                error: true,
                statusText: undefined,
                content: sawDelta
                  ? `${item.content}\n\nResponse interrupted.`
                  : error instanceof Error
                    ? error.message
                    : "Ask AI couldn't complete this request.",
              }
            : item,
        ),
      );
      setPhase("idle");
    }
  }

  async function ask(raw: string, action?: AskAiAction | null) {
    const text = raw.trim();
    if (!text || busy) return;

    const conversation = messagesRef.current
      .filter(
        (item) =>
          item.role === "user" ||
          (item.role === "assistant" &&
            !item.incomplete &&
            !item.error &&
            !item.cancelled &&
            item.content.trim()),
      )
      .map(({ role, content }) => ({ role, content }));

    abortRef.current?.abort();

    const assistantId = createMessageId("assistant");
    const initialStatus = action
      ? actionStatusText(action)
      : "Searching indexed evidence...";
    setMessages((current) => [
      ...current,
      { id: createMessageId("user"), role: "user", content: text },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        statusText: initialStatus,
        incomplete: true,
      },
    ]);
    setInput("");
    setStickToBottom(true);

    await runStream({ text, conversation, assistantId, action });
  }

  async function retryAssistant(assistantIndex: number) {
    if (busy) return;
    const current = messagesRef.current;
    const assistant = current[assistantIndex];
    const prior = current[assistantIndex - 1];
    if (!assistant || assistant.role !== "assistant" || !prior || prior.role !== "user") {
      return;
    }

    const text = prior.content;
    const conversation = current
      .slice(0, assistantIndex - 1)
      .filter(
        (item) =>
          item.role === "user" ||
          (item.role === "assistant" &&
            !item.incomplete &&
            !item.error &&
            !item.cancelled &&
            item.content.trim()),
      )
      .map(({ role, content }) => ({ role, content }));

    abortRef.current?.abort();
    const assistantId = createMessageId("assistant");

    setMessages((msgs) => {
      const next = [...msgs];
      next.splice(assistantIndex, 1, {
        id: assistantId,
        role: "assistant",
        content: "",
        statusText: "Searching indexed evidence...",
        incomplete: true,
      });
      return next;
    });
    setStickToBottom(true);

    await runStream({ text, conversation, assistantId });
  }

  async function handleReindex() {
    setReindexState("indexing");
    const pending = pendingRetryRef.current;
    if (pending) {
      markAssistantIndexing(
        pending.assistantId,
        ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
      );
    }

    const result = await reindexAiKnowledgeAction({
      scope: "tender",
      tenderId,
    });
    if (!result.ok) {
      setReindexState("failed");
      if (pending) {
        markAssistantIndexFailed(pending.assistantId, result.error);
      }
      return;
    }
    const failed = result.results.every(
      (row) => row.status === "INDEX_FAILED",
    ) || result.results.length === 0;
    if (failed) {
      setReindexState("failed");
      if (pending) {
        markAssistantIndexFailed(
          pending.assistantId,
          "Could not prepare AI knowledge for this tender. Please retry indexing.",
        );
      }
      return;
    }

    setReindexState("indexed");
    if (pending && !busy) {
      const assistantId = createMessageId("assistant");
      setMessages((current) =>
        current.map((item) =>
          item.id === pending.assistantId
            ? {
                id: assistantId,
                role: "assistant",
                content: "",
                statusText: "Searching indexed evidence...",
                incomplete: true,
              }
            : item,
        ),
      );
      await runStream({
        text: pending.text,
        conversation: pending.conversation,
        action: pending.action,
        assistantId,
        afterIndexRetry: true,
      });
    }
  }

  function onQuickAction(action: AskAiQuickAction) {
    void ask(action.message, action.action);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={compact ? "size-8" : "h-8 gap-1.5 text-xs"}
        onClick={() => setOpen(true)}
        aria-label={`Ask AI about ${tenderTitle}`}
        aria-haspopup="dialog"
      >
        <Sparkles className="size-3.5" />
        {compact ? null : " Ask AI"}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          aria-labelledby={titleId}
          className={cn(
            "flex h-dvh flex-col gap-0 border-l border-slate-200 bg-white p-0",
            "w-full max-w-full",
            "sm:w-[min(85vw,560px)] sm:max-w-[560px]",
            "md:w-[clamp(420px,36vw,560px)] md:max-w-[560px]",
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span id={titleId} className="sr-only">
            Ask AI — {tenderTitle}
          </span>
          <AskAiHeader tenderTitle={tenderTitle} />

          <AskAiMessageList
            messages={messages}
            busy={busy}
            stickToBottom={stickToBottom}
            onStickToBottomChange={setStickToBottom}
            showJumpToLatest={showJumpToLatest}
            onJumpToLatest={() => {
              setStickToBottom(true);
            }}
            onQuickAction={onQuickAction}
            onRetry={(index) => void retryAssistant(index)}
            onReindex={() => void handleReindex()}
            reindexState={reindexState}
          />

          <AskAiComposer
            value={input}
            onChange={setInput}
            onSend={() => void ask(input)}
            onStop={stopGenerating}
            busy={busy}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
