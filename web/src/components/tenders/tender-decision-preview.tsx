"use client";

import { useId, useState } from "react";

export function TenderDecisionPreview({ comment }: { comment: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  if (!comment.trim()) return null;

  return (
    <div
      className="w-full min-w-0 basis-full space-y-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p
        id={contentId}
        className={`whitespace-pre-wrap [overflow-wrap:anywhere] text-xs leading-relaxed ${expanded ? "" : "line-clamp-3"}`}
      >
        <span className="font-medium text-foreground-600">ChatGPT:</span>{" "}
        {comment}
      </p>
      <button
        type="button"
        className="rounded-sm font-medium text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Show less" : "Show full decision"}
      </button>
    </div>
  );
}
