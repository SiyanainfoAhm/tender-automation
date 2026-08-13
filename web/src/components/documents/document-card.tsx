"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { CompanyDocument } from "@/server/repositories/documentRepository";
import { deleteCompanyDocumentAction } from "@/server/actions/company";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/format";

function expiryBadge(doc: CompanyDocument) {
  if (doc.expiryState === "NO_EXPIRY") return null;
  if (doc.expiryState === "EXPIRED") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (doc.expiryState === "EXPIRING_SOON") {
    return <Badge variant="warning">Expiring soon</Badge>;
  }
  return (
    <Badge variant="outline">
      Expires {doc.expiryDate ? formatDate(doc.expiryDate) : ""}
    </Badge>
  );
}

export function DocumentCard({
  document: doc,
  canManage = false,
}: {
  document: CompanyDocument;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"delete" | null>(null);
  const [pending, startTransition] = useTransition();

  const fileUrl = doc.storageUrl;
  const hasFile = Boolean(fileUrl);

  function openFile(mode: "view" | "download") {
    if (!fileUrl) {
      toast.error("No file URL is available for this document.");
      return;
    }
    if (mode === "download") {
      const a = window.document.createElement("a");
      a.href = fileUrl;
      a.download = doc.originalFileName || doc.name;
      a.rel = "noopener";
      a.target = "_blank";
      a.click();
      return;
    }
    window.open(fileUrl, "_blank", "noopener,noreferrer");
  }

  function handleDelete() {
    if (
      !window.confirm(
        `Delete “${doc.name}”? The file will be removed from storage.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    startTransition(async () => {
      try {
        const result = await deleteCompanyDocumentAction(doc.id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Document deleted.");
        router.refresh();
      } catch {
        toast.error("Unable to delete document");
      } finally {
        setBusy(null);
      }
    });
  }

  const disabled = busy != null || pending;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-text-primary">
              {doc.name}
            </p>
            <Badge variant="secondary">{doc.documentCategory}</Badge>
          </div>
          <p className="truncate text-xs text-text-muted">
            {doc.originalFileName || "No file name"}
            {doc.fileSizeBytes != null
              ? ` · ${formatBytes(doc.fileSizeBytes)}`
              : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                doc.verificationStatus === "verified" ? "success" : "outline"
              }
            >
              {doc.verificationStatus}
            </Badge>
            {expiryBadge(doc)}
            <span className="text-[11px] text-text-subtle">
              {formatDate(doc.createdAt)}
            </span>
          </div>
          {!hasFile ? (
            <p className="text-[11px] text-amber-700">
              Metadata only — file URL missing
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1 pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasFile || disabled}
              onClick={() => openFile("view")}
            >
              <Eye className="size-3.5" />
              View
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasFile || disabled}
              onClick={() => openFile("download")}
            >
              <Download className="size-3.5" />
              Download
            </Button>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={handleDelete}
              >
                {busy === "delete" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
