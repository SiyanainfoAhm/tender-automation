"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
  Paperclip,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AddRequirementDialog } from "@/components/bid-workspace/add-requirement-dialog";
import { CompanyDocumentPickerDialog } from "@/components/bid-workspace/company-document-picker-dialog";
import {
  ChecklistDocumentPreviewDialog,
  preloadChecklistDocument,
  type PreviewDocument,
} from "@/components/bid-workspace/checklist-document-preview-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChecklistItemAiChat } from "@/components/bid-workspace/checklist-item-ai-chat";
import { checklistWorkCategory, WORK_CATEGORIES } from "@/lib/will-bid";
import {
  isManualOnlyRequirement,
  type RequirementDestinationSection,
} from "@/lib/bid-checklist";
import type { DocumentCategory } from "@/lib/company/types";
import { cn } from "@/lib/utils";
import {
  changeChecklistWorkCategoryAction,
  type ChecklistWorkCategory,
} from "@/server/actions/checklist-work-category";
import { deleteChecklistRequirementAction } from "@/server/actions/bid-workspace";
import type {
  ChecklistItemRow,
  ChecklistLinkedDocument,
  ChecklistProgress,
} from "@/server/repositories/bidChecklistRepository";
import type { CompanyDocument } from "@/server/repositories/documentRepository";

type UploadOptions = {
  saveAsCompanyDocument?: boolean;
  companyDocument?: {
    name: string;
    category: DocumentCategory;
    certificateType?: string;
    issuingAuthority?: string;
    issueDate?: string;
    expiryDate?: string;
    financialYear?: string;
    documentType?: string;
  };
};

type UnlinkOptions = {
  deleteWorkspaceFiles?: boolean;
  deleteCompanyDocument?: boolean;
  deleteChecklistItem?: boolean;
};

type RequirementListPanelProps = {
  tenderId: string;
  title: string;
  subtitle?: string;
  items: ChecklistItemRow[];
  allItems?: ChecklistItemRow[];
  companyDocuments?: CompanyDocument[];
  progress: ChecklistProgress;
  readOnly: boolean;
  addSection?: RequirementDestinationSection | null;
  generatingRequirementId?: string | null;
  generationPhase?: string | null;
  togglingItemId?: string | null;
  emptyMessage?: string;
  onUpload?: (
    item: ChecklistItemRow,
    file: File,
    options?: UploadOptions,
  ) => void | Promise<void>;
  onLinkCompanyDocument?: (
    item: ChecklistItemRow,
    companyDocumentId: string,
  ) => void | Promise<void>;
  onUnlinkDocument?: (
    item: ChecklistItemRow,
    options?: UnlinkOptions,
  ) => void | Promise<void>;
  onGenerateAi?: (
    item: ChecklistItemRow,
    options?: { customInstructions?: string },
  ) => void | Promise<void>;
  onToggleComplete?: (item: ChecklistItemRow, completed: boolean) => void;
  onRequirementsChanged?: () => void;
};

/** Company library document behind an item: a direct link, or the source of a signed copy. */
function selectedCompanyDocumentId(item: ChecklistItemRow): string | null {
  const direct = item.documents.find((doc) => doc.source === "COMPANY")?.id;
  if (direct) return direct;
  if (item.matchedCompanyDocumentId) return item.matchedCompanyDocumentId;
  for (const doc of item.documents) {
    const match = doc.versionLabel?.match(/company document ([0-9a-f-]{36})/i);
    if (match) return match[1] ?? null;
  }
  return null;
}

function attachedBy(doc: ChecklistLinkedDocument, item: ChecklistItemRow): string {
  const by = doc.matchedBy || item.matchedBy;
  if (by === "USER") return "selected by you";
  if (by === "AI" && doc.source === "TENDER" && item.processingType === "AI_DRAFT")
    return "AI draft";
  if (by === "AI" || by === "SYSTEM") return "auto-selected by AI";
  return "attached";
}

function documentName(doc: ChecklistLinkedDocument): string {
  return doc.source === "COMPANY"
    ? doc.title || doc.fileName || "Document"
    : doc.fileName || doc.title || "Document";
}

