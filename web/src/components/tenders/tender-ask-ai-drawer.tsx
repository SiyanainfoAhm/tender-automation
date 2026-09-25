"use client";

import { useEffect, useId, useRef, useState } from "react";
import { History, Plus, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  streamAskAiRequest,
  waitForAiIndexReady,
  type AskAiPhase,
  createAskAiSession,
  deleteAskAiSession,
  fetchAskAiSessionMessages,
  fetchAskAiSessions,
  renameAskAiSession,
  saveAskAiMessage,
  type AskAiChatSession,
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
  const [sessions, setSessions] = useState<AskAiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionDialog, setSessionDialog] = useState<{
    kind: "rename" | "delete";
    session: AskAiChatSession;
  } | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
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

  useEffect(() => {
    if (!open) return;
    if (typeof fetchAskAiSessions !== "function") return;
    const timer = window.setTimeout(() => {
      void fetchAskAiSessions(tenderId, historySearch).then((result) => setSessions(result.sessions)).catch(() => undefined);
    }, historySearch ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [open, tenderId, historySearch]);

  function addOrUpdateSession(session: AskAiChatSession) {
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
  }

  async function selectSession(sessionId: string) {
    if (busy) return;
    if (typeof fetchAskAiSessionMessages !== "function") return;
    try {
      const result = await fetchAskAiSessionMessages(tenderId, sessionId);
      setActiveSessionId(sessionId);
      setMessages(result.messages.map((item) => ({ id:item.id, role:item.role, content:item.content, sources:item.sources, warnings:item.warnings, incomplete:item.status !== "complete", cancelled:item.status === "cancelled", error:item.status === "error" })));
      setHistoryOpen(false);
      setStickToBottom(true);
    } catch { /* history remains available on a transient request failure */ }
  }

  function newChat() { if (busy) return; setActiveSessionId(null); setMessages([]); setInput(""); setHistoryOpen(false); }

  async function removeSession(sessionId: string) {
    try { if (typeof deleteAskAiSession !== "function") return; await deleteAskAiSession(tenderId, sessionId); setSessions((current) => current.filter((item) => item.id !== sessionId)); if (activeSessionId === sessionId) newChat(); } catch { /* leave the UI untouched when deletion fails */ }
  }
  async function renameSession(session: AskAiChatSession) {
    const title = sessionTitleDraft;
    if (title == null || !title.trim() || title.trim() === session.title) return;
    try { if (typeof renameAskAiSession !== "function") return; await renameAskAiSession(tenderId, session.id, title); addOrUpdateSession({ ...session, title: title.trim() }); } catch { /* preserve previous label */ }
  }

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
              noDocuments: false,
              warnings: undefined,
            }
          : item,
      ),
    );
  }

  function markAssistantNoDocuments(assistantId: string, message: string) {
    setReindexState("idle");
    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              content: message,
              statusText: undefined,
              incomplete: false,
              error: false,
              indexFailed: false,
              noDocuments: true,
              warnings: [message],
            }
          : item,
      ),
    );
    setPhase("idle");
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
              noDocuments: false,
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
    sessionId: string;
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
    let streamedContent = "";
    let streamedSources: AskAiMessage["sources"];
    let streamedWarnings: AskAiMessage["warnings"];

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
            streamedContent += delta;
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
            streamedSources = sources;
            streamedWarnings = warnings;
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
            if (meta?.indexStatus === "no_documents") {
              markAssistantNoDocuments(
                options.assistantId,
                "No tender documents are available to index for this tender yet.",
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
            if (typeof saveAskAiMessage === "function") void saveAskAiMessage(tenderId, options.sessionId, { role: "assistant", content: streamedContent, sources: streamedSources, warnings: streamedWarnings, status: "complete" });
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
              if (typeof saveAskAiMessage === "function") void saveAskAiMessage(tenderId, options.sessionId, { role: "assistant", content: streamedContent, sources: streamedSources, warnings: streamedWarnings, status: "cancelled" });
              return;
            }

            if (error.code === "INDEX_FAILED" || error.code === "INDEXING" || error.code === "INDEX_NO_DOCUMENTS") {
              if (error.code === "INDEXING") {
                indexingStarted = true;
                markAssistantIndexing(
                  options.assistantId,
                  error.message || ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
                );
                return;
              }
              if (error.code === "INDEX_NO_DOCUMENTS") {
                markAssistantNoDocuments(
                  options.assistantId,
                  error.message ||
                    "No tender documents are available to index for this tender yet.",
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
            if (typeof saveAskAiMessage === "function") void saveAskAiMessage(tenderId, options.sessionId, { role: "assistant", content: streamedContent || error.message || "", sources: streamedSources, warnings: streamedWarnings, status: sawDelta ? "interrupted" : "error" });
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

        if (poll.state === "no_documents") {
          markAssistantNoDocuments(
            options.assistantId,
            poll.message ||
              "No tender documents are available to index for this tender yet.",
          );
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

    let sessionId = activeSessionId;
    if (!sessionId) {
      try { if (typeof createAskAiSession === "function") { const created = await createAskAiSession(tenderId, text, action); sessionId = created.session.id; setActiveSessionId(sessionId); addOrUpdateSession(created.session); } else { sessionId = createMessageId("session"); setActiveSessionId(sessionId); } }
      catch { return; }
    }
    if (typeof saveAskAiMessage === "function") await saveAskAiMessage(tenderId, sessionId, { role: "user", content: text, action: action || null, status: "complete" }).catch(() => undefined);
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

    await runStream({ text, conversation, assistantId, action, sessionId });
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

    if (!activeSessionId) return;
    await runStream({ text, conversation, assistantId, sessionId: activeSessionId });
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
        sessionId: activeSessionId || "",
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          aria-labelledby={titleId}
          className={cn(
            "flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-slate-200 bg-white p-0",
            "sm:h-[94dvh] sm:w-[96vw] sm:rounded-lg",
            "lg:h-[92dvh] lg:w-[80vw] lg:max-w-[1500px]",
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span id={titleId} className="sr-only">
            Ask AI — {tenderTitle}
          </span>
          <div className="flex shrink-0 items-start border-b border-slate-200">
            <div className="min-w-0 flex-1"><AskAiHeader tenderTitle={tenderTitle} /></div>
            <div className="flex shrink-0 items-center gap-1 px-3 pt-3">
              <Button variant="outline" size="sm" className="hidden h-7 text-[11px] sm:inline-flex" onClick={newChat}><Plus className="mr-1 size-3" />New Chat</Button>
              <Button variant="ghost" size="icon" className="size-7 lg:hidden" onClick={() => setHistoryOpen((v) => !v)} aria-label="Conversation history"><History className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} aria-label="Close Ask AI"><X className="size-4" /></Button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 lg:flex">
            <aside className={cn("absolute inset-y-0 left-0 z-10 w-[290px] shrink-0 border-r border-slate-200 bg-slate-50 p-3 shadow-lg lg:static lg:block lg:shadow-none", historyOpen ? "block" : "hidden lg:block")}>
              <div className="mb-2 flex gap-2"><Button size="sm" className="h-8 flex-1 text-xs" onClick={newChat}><Plus className="mr-1 size-3.5" />New Chat</Button></div>
              <label className="relative block"><Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" /><input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search conversations..." className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-[11px] outline-none focus:border-slate-400" /></label>
              <p className="mt-4 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conversations</p>
              <div className="mt-1 max-h-[calc(100%-90px)] space-y-1 overflow-y-auto">{sessions.map((item) => <div key={item.id} className={cn("group flex items-center rounded-md", activeSessionId === item.id ? "bg-slate-200" : "hover:bg-slate-100")}><button type="button" onClick={() => void selectSession(item.id)} className="min-w-0 flex-1 px-2 py-2 text-left"><p className="truncate text-[12px] font-medium text-slate-700">{item.title}</p><p className="mt-0.5 text-[10px] text-slate-400">{new Date(item.lastMessageAt).toLocaleDateString()}</p></button><div className="mr-1 hidden items-center gap-0.5 group-hover:flex"><button type="button" onClick={() => { setSessionTitleDraft(item.title); setSessionDialog({ kind: "rename", session: item }); }} className="rounded px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`Rename ${item.title}`}>Rename</button><button type="button" onClick={() => setSessionDialog({ kind: "delete", session: item })} className="rounded px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white hover:text-red-600" aria-label={`Delete ${item.title}`}>Delete</button></div></div>)}{sessions.length === 0 ? <p className="px-2 py-3 text-[11px] text-slate-400">No saved conversations.</p> : null}</div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
              <AskAiMessageList messages={messages} busy={busy} stickToBottom={stickToBottom} onStickToBottomChange={setStickToBottom} showJumpToLatest={showJumpToLatest} onJumpToLatest={() => setStickToBottom(true)} onQuickAction={onQuickAction} onRetry={(index) => void retryAssistant(index)} onReindex={() => void handleReindex()} reindexState={reindexState} />
              <AskAiComposer value={input} onChange={setInput} onSend={() => void ask(input)} onStop={stopGenerating} busy={busy} />
            </main>
          </div>
          {sessionDialog ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-4" role="dialog" aria-modal="true" aria-label={sessionDialog.kind === "rename" ? "Rename conversation" : "Delete conversation"}>
              <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                <h3 className="text-sm font-semibold text-slate-900">{sessionDialog.kind === "rename" ? "Rename conversation" : "Delete conversation?"}</h3>
                {sessionDialog.kind === "rename" ? <input autoFocus value={sessionTitleDraft} onChange={(event) => setSessionTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { void renameSession(sessionDialog.session); setSessionDialog(null); } }} className="mt-3 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-slate-500" aria-label="Conversation title" maxLength={160} /> : <p className="mt-2 text-[12px] leading-relaxed text-slate-500">Delete “{sessionDialog.session.title}”? Its saved messages will be permanently removed.</p>}
                <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSessionDialog(null)}>Cancel</Button><Button type="button" size="sm" variant={sessionDialog.kind === "delete" ? "destructive" : "default"} onClick={() => { if (sessionDialog.kind === "rename") void renameSession(sessionDialog.session); else void removeSession(sessionDialog.session.id); setSessionDialog(null); }}>{sessionDialog.kind === "rename" ? "Save" : "Delete"}</Button></div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
