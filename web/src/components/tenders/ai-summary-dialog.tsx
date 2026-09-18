"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Expand,
  Loader2,
  Minimize2,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import {
  toAccessibleStorageUrl,
  toProxiedStorageUrl,
} from "@/lib/storage/accessible-storage-url";
import { cn } from "@/lib/utils";

export type AiSummaryTenderMeta = {
  id: string;
  title: string;
  sourcePortal?: string | null;
  sourceTenderId?: string | null;
  referenceNo?: string | null;
  organisationName?: string | null;
  closingDate?: string | null;
  aiSummaryUrl?: string | null;
};

type AiSummaryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tender: AiSummaryTenderMeta | null;
};

/** In-memory PDF blob URLs so hover preload + reopen are fast. */
const pdfObjectUrlCache = new Map<string, string>();
const pdfFetchInFlight = new Map<string, Promise<string>>();

/**
 * Same-origin Graph proxy stream — required for iframe preview because
 * SharePoint blocks embedding (X-Frame-Options / CSP frame-ancestors).
 */
export function resolveAiSummaryViewerUrl(
  rawUrl: string | null | undefined,
): string | null {
  return toProxiedStorageUrl(rawUrl, {
    fileName: "AI_Tender_Summary.pdf",
  });
}

/** Direct SharePoint column URL for the Download button. */
export function resolveAiSummaryDownloadUrl(
  rawUrl: string | null | undefined,
): string | null {
  return toAccessibleStorageUrl(rawUrl, {
    download: true,
    fileName: "AI_Tender_Summary.pdf",
  });
}

/**
 * Fetch the PDF via the authenticated SharePoint proxy and expose a Blob URL
 * for the iframe (same pattern as the previous Azure blob viewer).
 */
async function fetchPdfObjectUrl(proxyUrl: string): Promise<string> {
  const cached = pdfObjectUrlCache.get(proxyUrl);
  if (cached) return cached;

  const existing = pdfFetchInFlight.get(proxyUrl);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(proxyUrl, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!response.ok) {
      let detail = "";
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        detail = body?.error || body?.code || "";
      }
      if (response.status === 401) {
        throw new Error("Sign in again to view the AI summary.");
      }
      if (response.status === 404) {
        throw new Error(
          detail || "AI summary file was not found in SharePoint.",
        );
      }
      throw new Error(detail || "Unable to load AI summary from SharePoint.");
    }
    const blob = await response.blob();
    if (!blob.size) {
      throw new Error("AI summary file was empty.");
    }
    const type =
      blob.type && blob.type !== "application/octet-stream"
        ? blob.type
        : "application/pdf";
    const pdfBlob =
      type === "application/pdf"
        ? blob
        : new Blob([blob], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(pdfBlob);
    pdfObjectUrlCache.set(proxyUrl, objectUrl);
    return objectUrl;
  })().finally(() => {
    pdfFetchInFlight.delete(proxyUrl);
  });

  pdfFetchInFlight.set(proxyUrl, promise);
  return promise;
}

/** Prefetch PDF bytes on hover without opening the dialog. */
export function preloadAiSummaryUrl(rawUrl: string | null | undefined): void {
  const url = resolveAiSummaryViewerUrl(rawUrl);
  if (!url) return;
  void fetchPdfObjectUrl(url).catch(() => undefined);
}

export function AiSummaryDialog({
  open,
  onOpenChange,
  tender,
}: AiSummaryDialogProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const viewerUrl = useMemo(
    () => resolveAiSummaryViewerUrl(tender?.aiSummaryUrl),
    [tender?.aiSummaryUrl],
  );
  const downloadUrl = useMemo(
    () => resolveAiSummaryDownloadUrl(tender?.aiSummaryUrl),
    [tender?.aiSummaryUrl],
  );

  const resetViewer = useCallback(() => {
    setObjectUrl(null);
    setIframeLoaded(false);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      resetViewer();
      return;
    }
    resetViewer();
    if (!viewerUrl) {
      setLoadError("missing");
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const url = await fetchPdfObjectUrl(viewerUrl);
        if (cancelled) return;
        setObjectUrl(url);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        setLoadError(
          error instanceof Error ? error.message : "Unable to load AI summary.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, viewerUrl, retryKey, resetViewer]);

  const metaLine = [
    tender?.sourcePortal,
    tender?.sourceTenderId ? `ID ${tender.sourceTenderId}` : null,
    tender?.referenceNo ? `Ref ${tender.referenceNo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        aria-describedby="ai-summary-dialog-desc"
        className={cn(
          "flex flex-col gap-3 overflow-hidden p-4 sm:p-5",
          expanded
            ? "h-[96vh] w-[96vw] max-w-[96vw]"
            : "h-[90vh] w-[95vw] max-w-[1100px] sm:h-[86vh] sm:w-[min(1100px,90vw)]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 pr-8">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Sparkles className="size-4 text-emerald-600" aria-hidden />
            AI Tender Summary
          </DialogTitle>
          <DialogDescription id="ai-summary-dialog-desc" className="sr-only">
            Preview of the AI-generated tender summary PDF
          </DialogDescription>
          {tender ? (
            <div className="space-y-1 text-left">
              <p className="text-sm font-medium leading-snug text-foreground-900">
                {tender.title}
              </p>
              {metaLine ? (
                <p className="text-xs text-foreground-500">{metaLine}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  AI Generated
                </span>
                {tender.organisationName ? (
                  <span className="text-[11px] text-foreground-500">
                    {tender.organisationName}
                  </span>
                ) : null}
                {tender.closingDate ? (
                  <span className="text-[11px] text-foreground-500">
                    Deadline: {formatDate(tender.closingDate)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background-50">
          {loadError === "missing" ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Sparkles className="size-6 text-foreground-300" />
              <p className="text-sm font-medium text-foreground-800">
                AI summary is not available for this tender.
              </p>
            </div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-medium text-foreground-800">
                {loadError}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (viewerUrl) {
                    const cached = pdfObjectUrlCache.get(viewerUrl);
                    if (cached) {
                      URL.revokeObjectURL(cached);
                      pdfObjectUrlCache.delete(viewerUrl);
                    }
                  }
                  setRetryKey((k) => k + 1);
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              {(loading || !iframeLoaded) && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90">
                  <Loader2 className="size-6 animate-spin text-emerald-600" />
                  <p className="text-sm font-medium text-foreground-800">
                    Preparing AI Summary
                  </p>
                  <p className="text-xs text-foreground-500">
                    {loading
                      ? "Fetching PDF from SharePoint…"
                      : "Opening PDF viewer…"}
                  </p>
                </div>
              )}
              {objectUrl ? (
                <iframe
                  key={`${objectUrl}:${retryKey}`}
                  title={`AI summary for ${tender?.title || "tender"}`}
                  src={objectUrl}
                  className="h-full w-full bg-white"
                  onLoad={() => setIframeLoaded(true)}
                  onError={() =>
                    setLoadError("Unable to load AI summary.")
                  }
                />
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!objectUrl || Boolean(loadError)}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Expand className="size-3.5" />
            )}
            {expanded ? "Exit full screen" : "Open full screen"}
          </Button>
          {downloadUrl || objectUrl ? (
            <Button type="button" size="sm" className="gap-1.5" asChild>
              <a
                href={objectUrl || downloadUrl || "#"}
                download="AI_Tender_Summary.pdf"
                target="_blank"
                rel="noreferrer"
              >
                <Download className="size-3.5" />
                Download
              </a>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
