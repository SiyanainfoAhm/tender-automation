"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatUploadBytes } from "@/lib/uploads/progress";
import type { UploadStatus } from "@/lib/uploads/types";
import { cn } from "@/lib/utils";

export type FileUploadProgressProps = {
  fileName: string;
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  currentChunk: number;
  totalChunks: number;
  status: UploadStatus;
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
};

function statusCopy(status: UploadStatus, error?: string | null): string {
  switch (status) {
    case "preparing":
    case "queued":
      return "Preparing upload...";
    case "uploading":
      return "Uploading...";
    case "finalizing":
      return "Finalizing upload...";
    case "complete":
      return "Upload complete";
    case "failed":
      return error ? `Upload failed. ${error}` : "Upload failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Uploading...";
  }
}

export function FileUploadProgress({
  fileName,
  uploadedBytes,
  totalBytes,
  percentage,
  currentChunk,
  totalChunks,
  status,
  error,
  onCancel,
  onRetry,
  className,
}: FileUploadProgressProps) {
  const active =
    status === "preparing" ||
    status === "uploading" ||
    status === "finalizing" ||
    status === "queued";
  const label = statusCopy(status, error);
  const showChunks =
    totalChunks > 0 && (status === "uploading" || status === "finalizing");

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border border-border bg-surface-secondary px-3.5 py-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {fileName}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              status === "failed" ? "text-status-nogo" : "text-text-muted",
            )}
            aria-live="polite"
            role="status"
          >
            {status === "complete" ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Document uploaded successfully
              </span>
            ) : status === "failed" ? (
              <span className="inline-flex items-center gap-1">
                <XCircle className="size-3.5" aria-hidden />
                {label}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                {active ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                {label}
              </span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
          {percentage}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-label={`Upload progress ${percentage} percent`}
        className="h-2 overflow-hidden rounded-[6px] bg-background-200"
      >
        <div
          className={cn(
            "h-full rounded-[6px] transition-[width] duration-200",
            status === "failed"
              ? "bg-red-400"
              : status === "complete"
                ? "bg-emerald-600"
                : "bg-emerald-500",
          )}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
        <span>
          {formatUploadBytes(uploadedBytes)} of {formatUploadBytes(totalBytes)}
        </span>
        {showChunks ? (
          <span>
            Chunk {Math.min(currentChunk || 1, totalChunks)} of {totalChunks}
          </span>
        ) : null}
      </div>

      {active && onCancel ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {status === "failed" && onRetry ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
