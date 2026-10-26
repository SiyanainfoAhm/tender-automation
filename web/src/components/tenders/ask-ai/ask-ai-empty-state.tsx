"use client";
import type { TenderSmartQuestion } from "@/lib/ai/tender-chat-ui";

export function AskAiQuickActions({ questions = [], disabled, onSelect }: {
  questions?: TenderSmartQuestion[]; disabled?: boolean; onSelect: (question: TenderSmartQuestion) => void;
}) {
  if (!questions.length) return null;
  return <div aria-label="Tender quick questions" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
    {questions.map(q => <button key={q.category} type="button" disabled={disabled} title={q.question}
      onClick={() => onSelect(q)} className="min-h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-medium leading-snug text-slate-700 hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50">{q.label}</button>)}
  </div>;
}
export function AskAiEmptyState(props: Parameters<typeof AskAiQuickActions>[0]) {
  return <div data-testid="ask-ai-empty-state" className="space-y-3"><p className="text-sm text-slate-600">Ask about this tender</p><AskAiQuickActions {...props} /></div>;
}

