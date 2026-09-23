"use client";

import { useMemo, useState } from "react";
import { Check, FileText, Search } from "lucide-react";

import type { CompanyDocument } from "@/server/repositories/documentRepository";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function CompanyDocumentPickerDialog({
  open,
  onOpenChange,
  documents,
  selectedId,
  onSelect,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: CompanyDocument[];
  selectedId?: string | null;
  onSelect: (documentId: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) => {
      const hay = [
        doc.name,
        doc.originalFileName,
        doc.documentCategory,
        doc.certificateType,
        doc.documentType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [documents, query]);

  async function choose(documentId: string) {
    setPendingId(documentId);
    try {
      await onSelect(documentId);
      onOpenChange(false);
      setQuery("");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy || pendingId) return;
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Company Document</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, type, or file…"
            className="pl-9"
            disabled={busy || Boolean(pendingId)}
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-foreground-500">
              No company documents available
            </p>
          ) : (
            filtered.map((doc) => {
              const active = selectedId === doc.id;
              const loading = pendingId === doc.id;
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={busy || Boolean(pendingId)}
                  onClick={() => void choose(doc.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                    "hover:bg-background-50 disabled:opacity-60",
                    active && "bg-primary-50/70",
                  )}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-foreground-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground-900">
                      {doc.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-foreground-500">
                      {[
                        doc.certificateType || doc.documentCategory,
                        doc.originalFileName,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {loading ? (
                    <span className="text-xs text-foreground-500">…</span>
                  ) : active ? (
                    <Check className="size-4 shrink-0 text-primary-600" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy || Boolean(pendingId)}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
