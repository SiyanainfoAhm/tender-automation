"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type TenderLoadingOverlayProps = {
  title?: string;
  description?: string;
};

export function TenderLoadingOverlay({
  title = "Updating tenders",
  description = "Applying filters, please wait...",
}: TenderLoadingOverlayProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center pointer-events-auto",
        "cursor-wait bg-background/65 backdrop-blur-[2px]",
        "animate-in fade-in-0 duration-150",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex min-w-[280px] max-w-[360px] flex-col items-center gap-3 rounded-xl border border-border bg-background/95 px-8 py-6 shadow-xl">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
        <div className="text-center">
          <p className="font-medium text-foreground-900">{title}</p>
          <p className="mt-1 text-sm text-foreground-500">{description}</p>
        </div>
        <div className="flex items-center gap-1" aria-hidden>
          <span className="size-1.5 animate-pulse rounded-full bg-primary/70" />
          <span className="size-1.5 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
