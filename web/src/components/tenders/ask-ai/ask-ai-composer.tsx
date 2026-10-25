"use client";

import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AskAiAction } from "@/lib/ai/ask-ai-stream";
import type { AskAiSmartQuestion } from "@/lib/ai/ask-ai-client";

export function AskAiComposer({
  value,
  onChange,
  onSend,
  onStop,
  onSmartQuestion,
  smartQuestions,
  smartQuestionsStatus,
  busy,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSmartQuestion: (question: string, category: AskAiAction) => void;
  smartQuestions: AskAiSmartQuestion[];
  smartQuestionsStatus: "loading" | "ready" | "error";
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <form
      className="shrink-0 border-t border-slate-200 bg-white px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) {
          onStop();
          return;
        }
        onSend();
      }}
      data-testid="ask-ai-composer"
    >
      <div
        className="mb-2 flex min-w-0 touch-pan-x snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="V2 smart questions"
      >
        {smartQuestionsStatus === "loading" ? (
          <span className="px-1 py-2 text-xs text-slate-500" role="status">Loading suggested questions…</span>
        ) : null}
        {smartQuestionsStatus === "error" ? (
          <span className="px-1 py-2 text-xs text-slate-500" role="alert">
            Suggestions are unavailable. You can still type a question.
          </span>
        ) : null}
        {smartQuestions.map((item) => (
          <button
            key={item.category}
            type="button"
            disabled={disabled || busy}
            onClick={() => onSmartQuestion(item.question, item.category)}
            className="min-h-10 shrink-0 snap-start whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={item.label}
            data-testid={`ask-ai-smart-${item.category.toLowerCase()}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-1.5 shadow-sm focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy && value.trim()) onSend();
            }
          }}
          placeholder="Ask about eligibility, turnover, experience..."
          disabled={disabled || busy}
          rows={2}
          className="min-h-[44px] max-h-28 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13px] text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          aria-label="Ask AI message"
        />
        {busy ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 shrink-0 gap-1 px-2.5 text-[11px]"
            onClick={onStop}
            aria-label="Stop generating"
            data-testid="ask-ai-stop"
          >
            <Square className="size-3 fill-current" aria-hidden />
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            disabled={!value.trim() || disabled}
            aria-label="Send question"
            data-testid="ask-ai-send"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
