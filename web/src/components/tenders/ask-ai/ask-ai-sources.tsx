"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskAiSource } from "@/lib/ai/ask-ai-stream";

function sourceKindLabel(source: AskAiSource): string {
  const type = String(source.sourceType || "").toUpperCase();
  if (type.includes("COMPANY")) return "Company Document";
  if (type.includes("PROFILE")) return "Company Profile";
  return "Tender Document";
}

export function AskAiSources({ sources }: { sources: AskAiSource[] }) {
  const [open, setOpen] = useState(false);
  const [expandedExcerpt, setExpandedExcerpt] = useState<Record<string, boolean>>(
    {},
  );

  if (!sources.length) return null;

  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2" data-testid="ask-ai-sources">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          Sources ({sources.length})
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="mt-1.5 space-y-2">
          {sources.map((source, index) => {
            const key = source.id || `${source.fileName}-${index}`;
            const excerpt = source.excerpt?.trim() || "";
            const isExpanded = Boolean(expandedExcerpt[key]);
            const showToggle = excerpt.length > 160;
            const displayExcerpt =
              !showToggle || isExpanded
                ? excerpt
                : `${excerpt.slice(0, 160).trimEnd()}…`;

            return (
              <li
                key={key}
                className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2"
              >
                <div className="flex items-start gap-2">
                  <FileText
                    className="mt-0.5 size-3.5 shrink-0 text-slate-400"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {sourceKindLabel(source)}
                      {source.id ? ` · ${source.id}` : ""}
                    </p>
                    <p className="truncate text-[12px] font-medium text-slate-800">
                      {source.documentName || source.fileName}
                    </p>
                    {source.section ? (
                      <p className="text-[11px] text-slate-500">
                        {source.section}
                      </p>
                    ) : null}
                    {source.pageNumber != null ? (
                      <p className="text-[11px] text-slate-500">
                        Page {source.pageNumber}
                      </p>
                    ) : null}
                    {excerpt ? (
                      <p className="mt-1 text-[11px] leading-snug text-slate-600">
                        “{displayExcerpt}”
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {showToggle ? (
                        <button
                          type="button"
                          className="text-[11px] font-medium text-slate-700 underline-offset-2 hover:underline"
                          onClick={() =>
                            setExpandedExcerpt((current) => ({
                              ...current,
                              [key]: !isExpanded,
                            }))
                          }
                        >
                          {isExpanded ? "Show less" : "Show more"}
                        </button>
                      ) : null}
                      {source.documentUrl ? (
                        <a
                          href={source.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          Open document
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
