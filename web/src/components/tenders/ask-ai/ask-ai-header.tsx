"use client";

import { Bot } from "lucide-react";

export function AskAiHeader({ tenderTitle }: { tenderTitle: string }) {
  return (
    <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-4 pr-12">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
          <Bot className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-950">Ask AI</h2>
          <p
            className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500"
            title={tenderTitle}
          >
            {tenderTitle}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Grounded in tender documents + company evidence
      </p>
    </header>
  );
}
