"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
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
  MAX_TEMPLATE_ASSET_BYTES,
  TEMPLATE_ASSET_EXTENSIONS,
  TEMPLATE_ASSET_MIME_TYPES,
} from "@/lib/company/types";
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

function FilePicker({
  id,
  name,
  label,
  disabled,
  hasExisting,
  currentLabel,
  file,
  onFileChange,
  templateId,
  assetType,
}: {
  id: string;
  name: string;
  label: string;
  disabled: boolean;
  hasExisting: boolean;
  currentLabel: string;
  file: File | null;
  onFileChange: (next: File | null) => void;
  templateId?: string;
  assetType: "logo" | "signatory";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const remoteObjectUrlRef = useRef<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [remotePreviewUrl, setRemotePreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (!file) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!hasExisting || !templateId) {
      if (remoteObjectUrlRef.current) {
        URL.revokeObjectURL(remoteObjectUrlRef.current);
        remoteObjectUrlRef.current = null;
      }
      setRemotePreviewUrl(null);
      setPreviewLoading(false);
      setPreviewFailed(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewFailed(false);

    fetch(`/api/templates/${templateId}/assets/${assetType}`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (response.status === 404) {
          throw new Error("not-found");
        }
        if (!response.ok) {
          throw new Error("Unable to load template asset.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        if (remoteObjectUrlRef.current) {
          URL.revokeObjectURL(remoteObjectUrlRef.current);
        }
        const objectUrl = URL.createObjectURL(blob);
        remoteObjectUrlRef.current = objectUrl;
        setRemotePreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewFailed(true);
          setRemotePreviewUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (remoteObjectUrlRef.current) {
        URL.revokeObjectURL(remoteObjectUrlRef.current);
        remoteObjectUrlRef.current = null;
      }
    };
  }, [assetType, hasExisting, templateId]);

  const previewUrl = localPreviewUrl || remotePreviewUrl;

  return (
    <div>
      <Label htmlFor={id} className="mb-1 block">
        {label}
      </Label>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-background-200/70 bg-background-100">
          {previewLoading && !previewUrl ? (
            <Loader2 className="size-4 animate-spin text-foreground-400" />
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="h-full w-full object-contain"
              onError={() => {
                setPreviewFailed(true);
                if (previewUrl === remotePreviewUrl && remoteObjectUrlRef.current) {
                  URL.revokeObjectURL(remoteObjectUrlRef.current);
                  remoteObjectUrlRef.current = null;
                  setRemotePreviewUrl(null);
                }
              }}
            />
          ) : (
            <ImageIcon className="size-5 text-foreground-400" />
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-background-200/70 bg-white px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:pointer-events-none disabled:opacity-50"
        >
          Choose File
        </button>
        <span className="min-w-0 truncate text-xs text-foreground-400">
          {file?.name ||
            (hasExisting
              ? previewFailed
                ? "Unable to load preview"
                : currentLabel
              : "No file chosen")}
        </span>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0] || null;
            if (!next) {
              onFileChange(null);
              return;
            }
            const lower = next.name.toLowerCase();
            const extOk = TEMPLATE_ASSET_EXTENSIONS.some((ext) =>
              lower.endsWith(ext),
            );
            const mime = (next.type || "").toLowerCase();
            const mimeOk =
              !mime ||
              TEMPLATE_ASSET_MIME_TYPES.includes(
                mime as (typeof TEMPLATE_ASSET_MIME_TYPES)[number],
              );
            if (!extOk || !mimeOk) {
              toast.error(`${label} type not allowed. Use PNG, JPG, JPEG, or WEBP.`);
              e.target.value = "";
              onFileChange(null);
              return;
            }
            if (next.size > MAX_TEMPLATE_ASSET_BYTES) {
              toast.error(`${label} exceeds the 5 MB limit.`);
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
  const action =
    mode === "edit"
      ? updateBidProfileTemplateAction
      : createBidProfileTemplateAction;
  const [state, formAction, pending] = useActionState(action, {});
  const [isDefault, setIsDefault] = useState(Boolean(template?.isDefault));
  const [formKey, setFormKey] = useState(0);
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companySignatoryFile, setCompanySignatoryFile] = useState<File | null>(
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
      setCompanyLogoFile(null);
      setCompanySignatoryFile(null);
      setFormKey((k) => k + 1);
    }
  }, [open, template?.id, template?.isDefault]);

  useEffect(() => {
    if (!submissionPendingRef.current) return;

    if (state?.ok) {
      submissionPendingRef.current = false;
      toast.success(isEditing ? "Template updated." : "Template created.");
      onOpenChange(false);
      return;
    }

    if (state?.error) {
      submissionPendingRef.current = false;
      toast.error(state.error);
    }
  }, [state, isEditing, onOpenChange]);

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

            <div>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Documents
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FilePicker
                  id="companyLogo"
                  name="companyLogo"
                  label="Company Logo"
                  currentLabel="Current logo"
                  disabled={pending}
                  hasExisting={Boolean(isEditing && template?.companyLogoUrl)}
                  templateId={isEditing ? template?.id : undefined}
                  assetType="logo"
                  file={companyLogoFile}
                  onFileChange={setCompanyLogoFile}
                />
                <FilePicker
                  id="companySignatory"
                  name="companySignatory"
                  label="Company Signatory"
                  currentLabel="Current signatory"
                  disabled={pending}
                  hasExisting={Boolean(
                    isEditing && template?.companySignatoryUrl,
                  )}
                  templateId={isEditing ? template?.id : undefined}
                  assetType="signatory"
                  file={companySignatoryFile}
                  onFileChange={setCompanySignatoryFile}
                />
              </div>
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
