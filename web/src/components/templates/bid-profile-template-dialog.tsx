"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  TEMPLATE_ASSET_ACCEPT,
  fileNameFromUrl,
  formatTemplateAssetSize,
  getTemplateAssetType,
  templateAssetValidationError,
} from "@/lib/templates/templateAsset";
import type { BidProfileTemplate } from "@/lib/templates/types";
import {
  createBidProfileTemplateAction,
  updateBidProfileTemplateAction,
} from "@/server/actions/templates";

type BidProfileTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  template?: BidProfileTemplate | null;
  companyName: string;
  companyAddress: string;
};

function SignStampPreview({
  assetType,
  imageUrl,
}: {
  assetType: "image" | "pdf" | "file";
  imageUrl?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const showImage = assetType === "image" && Boolean(imageUrl) && !imageFailed;

  return (
    <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-background-200/70 bg-background-100">
      {showImage ? (
        <img
          src={imageUrl!}
          alt="Company Sign and Stamp"
          className="h-12 w-16 rounded object-contain"
          onError={() => setImageFailed(true)}
        />
      ) : assetType === "pdf" ? (
        <div className="flex flex-col items-center gap-0.5">
          <FileText className="size-5 text-red-600" />
          <span className="text-[9px] font-semibold leading-none text-red-600">
            PDF
          </span>
        </div>
      ) : (
        <FileText className="size-5 text-foreground-400" />
      )}
    </div>
  );
}

function FilePicker({
  id,
  name,
  label,
  disabled,
  file,
  existingUrl,
  existingFileName,
  onFileChange,
}: {
  id: string;
  name: string;
  label: string;
  disabled: boolean;
  file: File | null;
  existingUrl?: string | null;
  existingFileName?: string | null;
  onFileChange: (next: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || getTemplateAssetType(null, file.name) !== "image") {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const existingName =
    existingFileName ||
    (existingUrl ? fileNameFromUrl(existingUrl) : null);
  const selectedName = file?.name || existingName;
  const assetType = file
    ? getTemplateAssetType(null, file.name)
    : getTemplateAssetType(null, existingName);
  const imageUrl =
    file && assetType === "image"
      ? localPreviewUrl
      : !file && assetType === "image"
        ? existingUrl
        : null;
  const hasExisting = Boolean(existingUrl);
  const hasSelection = Boolean(file) || hasExisting;
  const statusLabel = file
    ? "New file selected"
    : hasExisting
      ? "Current uploaded file"
      : null;
  const chooseLabel = file
    ? "Change File"
    : hasExisting
      ? "Choose Replacement"
      : "Choose File";
  const sizeHint =
    file && assetType === "pdf"
      ? `PDF document · ${formatTemplateAssetSize(file.size)}`
      : file && assetType === "image"
        ? formatTemplateAssetSize(file.size)
        : !file && assetType === "pdf"
          ? "PDF document"
          : null;

  return (
    <div>
      <Label htmlFor={id} className="mb-1 block">
        {label}
      </Label>
      <div className="flex items-start gap-3">
        <SignStampPreview assetType={hasSelection ? assetType : "file"} imageUrl={imageUrl} />
        <div className="min-w-0 flex-1">
          {hasSelection ? (
            <>
              <p className="truncate text-sm font-medium text-foreground-800">
                {selectedName}
              </p>
              <p className="text-xs text-foreground-400">{statusLabel}</p>
              {sizeHint ? (
                <p className="text-xs text-foreground-400">{sizeHint}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!file && existingUrl ? (
                  <a
                    href={existingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-background-200/70 bg-white px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100"
                  >
                    View
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => inputRef.current?.click()}
                  className="rounded-md border border-background-200/70 bg-white px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:pointer-events-none disabled:opacity-50"
                >
                  {chooseLabel}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="rounded-md border border-background-200/70 bg-white px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:pointer-events-none disabled:opacity-50"
              >
                Choose File
              </button>
              <p className="mt-1.5 text-xs text-foreground-400">
                PDF, PNG, JPG, JPEG, WEBP
              </p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={TEMPLATE_ASSET_ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0] || null;
            if (!next) {
              onFileChange(null);
              return;
            }
            const error = templateAssetValidationError(next);
            if (error) {
              toast.error(error);
              e.target.value = "";
              onFileChange(null);
              return;
            }
            onFileChange(next);
          }}
        />
      </div>
    </div>
  );
}

export function BidProfileTemplateDialog({
  open,
  onOpenChange,
  mode,
  template,
  companyName,
  companyAddress,
}: BidProfileTemplateDialogProps) {
  const router = useRouter();
  const action =
    mode === "edit"
      ? updateBidProfileTemplateAction
      : createBidProfileTemplateAction;
  const [state, formAction, pending] = useActionState(action, {});
  const [isDefault, setIsDefault] = useState(Boolean(template?.isDefault));
  const [formKey, setFormKey] = useState(0);
  const [companySignStampFile, setCompanySignStampFile] = useState<File | null>(
    null,
  );
  const submissionPendingRef = useRef(false);
  const isEditing = mode === "edit";

  useEffect(() => {
    submissionPendingRef.current = false;
  }, [open]);

  useEffect(() => {
    if (open) {
      setIsDefault(Boolean(template?.isDefault));
      setCompanySignStampFile(null);
      setFormKey((k) => k + 1);
    }
  }, [open, template?.id, template?.isDefault]);

  useEffect(() => {
    if (!submissionPendingRef.current) return;

    if (state?.ok) {
      submissionPendingRef.current = false;
      toast.success(isEditing ? "Template updated." : "Template created.");
      router.refresh();
      onOpenChange(false);
      return;
    }

    if (state?.error) {
      submissionPendingRef.current = false;
      toast.error(state.error);
    }
  }, [state, isEditing, onOpenChange, router]);

  function handleClose() {
    if (pending) return;
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[calc(100%-1rem)] max-h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl border border-background-200/70 bg-white p-0 shadow-2xl sm:w-[calc(100%-2rem)]"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-background-200/70 px-6 py-4">
          <div className="min-w-0 pr-4">
            <DialogTitle>
              {isEditing ? "Edit Template" : "Create New Template"}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {isEditing
                ? "Update this bid profile template"
                : "Create a reusable bid profile template"}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className="rounded-md p-1 text-foreground-400 transition-colors hover:bg-background-100 hover:text-foreground-900 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          key={formKey}
          action={formAction}
          onSubmit={(event) => {
            if (pending) {
              event.preventDefault();
              return;
            }
            submissionPendingRef.current = true;
          }}
          className="flex min-h-0 flex-col overflow-hidden"
        >
          {isEditing && template ? (
            <input type="hidden" name="id" value={template.id} />
          ) : null}
          <input
            type="hidden"
            name="isDefault"
            value={isDefault ? "true" : "false"}
          />

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <section className="mb-6">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Template Info
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="templateName">Template Name *</Label>
                  <Input
                    id="templateName"
                    name="templateName"
                    required
                    disabled={pending}
                    defaultValue={template?.templateName || ""}
                    placeholder="e.g. IT Division - Standard Bid"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={2}
                    disabled={pending}
                    defaultValue={template?.description || ""}
                    placeholder="Brief description of when to use this template"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-background-200/70 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      Set as Default
                    </p>
                    <p className="text-xs text-text-muted">
                      {isDefault ? "Default template" : "Not the default"}
                    </p>
                  </div>
                  <Switch
                    checked={isDefault}
                    disabled={pending}
                    onCheckedChange={setIsDefault}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>
            </section>

            <section className="mb-6">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Company & Reference
              </h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="companyName">Company Name *</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    required
                    disabled={pending}
                    defaultValue={template?.companyName || companyName}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="referenceNumber">Reference Number</Label>
                  <Input
                    id="referenceNumber"
                    name="referenceNumber"
                    disabled={pending}
                    defaultValue={template?.referenceNumber || ""}
                    placeholder="e.g. SISL/TENDER/2025/001"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenderAcceptanceUndertakingDate">
                    Tender Acceptance Undertaking Date
                  </Label>
                  <Input
                    id="tenderAcceptanceUndertakingDate"
                    name="tenderAcceptanceUndertakingDate"
                    type="date"
                    disabled={pending}
                    defaultValue={
                      template?.tenderAcceptanceUndertakingDate || ""
                    }
                  />
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="minimumLocalContent">
                    Minimum Local Content (%)
                  </Label>
                  <Input
                    id="minimumLocalContent"
                    name="minimumLocalContent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    disabled={pending}
                    defaultValue={
                      template?.minimumLocalContent != null
                        ? String(template.minimumLocalContent)
                        : ""
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="localValueAdditionLocation">
                    Location of Local Value Addition
                  </Label>
                  <Input
                    id="localValueAdditionLocation"
                    name="localValueAdditionLocation"
                    disabled={pending}
                    defaultValue={template?.localValueAdditionLocation || ""}
                    placeholder="e.g. Ahmedabad, Gujarat"
                  />
                </div>
              </div>
            </section>

            <section className="mb-6">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Authorized Person & Signatory
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(260px,1.25fr)_repeat(3,minmax(0,1fr))]">
                <div className="grid min-w-0 grid-rows-[40px_auto]">
                  <div className="flex items-end pb-1.5">
                    <Label
                      htmlFor="authorizedPersonName"
                      className="text-sm font-medium text-foreground-700 lg:whitespace-nowrap"
                    >
                      Authorized Person (Power of Attorney)
                      <span className="ml-1 text-danger">*</span>
                    </Label>
                  </div>
                  <Input
                    id="authorizedPersonName"
                    name="authorizedPersonName"
                    required
                    disabled={pending}
                    defaultValue={template?.authorizedPersonName || ""}
                    placeholder="e.g. Mr. Shashank Sharma"
                  />
                </div>
                <div className="grid min-w-0 grid-rows-[40px_auto]">
                  <div className="flex items-end pb-1.5">
                    <Label
                      htmlFor="authorizedPersonPosition"
                      className="text-sm font-medium text-foreground-700"
                    >
                      Position (Power of Attorney)
                    </Label>
                  </div>
                  <Input
                    id="authorizedPersonPosition"
                    name="authorizedPersonPosition"
                    disabled={pending}
                    defaultValue={template?.authorizedPersonPosition || ""}
                    placeholder="e.g. Sr. Project Manager"
                  />
                </div>
                <div className="grid min-w-0 grid-rows-[40px_auto]">
                  <div className="flex items-end pb-1.5">
                    <Label
                      htmlFor="signatoryName"
                      className="text-sm font-medium text-foreground-700"
                    >
                      Signatory Name
                      <span className="ml-1 text-danger">*</span>
                    </Label>
                  </div>
                  <Input
                    id="signatoryName"
                    name="signatoryName"
                    required
                    disabled={pending}
                    defaultValue={template?.signatoryName || ""}
                    placeholder="e.g. Mr. Shashank Sharma"
                  />
                </div>
                <div className="grid min-w-0 grid-rows-[40px_auto]">
                  <div className="flex items-end pb-1.5">
                    <Label
                      htmlFor="signatoryDesignation"
                      className="text-sm font-medium text-foreground-700"
                    >
                      Designation
                    </Label>
                  </div>
                  <Input
                    id="signatoryDesignation"
                    name="signatoryDesignation"
                    disabled={pending}
                    defaultValue={template?.signatoryDesignation || ""}
                    placeholder="e.g. Sr. Project Manager"
                  />
                </div>
              </div>
            </section>

            <section className="mb-6">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Department Details
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="departmentName">Department Name *</Label>
                  <Input
                    id="departmentName"
                    name="departmentName"
                    required
                    disabled={pending}
                    defaultValue={template?.departmentName || ""}
                    placeholder="e.g. Information Technology Division"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="departmentAddress">Department Address</Label>
                  <Input
                    id="departmentAddress"
                    name="departmentAddress"
                    disabled={pending}
                    defaultValue={template?.departmentAddress || ""}
                    placeholder="e.g. 1302, 13th Floor, Shivalik Shilp..."
                  />
                </div>
              </div>
              <div className="mt-4 space-y-1">
                <Label htmlFor="companyAddress">Company Address</Label>
                <Textarea
                  id="companyAddress"
                  name="companyAddress"
                  rows={2}
                  disabled={pending}
                  defaultValue={template?.companyAddress || companyAddress}
                />
              </div>
            </section>

            <div className="max-w-xl">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Documents
              </h3>
              <FilePicker
                id="companySignStamp"
                name="companySignStamp"
                label="Company Sign + Stamp"
                disabled={pending}
                existingUrl={
                  isEditing ? template?.companySignStampUrl : null
                }
                existingFileName={
                  isEditing ? template?.companySignStampFileName : null
                }
                file={companySignStampFile}
                onFileChange={setCompanySignStampFile}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-background-200/70 bg-white px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-foreground-600 transition-colors hover:text-foreground-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {isEditing ? "Saving..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create Template"
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
