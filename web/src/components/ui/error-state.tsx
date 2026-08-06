"use client";

import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  message?: string;
  correlationId?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
};

export function ErrorState({
  title = "We couldn't load this section",
  message = "Something went wrong while fetching data. Please try again.",
  correlationId,
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[14px] border border-red-200/80 bg-red-50/50 px-6 text-center dark:border-red-900/50 dark:bg-red-950/20",
        compact ? "py-8" : "py-12",
        className,
      )}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-status-nogo-bg text-status-nogo">
        <AlertCircle className="size-5" />
      </div>
      <h3 className="font-heading text-base font-semibold text-text-primary">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm text-text-secondary">{message}</p>
      {correlationId ? (
        <p className="mt-3 font-mono text-xs text-text-muted">
          Reference: {correlationId}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RefreshCw className="size-4" />
            Try again
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">Return to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
