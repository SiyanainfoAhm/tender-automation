"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import type { CompanyDocument } from "@/server/repositories/documentRepository";
import { deleteCompanyDocumentAction } from "@/server/actions/company";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function categoryStyles(category: string) {
  switch (category) {
    case "GST":
    case "PAN":
      return {
        icon: "bg-amber-100 text-amber-800",
        capsule: "bg-amber-100 text-amber-800",
      };
    case "Certificate":
      return {
        icon: "bg-emerald-100 text-emerald-800",
        capsule: "bg-emerald-100 text-emerald-800",
      };
    case "Financial":
      return {
        icon: "bg-sky-100 text-sky-800",
        capsule: "bg-sky-100 text-sky-800",
      };
    case "Experience":
      return {
        icon: "bg-violet-100 text-violet-800",
        capsule: "bg-violet-100 text-violet-800",
      };
    case "Bank Guarantee":
      return {
        icon: "bg-rose-100 text-rose-800",
        capsule: "bg-rose-100 text-rose-800",
      };
    default:
      return {
        icon: "bg-background-200 text-foreground-600",
        capsule: "bg-background-200 text-foreground-600",
      };
  }
}

function StatusRow({ doc }: { doc: CompanyDocument }) {
  if (doc.expiryState === "EXPIRED") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
        <AlertTriangle className="size-3" />
        Expired
      </span>
    );
  }
  if (doc.expiryState === "EXPIRING_SOON") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
        <Clock className="size-3" />
        Expiring soon
      </span>
    );
  }
  if (doc.verificationStatus === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 className="size-3" />
        Verified
      </span>
    );
  }
  if (doc.verificationStatus === "rejected") {
    return (
      <span className="text-[11px] font-medium text-rose-700">Rejected</span>
    );
  }
  return (
    <span className="text-[11px] text-foreground-400">Pending</span>
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
  const categoryLabel = doc.certificateType || doc.documentCategory;
  const styleKey =
    categoryLabel.toUpperCase() === "GST" ||
    categoryLabel.toUpperCase() === "PAN"
      ? categoryLabel
      : doc.documentCategory;
  const styles = categoryStyles(styleKey);
  const hasFile = Boolean(doc.storageBlobName || doc.storageUrl);
  const disabled = busy != null || pending;

  function documentApiUrl(mode: "view" | "download") {
    const base = `/api/documents/${encodeURIComponent(doc.id)}`;
    return mode === "download" ? `${base}?download=1` : base;
  }

  function openFile(mode: "view" | "download") {
    if (!hasFile) {
      toast.error("No file is available for this document.");
      return;
    }
    const url = documentApiUrl(mode);
    if (mode === "download") {
      const a = window.document.createElement("a");
      a.href = url;
      a.download = doc.originalFileName || doc.name;
      a.rel = "noopener";
      a.target = "_blank";
      a.click();
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
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

  return (
    <Card
      className="group cursor-pointer transition-all hover:border-primary-300/40"
      onClick={() => {
        if (hasFile) openFile("view");
      }}
    >
      <CardContent className="p-4 pt-4 sm:p-4 sm:pt-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              styles.icon,
            )}
          >
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground-800 transition-colors group-hover:text-primary-600">
                {doc.name}
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-foreground-400 hover:text-foreground-700"
                    aria-label="Document actions"
                    disabled={disabled}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {busy === "delete" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="size-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40"
                  onClick={(event) => event.stopPropagation()}
                >
                  <DropdownMenuItem
                    disabled={!hasFile || disabled}
                    onSelect={() => openFile("view")}
                  >
                    <Eye className="size-4" />
                    View
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!hasFile || disabled}
                    onSelect={() => openFile("download")}
                  >
                    <Download className="size-4" />
                    Download
                  </DropdownMenuItem>
                  {canManage ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-status-nogo"
                        disabled={disabled}
                        onSelect={handleDelete}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium",
                  styles.capsule,
                )}
              >
                {categoryLabel}
              </span>
              {doc.fileSizeBytes != null ? (
                <span className="text-xs text-foreground-400">
                  {formatBytes(doc.fileSizeBytes)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-foreground-400">
                {formatDate(doc.createdAt)}
              </span>
              <StatusRow doc={doc} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
