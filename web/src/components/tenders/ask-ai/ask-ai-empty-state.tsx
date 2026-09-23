"use client";

import { cn } from "@/lib/utils";
import {
  ASK_AI_QUICK_ACTIONS,
  type AskAiQuickAction,
} from "@/components/tenders/ask-ai/types";

export function AskAiQuickActions({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: AskAiQuickAction) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
      data-testid="ask-ai-quick-actions"
    >
      {ASK_AI_QUICK_ACTIONS.map((action) => (
        <button
          key={action.action}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(action)}
          data-action={action.action}
          className={cn(
            "rounded-md border px-2 py-1.5 text-left text-[11px] font-medium leading-snug transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
            "disabled:cursor-not-allowed disabled:opacity-50",
            action.primary
              ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function AskAiEmptyState({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: AskAiQuickAction) => void;
}) {
  return (
    <div className="px-1 pt-2" data-testid="ask-ai-empty-state">
      <h3 className="text-sm font-semibold text-slate-950">
        Ask AI about this tender
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
        Ask questions using indexed tender documents and company evidence.
      </p>
      <div className="mt-3">
        <AskAiQuickActions disabled={disabled} onSelect={onSelect} />
      </div>
    </div>
  );
}
