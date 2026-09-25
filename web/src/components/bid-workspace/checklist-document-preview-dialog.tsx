"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Expand, FileText, Loader2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  fetchAuthenticatedDocumentObjectUrl,
  preloadAuthenticatedDocument,
} from "@/lib/storage/authenticated-document-preview";

type PreviewDocument = { title: string; fileName?: string | null; href: string; requirementName: string };
/** Prefetches linked PDFs/images when a user hovers View Document. */
export function preloadChecklistDocument(href: string | null | undefined) {
  preloadAuthenticatedDocument(href);
}

export function ChecklistDocumentPreviewDialog({ open, onOpenChange, document }: { open: boolean; onOpenChange: (open: boolean) => void; document: PreviewDocument | null }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isEmbeddable = useMemo(() => /\.(pdf|png|jpe?g)$/i.test(document?.fileName || document?.href || ""), [document]);
  useEffect(() => {
    if (!open || !document) { setObjectUrl(null); setError(null); setLoaded(false); setExpanded(false); return; }
    let cancelled = false; setLoaded(false); setError(null);
    void fetchAuthenticatedDocumentObjectUrl(document.href).then((url) => { if (!cancelled) setObjectUrl(url); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load the document."); });
    return () => { cancelled = true; };
  }, [open, document]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent showCloseButton className={cn("flex flex-col gap-3 overflow-hidden p-4 sm:p-5", expanded ? "h-[96vh] w-[96vw] max-w-[96vw]" : "h-[90vh] w-[95vw] max-w-[1100px] sm:h-[86vh] sm:w-[min(1100px,90vw)]")}>
    <DialogHeader className="shrink-0 space-y-1.5 pr-8"><DialogTitle className="flex items-center gap-2 text-base"><FileText className="size-4 text-emerald-600" />Linked checklist document</DialogTitle><DialogDescription>{document ? <>For requirement: <span className="font-medium text-foreground-700">{document.requirementName}</span></> : ""}</DialogDescription><p className="truncate text-sm font-medium text-foreground-900">{document?.title}</p></DialogHeader>
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background-50">{error ? <div className="flex h-full items-center justify-center px-6 text-center text-sm text-foreground-600">{error}</div> : !isEmbeddable ? <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><FileText className="size-7 text-foreground-300" /><p className="text-sm text-foreground-600">This file type cannot be previewed in the browser. Download it to view the document.</p></div> : <>{(!objectUrl || !loaded) && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90"><Loader2 className="size-6 animate-spin text-emerald-600" /><p className="text-sm font-medium text-foreground-700">Preparing document preview</p></div>}{objectUrl ? <iframe title={document?.title || "Checklist document"} src={objectUrl} className="h-full w-full bg-white" onLoad={() => setLoaded(true)} onError={() => setError("Unable to preview this document.")} /> : null}</>}</div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3"><Button type="button" size="sm" variant="outline" disabled={!objectUrl || !isEmbeddable || Boolean(error)} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="mr-1.5 size-3.5" /> : <Expand className="mr-1.5 size-3.5" />}{expanded ? "Exit full screen" : "Open full screen"}</Button>{document ? <Button type="button" size="sm" asChild><a href={objectUrl || document.href} download={document.fileName || undefined} target="_blank" rel="noreferrer"><Download className="mr-1.5 size-3.5" />Download</a></Button> : null}</div>
  </DialogContent></Dialog>;
}