export function RequirementListPanel({
  tenderId,
  title,
  subtitle,
  items,
  allItems,
  companyDocuments = [],
  progress,
  readOnly,
  addSection = null,
  generatingRequirementId = null,
  togglingItemId = null,
  emptyMessage = "No requirements in this category.",
  onUpload,
  onLinkCompanyDocument,
  onUnlinkDocument,
  onGenerateAi,
  onToggleComplete,
  onRequirementsChanged,
}: RequirementListPanelProps) {
  const [movingId, setMovingId] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<ChecklistItemRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [removeItem, setRemoveItem] = useState<ChecklistItemRow | null>(null);
  const [removing, setRemoving] = useState<"document" | "requirement" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function moveCategory(item: ChecklistItemRow, category: ChecklistWorkCategory) {
    if (readOnly || movingId) return;
    if (checklistWorkCategory(item) === category) return;
    setMovingId(item.id);
    try {
      const result = await changeChecklistWorkCategoryAction({
        tenderId,
        itemId: item.id,
        category,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved to ${WORK_CATEGORIES.find((entry) => entry.key === category)?.label || category}.`);
      onRequirementsChanged?.();
    } finally {
      setMovingId(null);
    }
  }

  function startUpload(item: ChecklistItemRow) {
    if (readOnly || !onUpload) return;
    setActionItem(item);
    fileInputRef.current?.click();
  }

  function openPicker(item: ChecklistItemRow) {
    if (readOnly || !onLinkCompanyDocument) return;
    setActionItem(item);
    setPickerOpen(true);
  }

  async function removeLinkedDocument(item: ChecklistItemRow) {
    if (!onUnlinkDocument || readOnly) return;
    setRemoving("document");
    try {
      await onUnlinkDocument(item, {
        deleteWorkspaceFiles: false,
        deleteCompanyDocument: false,
      });
      setRemoveItem(null);
    } finally {
      setRemoving(null);
    }
  }

  async function deleteRequirement(item: ChecklistItemRow) {
    if (readOnly) return;
    setRemoving("requirement");
    try {
      const result = await deleteChecklistRequirementAction({
        tenderId,
        itemId: item.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Requirement deleted. Its documents stay in the library.");
      setRemoveItem(null);
      onRequirementsChanged?.();
    } finally {
      setRemoving(null);
    }
  }

  function openPreview(item: ChecklistItemRow, doc: ChecklistLinkedDocument) {
    if (!doc.downloadHref) return;
    setPreview({
      title: documentName(doc),
      fileName: doc.fileName || doc.title,
      href: doc.downloadHref,
      requirementName: item.requirementName,
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {progress.completed}/{progress.total}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            Add Requirement
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => {
            const currentCategory = checklistWorkCategory(item) as ChecklistWorkCategory;
            const manualOnly = isManualOnlyRequirement(item.requirementName);
            const linked = item.documents.length > 0;
            const finished = item.isCompleted || linked;
            const primaryDoc = item.documents[0] || null;
            const busy =
              movingId === item.id ||
              generatingRequirementId === item.id ||
              uploadingId === item.id ||
              (removing !== null && removeItem?.id === item.id);

            return (
              <div
                key={item.id}
                className={cn(
                  "grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_190px_auto] lg:items-center",
                  finished && "bg-emerald-50/40",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    {finished ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-label="Finished"
                      />
                    ) : (
                      <FileText className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium text-slate-900",
                          finished && "text-slate-500 line-through decoration-emerald-600 decoration-2",
                        )}
                      >
                        {item.requirementName}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                        {item.description || item.sourceText || "No additional details available."}
                      </p>
                      {primaryDoc ? (
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                            <Paperclip className="size-3 shrink-0" />
                            <span className="truncate" title={documentName(primaryDoc)}>
                              {documentName(primaryDoc)}
                            </span>
                          </span>
                          <span className="text-slate-400">{attachedBy(primaryDoc, item)}</span>
                          {primaryDoc.downloadHref ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                              onPointerEnter={() => preloadChecklistDocument(primaryDoc.downloadHref)}
                              onClick={() => openPreview(item, primaryDoc)}
                            >
                              <Eye className="size-3" />
                              View document
                            </button>
                          ) : null}
                          {item.documents.length > 1 ? (
                            <span className="text-slate-400">
                              +{item.documents.length - 1} older version
                              {item.documents.length > 2 ? "s" : ""}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Current category
                  </label>
                  <select
                    value={currentCategory}
                    disabled={readOnly || busy || manualOnly}
                    title={
                      manualOnly
                        ? "Fees, EMD and BOQ / financial bid items are always handled manually."
                        : undefined
                    }
                    onChange={(event) => void moveCategory(item, event.target.value as ChecklistWorkCategory)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-400 disabled:opacity-60"
                  >
                    <option value="company">Company Docs</option>
                    <option value="ai">AI Draft</option>
                    <option value="manual">Manual</option>
                  </select>
                  {manualOnly ? (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                      <Lock className="size-3" />
                      Manual only
                    </p>
                  ) : null}
                </div>

                {!readOnly ? (
                  <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                    <ChecklistItemAiChat tenderId={tenderId} item={item} disabled={busy} onSaved={onRequirementsChanged} />

                    {currentCategory === "ai" && !linked ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !onGenerateAi}
                        onClick={() => onGenerateAi?.(item)}
                      >
                        {generatingRequirementId === item.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        Generate
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !onLinkCompanyDocument}
                      onClick={() => openPicker(item)}
                    >
                      <FolderOpen className="size-3.5" />
                      {selectedCompanyDocumentId(item) ? "Change doc" : "Select doc"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !onUpload}
                      onClick={() => startUpload(item)}
                    >
                      {uploadingId === item.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Upload className="size-3.5" />
                      )}
                      {linked ? "Replace" : "Upload"}
                    </Button>

                    {currentCategory === "manual" && !finished && onToggleComplete ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={togglingItemId === item.id}
                        onClick={() => onToggleComplete(item, true)}
                      >
                        Mark done
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-700"
                      disabled={busy}
                      onClick={() => setRemoveItem(item)}
                    >
                      {removing !== null && removeItem?.id === item.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || !actionItem || !onUpload) return;
          const target = actionItem;
          setUploadingId(target.id);
          void Promise.resolve(onUpload(target, file))
            .catch((reason) =>
              toast.error(reason instanceof Error ? reason.message : "Upload failed."),
            )
            .finally(() => setUploadingId(null));
        }}
      />

      {actionItem && onLinkCompanyDocument ? (
        <CompanyDocumentPickerDialog
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open);
            if (!open) setActionItem(null);
          }}
          documents={companyDocuments}
          selectedId={selectedCompanyDocumentId(actionItem)}
          busy={linking}
          onSelect={async (companyDocumentId) => {
            setLinking(true);
            try {
              await onLinkCompanyDocument(actionItem, companyDocumentId);
              setPickerOpen(false);
            } finally {
              setLinking(false);
            }
          }}
        />
      ) : null}

      <Dialog
        open={Boolean(removeItem)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveItem(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove</DialogTitle>
            <DialogDescription>
              {removeItem?.documents.length
                ? "Remove only the attached document, or delete this requirement from the checklist. Files always stay in the library."
                : "Delete this requirement from the checklist?"}
            </DialogDescription>
          </DialogHeader>
          {removeItem ? (
            <p className="text-sm font-medium text-slate-800">{removeItem.requirementName}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(removing)}
              onClick={() => setRemoveItem(null)}
            >
              Cancel
            </Button>
            <div className="flex flex-wrap gap-2">
              {removeItem?.documents.length && onUnlinkDocument ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(removing)}
                  onClick={() => removeItem && void removeLinkedDocument(removeItem)}
                >
                  {removing === "document" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Remove document only
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(removing)}
                onClick={() => removeItem && void deleteRequirement(removeItem)}
              >
                {removing === "requirement" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Delete requirement
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChecklistDocumentPreviewDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        document={preview}
      />

      <AddRequirementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenderId={tenderId}
        existingItems={allItems || items}
        defaultSection={addSection}
        onSuccess={() => onRequirementsChanged?.()}
      />
    </section>
  );
}

export function ChecklistCreationPanel(
  props: Omit<RequirementListPanelProps, "title"> & { title?: string },
) {
  return <RequirementListPanel {...props} title={props.title || "Checklist Creation"} />;
}
