"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function TendersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[tenders] route error boundary", error);
    }
  }, [error]);

  return (
    <div className="rounded-lg border border-border bg-card p-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        We couldn&apos;t load tenders
      </h2>
      <p className="mt-2 text-sm text-foreground-500">
        Please try again. If this keeps happening, contact your administrator.
      </p>
      <Button className="mt-4" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
