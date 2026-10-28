"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Expand, FileText, Loader2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  clearAuthenticatedDocumentPreview,
  fetchAuthenticatedDocumentObjectUrl,
  preloadAuthenticatedDocument,
} from "@/lib/storage/authenticated-document-preview";

/** Load the file once, retrying a single time on a dropped connection. */
async function loadDocumentBlob(href: string): Promise<{ objectUrl: string; blob: Blob }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const objectUrl = await fetchAuthenticatedDocumentObjectUrl(href);
      const blob = await (await fetch(objectUrl)).blob();
      return { objectUrl, blob };
    } catch (error) {
      lastError = error;
      clearAuthenticatedDocumentPreview(href);
    }
  }
  if (lastError instanceof Error && /failed to fetch|network/i.test(lastError.message)) {
    throw new Error("The document could not be loaded. Check your connection and try again, or use Download.");
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to load the document.");
}

export type PreviewDocument = {
  title: string;
  fileName?: string | null;
  href: string;
  requirementName: string;
};

type PreviewKind = "pdf" | "image" | "docx" | "other";

/** Prefetches linked documents when a user hovers View Document. */
export function preloadChecklistDocument(href: string | null | undefined) {
  preloadAuthenticatedDocument(href);
}

/**
 * Work out the real file type from its first bytes, then the file name, then the
 * response type. Storage often answers with application/octet-stream, which makes
 * browsers download a PDF instead of showing it.
 */
function detectKind(bytes: Uint8Array, fileName: string, mime: string): PreviewKind {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith("%PDF")) return "pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image";
  const name = fileName.toLowerCase();
  if (/\.pdf$/.test(name) || mime.includes("pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/.test(name) || mime.startsWith("image/")) return "image";
  if (head.startsWith("PK") && (/\.docx$/.test(name) || mime.includes("wordprocessingml")))
    return "docx";
  if (/\.docx$/.test(name) || mime.includes("wordprocessingml")) return "docx";
  return "other";
}

const MIME_FOR_KIND: Record<PreviewKind, string> = {
  pdf: "application/pdf",
  image: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  other: "application/octet-stream",
};

export function ChecklistDocumentPreviewDialog({
  open,
  onOpenChange,
  document,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: PreviewDocument | null;
}) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const docxRef = useRef<HTMLDivElement>(null);
  const docxStyleRef = useRef<HTMLDivElement>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!open || !document) {
      setViewUrl(null);
      setDownloadUrl(null);
      setKind(null);
      setDocxBlob(null);
      setError(null);
      setLoaded(false);
      setExpanded(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setLoaded(false);
    setError(null);
    setKind(null);
    setDocxBlob(null);

    void (async () => {
      try {
        const { objectUrl, blob } = await loadDocumentBlob(document.href);
        if (cancelled) return;
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        const detected = detectKind(
          head,
          document.fileName || document.title || "",
          (blob.type || "").toLowerCase(),
        );
        setDownloadUrl(objectUrl);
        setKind(detected);
        if (detected === "pdf" || detected === "image") {
          // Re-type the blob so the browser renders it inline instead of downloading.
          const typed =
            blob.type === MIME_FOR_KIND[detected] || (detected === "image" && blob.type.startsWith("image/"))
              ? blob
              : new Blob([blob], { type: MIME_FOR_KIND[detected] });
          createdUrl = typed === blob ? null : URL.createObjectURL(typed);
          setViewUrl(createdUrl || objectUrl);
        } else if (detected === "docx") {
          setDocxBlob(blob);
        } else {
          setLoaded(true);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "Unable to load the document.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [document, open]);

  // Render Word files with their layout, headers and footers (so the stamp and
  // signature on each page are visible) using docx-preview. It builds DOM nodes
  // from the document XML and never executes scripts from the file.
  useEffect(() => {
    if (!docxBlob || !docxRef.current) return;
    let cancelled = false;
    const container = docxRef.current;
    const styleContainer = docxStyleRef.current || undefined;
    container.innerHTML = "";
    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(docxBlob, container, styleContainer, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (!cancelled) setLoaded(true);
      } catch {
        if (!cancelled) setError("Unable to preview this Word document. Use Download to open it.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docxBlob]);

  const showLoading = !error && !loaded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "flex flex-col gap-3 overflow-hidden p-4 sm:p-5",
          expanded
            ? "h-[96vh] w-[96vw] max-w-[96vw] sm:max-w-[96vw]"
            : "h-[90vh] w-[95vw] max-w-[1100px] sm:h-[86vh] sm:w-[min(1100px,90vw)] sm:max-w-[1100px]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 pr-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-emerald-600" />
            <span className="truncate">{document?.fileName || document?.title || "Document"}</span>
          </DialogTitle>
          <DialogDescription>
            {document ? (
              <>
                For requirement:{" "}
                <span className="font-medium text-foreground-700">
                  {document.requirementName}
                </span>
              </>
            ) : (
              ""
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background-50">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-foreground-600">
              {error}
            </div>
          ) : kind === "docx" ? (
            <div className="h-full overflow-auto bg-slate-100">
              <div ref={docxStyleRef} />
              <div ref={docxRef} className="[&_.docx-preview-wrapper]:bg-slate-100" />
            </div>
          ) : kind === "other" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText className="size-7 text-foreground-300" />
              <p className="text-sm text-foreground-600">
                Preview is available for PDF, Word (.docx) and image files. Use Download to
                open this file.
              </p>
            </div>
          ) : kind === "image" && viewUrl ? (
            <div className="flex h-full items-center justify-center overflow-auto bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewUrl}
                alt={document?.title || "Document"}
                className="max-h-full max-w-full object-contain"
                onLoad={() => setLoaded(true)}
                onError={() => setError("Unable to preview this image.")}
              />
            </div>
          ) : kind === "pdf" && viewUrl ? (
            <iframe
              title={document?.title || "Checklist document"}
              src={viewUrl}
              className="h-full w-full bg-white"
              onLoad={() => setLoaded(true)}
            />
          ) : null}
          {showLoading ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90">
              <Loader2 className="size-6 animate-spin text-emerald-600" />
              <p className="text-sm font-medium text-foreground-700">Opening document…</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(error) || !kind || kind === "other"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <Minimize2 className="mr-1.5 size-3.5" />
            ) : (
              <Expand className="mr-1.5 size-3.5" />
            )}
            {expanded ? "Exit full screen" : "Full screen"}
          </Button>
          {document ? (
            <Button type="button" size="sm" asChild>
              <a href={downloadUrl || document.href} download={document.fileName || document.title || true}>
                <Download className="mr-1.5 size-3.5" />
                Download
              </a>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
