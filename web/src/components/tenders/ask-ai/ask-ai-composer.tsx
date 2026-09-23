"use client";

import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AskAiComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <form
      className="shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-2"
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
            className="h-8 shrink-0 gap-1 px-2.5 text-[11px]"
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
            className="size-8 shrink-0 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            disabled={!value.trim() || disabled}
            aria-label="Send question"
            data-testid="ask-ai-send"
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </form>
  );
}
