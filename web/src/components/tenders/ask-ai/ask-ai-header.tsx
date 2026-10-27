"use client";

export function AskAiHeader({tenderTitle}:{tenderTitle:string}) {
 return <header className="min-w-0 px-4 py-3">
  <h2 className="font-heading text-lg font-semibold text-text-primary">Ask AI</h2>
  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-muted" title={tenderTitle}>{tenderTitle}</p>
  <p className="mt-1 text-[10px] font-medium text-primary-700">Tender assistant · VBDC V2</p>
 </header>;
}
