"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type AskAiMarkdownProps = {
  content: string;
  className?: string;
};

/**
 * Safe markdown renderer for Ask AI answers.
 * Tolerates incomplete streamed tokens (no crash).
 */
export function AskAiMarkdown({ content, className }: AskAiMarkdownProps) {
  if (!content) return null;

  try {
    return (
      <div
        className={cn(
          "ask-ai-md text-[13px] leading-relaxed text-slate-800",
          "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-slate-950",
          "[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-slate-950",
          "[&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-900",
          "[&_p]:my-1.5",
          "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-4",
          "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-4",
          "[&_li]:leading-relaxed",
          "[&_strong]:font-semibold [&_strong]:text-slate-900",
          "[&_em]:italic",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600",
          "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
          "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-2",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_a]:text-slate-900 [&_a]:underline [&_a]:underline-offset-2",
          "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[12px]",
          "[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold",
          "[&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top",
          className,
        )}
      >
        <div className="overflow-x-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="my-2 max-w-full overflow-x-auto">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  } catch {
    return (
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
        {content}
      </p>
    );
  }
}
