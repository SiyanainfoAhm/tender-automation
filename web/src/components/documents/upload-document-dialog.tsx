"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { FileUploadProgress } from "@/components/documents/file-upload-progress";
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
import {
  CERTIFICATE_TYPES,
  FINANCIAL_DOCUMENT_TYPES,
  generateFinancialYears,
} from "@/lib/company/types";
import type {
  DocumentUploadMetadata,
  FileUploadProgressState,
  UploadKind,
} from "@/lib/uploads/types";
import { UploadManager } from "@/lib/uploads/uploadManager";
import {
  documentUploadAcceptAttr,
  documentUploadHint,
  validateDocumentFile,
  validateDocumentMetadata,
} from "@/lib/uploads/validation";
import { cn } from "@/lib/utils";

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

function isActiveStatus(status: FileUploadProgressState["status"] | undefined) {
  return (
    status === "queued" ||
    status === "preparing" ||
    status === "uploading" ||
    status === "finalizing"
  );
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  kind,
}: UploadDocumentDialogProps) {
  const router = useRouter();
  const managerRef = useRef<UploadManager | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const handledCompleteRef = useRef<string | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<FileUploadProgressState | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const fyOptions = generateFinancialYears(12);
  const copy = COPY[kind];
  const uploading = isActiveStatus(progress?.status);

  useEffect(() => {
    const manager = new UploadManager();
    managerRef.current = manager;
    const unsubscribe = manager.subscribe((items) => {
      const currentId = currentIdRef.current;
      const match = currentId
        ? items.find((item) => item.id === currentId)
        : items.at(-1);
      setProgress(match ?? null);
    });
    return () => {
      unsubscribe();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setProgress(null);
      setConfirmClose(false);
      setFormError(null);
    }
  }, [open]);

  const resetAndClose = useCallback(() => {
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    currentIdRef.current = null;
    managerRef.current?.clear();
    setFile(null);
    setProgress(null);
    setConfirmClose(false);
    setFormError(null);
    setFormKey((key) => key + 1);
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (progress?.status !== "complete" || !progress.id) return;
    if (handledCompleteRef.current === progress.id) return;
    handledCompleteRef.current = progress.id;
    toast.success("Document uploaded successfully.");
    successTimerRef.current = window.setTimeout(() => {
      resetAndClose();
      router.refresh();
    }, 1200);
  }, [progress?.id, progress?.status, resetAndClose, router]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  function requestClose() {
    if (uploading) {
      setConfirmClose(true);
      return;
    }
    resetAndClose();
  }

  async function cancelUploadAndClose() {
    if (progress?.id) {
      try {
        await managerRef.current?.cancel(progress.id);
      } catch {
        // Cancel is best-effort; still close the modal.
      }
    }
    resetAndClose();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const selected = file ?? (formData.get("file") instanceof File
      ? (formData.get("file") as File)
      : null);

    const metadata: DocumentUploadMetadata = {
      name: String(formData.get("name") || "").trim(),
      uploadKind: kind,
      notes: String(formData.get("notes") || "").trim(),
      certificateType: String(formData.get("certificateType") || "").trim(),
      issuingAuthority: String(formData.get("issuingAuthority") || "").trim(),
      issueDate: String(formData.get("issueDate") || "").trim(),
      expiryDate: String(formData.get("expiryDate") || "").trim(),
      financialYear: String(formData.get("financialYear") || "").trim(),
      documentType: String(formData.get("documentType") || "").trim(),
    };

    const fileError = validateDocumentFile(selected);
    if (fileError) {
      setFormError(fileError.message);
      return;
    }
    const metaError = validateDocumentMetadata(metadata);
    if (metaError) {
      setFormError(metaError.message);
      return;
    }

    try {
      const manager = managerRef.current;
      if (!manager || !selected) return;
      const id = manager.addFile(selected, metadata);
      currentIdRef.current = id;
      const result = await manager.start(id);
      if (result.status === "failed") {
        setFormError(result.error);
        return;
      }
      if (result.status === "complete") {
        router.refresh();
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Upload failed",
      );
    }
  }

  async function handleRetry() {
    if (!progress?.id) return;
    setFormError(null);
    try {
      const result = await managerRef.current?.retry(progress.id);
      if (result?.status === "failed") {
        setFormError(result.error);
      }
      if (result?.status === "complete") {
        router.refresh();
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Upload failed",
      );
    }
  }

  const showProgress = Boolean(progress && progress.status !== "queued");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        showCloseButton={!uploading}
        onEscapeKeyDown={(event) => {
          if (uploading) {
            event.preventDefault();
            setConfirmClose(true);
          }
        }}
        onPointerDownOutside={(event) => {
          if (uploading) {
            event.preventDefault();
            setConfirmClose(true);
          }
        }}
        onInteractOutside={(event) => {
          if (uploading) {
            event.preventDefault();
            setConfirmClose(true);
          }
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>
            {showProgress ? "Uploading Document" : copy.title}
          </DialogTitle>
          <DialogDescription>
            {showProgress
              ? progress?.fileName || file?.name || copy.subtitle
              : copy.subtitle}
          </DialogDescription>
        </DialogHeader>

        {confirmClose ? (
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-text-primary">
              An upload is currently in progress. Cancel upload?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmClose(false)}
              >
                Continue Upload
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void cancelUploadAndClose()}
              >
                Cancel Upload
              </Button>
            </div>
          </div>
        ) : (
          <form
            key={formKey}
            onSubmit={(event) => void handleSubmit(event)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {showProgress ? (
                <FileUploadProgress
                  fileName={progress?.fileName || file?.name || "Document"}
                  uploadedBytes={progress?.uploadedBytes ?? 0}
                  totalBytes={progress?.totalBytes ?? file?.size ?? 0}
                  percentage={progress?.percentage ?? 0}
                  currentChunk={progress?.currentChunk ?? 0}
                  totalChunks={progress?.totalChunks ?? 0}
                  status={progress?.status ?? "uploading"}
                  error={progress?.error || formError}
                  onCancel={
                    uploading
                      ? () => {
                          setConfirmClose(true);
                        }
                      : undefined
                  }
                  onRetry={
                    progress?.status === "failed"
                      ? () => void handleRetry()
                      : undefined
                  }
                />
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Document Name *</Label>
                    <Input id="name" name="name" required />
                  </div>

                  {kind === "certificate" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="certificateType">Certificate Type *</Label>
                        <select
                          id="certificateType"
                          name="certificateType"
                          required
                          className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                        >
                          <option value="">Select type</option>
                          {CERTIFICATE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
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
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="issueDate">Issue Date *</Label>
                          <Input id="issueDate" name="issueDate" type="date" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="expiryDate">Expiry Date *</Label>
                          <Input
                            id="expiryDate"
                            name="expiryDate"
                            type="date"
                            required
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
                          className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                        >
                          <option value="">Select type</option>
                          {FINANCIAL_DOCUMENT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
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
                        "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-secondary px-4 py-8 text-center hover:border-primary/40",
                      )}
                    >
                      <Upload className="mb-2 size-5 text-text-subtle" />
                      <span className="text-sm text-text-secondary">
                        {file?.name || "Drag & drop or browse"}
                      </span>
                      <span className="mt-1 text-[11px] text-text-muted">
                        {documentUploadHint()}
                      </span>
                      <input
                        id="file"
                        name="file"
                        type="file"
                        className="sr-only"
                        accept={documentUploadAcceptAttr()}
                        onChange={(event) => {
                          const next = event.target.files?.[0] || null;
                          const invalid = validateDocumentFile(next);
                          if (invalid && next) {
                            setFormError(invalid.message);
                            setFile(null);
                            event.target.value = "";
                            return;
                          }
                          setFormError(null);
                          setFile(next);
                        }}
                      />
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Textarea id="notes" name="notes" rows={2} />
                  </div>

                  {formError ? (
                    <p className="text-sm text-status-nogo" role="alert">
                      {formError}
                    </p>
                  ) : null}

                  <p className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-[11px] text-text-muted">
                    {copy.info}
                  </p>
                </>
              )}
            </div>

            <DialogFooter className="border-t border-border px-5 py-3">
              {progress?.status === "complete" ? (
                <Button
                  type="button"
                  onClick={() => {
                    resetAndClose();
                    router.refresh();
                  }}
                >
                  Done
                </Button>
              ) : showProgress ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading}
                  onClick={requestClose}
                >
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={requestClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Upload Document</Button>
                </>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
