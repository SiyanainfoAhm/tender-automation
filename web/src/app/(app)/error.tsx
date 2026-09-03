"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  resolveDisplayReference,
} from "@/lib/errors/app-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string; correlationId?: string };
  reset: () => void;
}) {
  const correlationId = useMemo(
    () => resolveDisplayReference(error),
    [error],
  );

  useEffect(() => {
    // Always log a matchable reference for Vercel / browser console.
    const payload = {
      level: "error",
      event: "app_error_boundary",
      correlationId,
      digest: error.digest ?? null,
      name: error.name,
      message: error.message,
      // Full stack only in development — production keeps digest + reference.
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
    if (process.env.NODE_ENV === "development") {
      console.error("[TenderFlow] Unexpected page error", error);
      console.error(JSON.stringify(payload));
    } else {
      console.error(JSON.stringify(payload));
    }
  }, [error, correlationId]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center py-10">
      <div className="w-full max-w-md rounded-[14px] border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-status-nogo-bg text-status-nogo">
          <AlertCircle className="size-5" />
        </div>
        <h1 className="font-heading text-xl font-bold text-text-primary">
          We couldn&apos;t load this page
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Something went wrong while loading this view. Please try again or
          return to the dashboard.
        </p>
        <p className="mt-4 font-mono text-xs text-text-muted">
          Reference: {correlationId}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Return to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
