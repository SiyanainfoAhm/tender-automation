"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DOCUMENT_STATUS_LABELS,
  WORKSPACE_DOCUMENT_STATUSES,
  WORKSPACE_DOCUMENT_TYPES,
  isDocumentReadyForSubmission,
} from "@/lib/bid-workspace";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteWorkspaceDocumentAction,
  updateWorkspaceDocumentStatusAction,
  uploadWorkspaceDocumentAction,
} from "@/server/actions/bid-workspace";
import type { WorkspaceDocumentRow } from "@/lib/bid-workspace";

type WorkspaceDocumentsProps = {
  tenderId: string;
  documents: WorkspaceDocumentRow[];
  readOnly: boolean;
};

export function WorkspaceDocuments({
  tenderId,
  documents,
  readOnly,
}: WorkspaceDocumentsProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("Other");
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readyCount = documents.filter((doc) =>
    isDocumentReadyForSubmission(doc.status, doc.hasFile),
  ).length;

  const visible = useMemo(() => {
    return documents.filter((doc) => {
      const matchesFilter = filter === "All" || doc.documentType === filter;
      const matchesQuery =
        !query.trim() ||
        `${doc.title} ${doc.fileName || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [documents, filter, query]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("tenderId", tenderId);
      form.set("title", title.trim() || file.name);
      form.set("documentType", documentType);
      if (replaceId) form.set("documentId", replaceId);
      form.set("file", file);
      const result = await uploadWorkspaceDocumentAction(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Document uploaded.");
      setUploadOpen(false);
      setTitle("");
      setReplaceId(null);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function remove(doc: WorkspaceDocumentRow) {
    if (!window.confirm(`Remove “${doc.title}”?`)) return;
    const result = await deleteWorkspaceDocumentAction({
      tenderId,
      documentId: doc.id,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Document deleted.");
    router.refresh();
  }

  async function changeStatus(doc: WorkspaceDocumentRow, status: string) {
    const result = await updateWorkspaceDocumentStatusAction({
      tenderId,
      documentId: doc.id,
      status,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Document status updated.");
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
            Bid Documents
          </h2>
          <p className="mt-1 text-sm text-foreground-600">
            {readyCount} of {documents.length} ready for submission
          </p>
        </div>
        <Button
          size="sm"
          disabled={readOnly}
          onClick={() => {
            setReplaceId(null);
            setTitle("");
            setDocumentType("Other");
            setUploadOpen(true);
          }}
        >
          <Upload className="size-4" />
          Upload Document
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-foreground-400" />
          <Input
            className="pl-8"
            placeholder="Search..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {["All", ...WORKSPACE_DOCUMENT_TYPES].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap",
                filter === type
                  ? "bg-emerald-600 text-white"
                  : "border border-border text-foreground-600",
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-foreground-500">
          No workspace documents yet.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((doc) => (
            <article
              key={doc.id}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                  <FileText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{doc.title}</p>
                  <p className="text-xs text-foreground-500">
                    {doc.documentType}
                    {doc.fileSizeBytes != null
                      ? ` · ${formatBytes(doc.fileSizeBytes)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Select
                  value={doc.status}
                  disabled={readOnly}
                  onValueChange={(value) => void changeStatus(doc, value)}
                >
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_DOCUMENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {DOCUMENT_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  {doc.versionLabel ? (
                    <span className="text-[11px] text-foreground-400">
                      {doc.versionLabel}
                    </span>
                  ) : null}
                  {doc.hasFile ? (
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={`/api/bid-workspace/documents/${doc.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="size-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={readOnly}
                    onClick={() => {
                      setReplaceId(doc.id);
                      setTitle(doc.title);
                      setDocumentType(doc.documentType);
                      setUploadOpen(true);
                    }}
                  >
                    <Upload className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={readOnly}
                    onClick={() => void remove(doc)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {replaceId ? "Replace document" : "Upload document"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSPACE_DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>File</Label>
              <Input ref={fileRef} type="file" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button disabled={uploading} onClick={() => void upload()}>
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
