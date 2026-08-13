"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { uploadCompanyDocumentAction } from "@/server/actions/company";
import {
  CERTIFICATE_TYPES,
  FINANCIAL_DOCUMENT_TYPES,
  generateFinancialYears,
} from "@/lib/company/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type UploadKind = "general" | "certificate" | "financial";

type UploadDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: UploadKind;
};

const COPY: Record<
  UploadKind,
  { title: string; subtitle: string; info: string }
> = {
  general: {
    title: "General Document",
    subtitle:
      "Upload general documents that never expire — company policies, brochures, internal records.",
    info: "General documents do not expire — no renewal tracking needed.",
  },
  certificate: {
    title: "Certificate",
    subtitle:
      "Upload certifications with expiry tracking — ISO, CMMI, MSME, Startup India, and more.",
    info: "Expiry dates power dashboard renewal reminders.",
  },
  financial: {
    title: "Financial Document",
    subtitle:
      "Upload financial documents by year — Balance Sheet, P&L, ITR, audit reports.",
    info: "Financial years are generated dynamically from the current FY.",
  },
};

export function UploadDocumentDialog({
  open,
  onOpenChange,
  kind,
}: UploadDocumentDialogProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    uploadCompanyDocumentAction,
    {},
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const fyOptions = generateFinancialYears(12);
  const copy = COPY[kind];

  useEffect(() => {
    if (!open) {
      setFileName(null);
    }
  }, [open]);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Document uploaded successfully.");
      setFileName(null);
      setFormKey((k) => k + 1);
      onOpenChange(false);
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onOpenChange, router]);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        showCloseButton={!pending}
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.subtitle}</DialogDescription>
        </DialogHeader>

        <form
          key={formKey}
          action={formAction}
          className="flex min-h-0 flex-1 flex-col"
        >
          <input type="hidden" name="uploadKind" value={kind} />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Document Name *</Label>
              <Input id="name" name="name" required disabled={pending} />
            </div>

            {kind === "certificate" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="certificateType">Certificate Type *</Label>
                  <select
                    id="certificateType"
                    name="certificateType"
                    required
                    disabled={pending}
                    className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                  >
                    <option value="">Select type</option>
                    {CERTIFICATE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="issuingAuthority">Issuing Authority *</Label>
                  <Input
                    id="issuingAuthority"
                    name="issuingAuthority"
                    required
                    disabled={pending}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="issueDate">Issue Date *</Label>
                    <Input
                      id="issueDate"
                      name="issueDate"
                      type="date"
                      required
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expiryDate">Expiry Date *</Label>
                    <Input
                      id="expiryDate"
                      name="expiryDate"
                      type="date"
                      required
                      disabled={pending}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {kind === "financial" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="financialYear">Financial Year *</Label>
                  <select
                    id="financialYear"
                    name="financialYear"
                    required
                    disabled={pending}
                    className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                  >
                    <option value="">Select FY</option>
                    {fyOptions.map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="documentType">Document Type *</Label>
                  <select
                    id="documentType"
                    name="documentType"
                    required
                    disabled={pending}
                    className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                  >
                    <option value="">Select type</option>
                    {FINANCIAL_DOCUMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="file">Upload File *</Label>
              <label
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-secondary px-4 py-8 text-center",
                  pending
                    ? "pointer-events-none cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:border-primary/40",
                )}
              >
                <Upload className="mb-2 size-5 text-text-subtle" />
                <span className="text-sm text-text-secondary">
                  {pending
                    ? "Uploading document..."
                    : fileName || "Drag & drop or browse"}
                </span>
                <span className="mt-1 text-[11px] text-text-muted">
                  PDF, DOC, DOCX, XLS, XLSX up to 25 MB
                </span>
                <input
                  id="file"
                  name="file"
                  type="file"
                  required
                  disabled={pending}
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  onChange={(e) =>
                    setFileName(e.target.files?.[0]?.name || null)
                  }
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" name="notes" rows={2} disabled={pending} />
            </div>

            <p className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-[11px] text-text-muted">
              {copy.info}
            </p>
          </div>

          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload Document"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
