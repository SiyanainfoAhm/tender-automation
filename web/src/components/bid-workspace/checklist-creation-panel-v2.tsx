"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AddRequirementDialog } from "@/components/bid-workspace/add-requirement-dialog";
import { CompanyDocumentPickerDialog } from "@/components/bid-workspace/company-document-picker-dialog";
import { Button } from "@/components/ui/button";
import { ChecklistItemAiChat } from "@/components/bid-workspace/checklist-item-ai-chat";
import { checklistWorkCategory, WORK_CATEGORIES } from "@/lib/will-bid";
import type { RequirementDestinationSection } from "@/lib/bid-checklist";
import type { DocumentCategory } from "@/lib/company/types";
import {
  changeChecklistWorkCategoryAction,
  type ChecklistWorkCategory,
} from "@/server/actions/checklist-work-category";
import { deleteChecklistRequirementAction } from "@/server/actions/bid-workspace";
import type {
  ChecklistItemRow,
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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

  async function removeLinkedDocument(item: ChecklistItemRow) {
    if (!onUnlinkDocument || readOnly) return;
    if (!window.confirm("Remove the linked document from this checklist item? The requirement itself will stay.")) return;
    await onUnlinkDocument(item, {
      deleteWorkspaceFiles: false,
      deleteCompanyDocument: false,
    });
  }

  async function deleteRequirement(item: ChecklistItemRow) {
    if (readOnly) return;
    if (!window.confirm("Delete this checklist requirement? Linked documents will remain in the library.")) return;
    setDeletingId(item.id);
    try {
      const result = await deleteChecklistRequirementAction({
        tenderId,
        itemId: item.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Requirement deleted.");
      onRequirementsChanged?.();
    } finally {
      setDeletingId(null);
    }
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
            const linked = item.documents.length > 0;
            const primaryDoc = item.documents[0] || null;
            const busy = movingId === item.id || generatingRequirementId === item.id || deletingId === item.id;

            return (
              <div key={item.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_190px_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    {item.isCompleted ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <FileText className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{item.requirementName}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                        {item.description || item.sourceText || "No additional details available."}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>{item.isCompleted ? "Completed" : "Pending"}</span>
                        {primaryDoc?.downloadHref ? (
                          <a
                            href={primaryDoc.downloadHref}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-emerald-700 hover:underline"
                          >
                            View document
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Current category
                  </label>
                  <select
                    value={currentCategory}
                    disabled={readOnly || busy}
                    onChange={(event) => void moveCategory(item, event.target.value as ChecklistWorkCategory)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-400 disabled:opacity-60"
                  >
                    <option value="company">Company Docs</option>
                    <option value="ai">AI Draft</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                {!readOnly ? (
                  <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                    <ChecklistItemAiChat tenderId={tenderId} item={item} disabled={busy} onSaved={onRequirementsChanged} />
                    {currentCategory === "company" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || !onLinkCompanyDocument}
                        onClick={() => {
                          setActionItem(item);
                          setPickerOpen(true);
                        }}
                      >
                        Select doc
                      </Button>
                    ) : null}

                    {currentCategory === "ai" ? (
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
                        {linked ? "Regenerate" : "Generate"}
                      </Button>
                    ) : null}

                    {currentCategory === "manual" ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || !onUpload}
                          onClick={() => startUpload(item)}
                        >
                          <Upload className="size-3.5" />
                          {linked ? "Replace" : "Upload"}
                        </Button>
                        {!item.isCompleted && onToggleComplete ? (
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
                      </>
                    ) : null}

                    {linked ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-amber-700"
                        disabled={busy || !onUnlinkDocument}
                        onClick={() => void removeLinkedDocument(item)}
                      >
                        Remove
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-700"
                      disabled={busy}
                      onClick={() => void deleteRequirement(item)}
                    >
                      {deletingId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Delete
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
          void onUpload(actionItem, file);
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
          selectedId={actionItem.documents.find((doc) => doc.source === "COMPANY")?.id || null}
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
