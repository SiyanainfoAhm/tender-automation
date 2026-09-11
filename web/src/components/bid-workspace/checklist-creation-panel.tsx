"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  categoryLabel,
  completionSourceLabel,
  isFromScratchGeneratable,
  workspaceSectionLabel,
  type RequirementDestinationSection,
} from "@/lib/bid-checklist";
import { promptKeyForChecklistCategory } from "@/lib/bid-ai-prompts";
import { DOCUMENT_STATUS_LABELS } from "@/lib/bid-workspace";
import { cn } from "@/lib/utils";
import { AddRequirementDialog } from "@/components/bid-workspace/add-requirement-dialog";
import { EditAiPromptDialog } from "@/components/bid-workspace/edit-ai-prompt-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  deleteChecklistRequirementAction,
  previewDeleteChecklistRequirementAction,
} from "@/server/actions/bid-workspace";
import type {
  ChecklistItemRow,
  ChecklistProgress,
} from "@/server/repositories/bidChecklistRepository";

type RequirementListPanelProps = {
  tenderId: string;
  title: string;
  subtitle?: string;
  items: ChecklistItemRow[];
  /** All workspace requirements (for duplicate checks / aggregate add). */
  allItems?: ChecklistItemRow[];
  progress: ChecklistProgress;
  readOnly: boolean;
  /** null = Checklist Creation (user must pick section). */
  addSection?: RequirementDestinationSection | null;
  generatingRequirementId?: string | null;
  generationPhase?: string | null;
  togglingItemId?: string | null;
  emptyMessage?: string;
  onUpload?: (item: ChecklistItemRow, file: File) => void | Promise<void>;
  onGenerateAi?: (
    item: ChecklistItemRow,
    options?: { customInstructions?: string },
  ) => void | Promise<void>;
  onToggleComplete?: (item: ChecklistItemRow, completed: boolean) => void;
  onRequirementsChanged?: () => void;
};

function statusLine(item: ChecklistItemRow): string {
  if (item.isCompleted) {
    return completionSourceLabel(item.completionSource);
  }
  if (item.completionStatus === "DRAFT_AVAILABLE") return "Draft available";
  if (item.completionStatus === "PENDING_DOCUMENT") return "Document linked";
  if (item.completionStatus === "ACTION_REQUIRED") return "Action required";
  return "Pending";
}

function formatCreatedAt(value: string | null): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return null;
  }
}

export function RequirementListPanel({
  tenderId,
  title,
  subtitle,
  items,
  allItems,
  progress,
  readOnly,
  addSection = null,
  generatingRequirementId = null,
  generationPhase = null,
  togglingItemId = null,
  emptyMessage = "No requirements in this section yet. Checklist extraction runs automatically when you open Bid Workspace for a Will Bid tender.",
  onUpload,
  onGenerateAi,
  onToggleComplete,
  onRequirementsChanged,
}: RequirementListPanelProps) {
  const catalog = allItems || items;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatePromptOpen, setGeneratePromptOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<"create" | "regenerate">(
    "create",
  );
  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLinkedCount, setDeleteLinkedCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );
  const generating =
    Boolean(selectedId) && selectedId === generatingRequirementId;
  const selectedFromScratch = selected
    ? isFromScratchGeneratable({
        requirementKey: selected.requirementKey,
        requirementName: selected.requirementName,
        generationAllowed: selected.generationAllowed,
      })
    : false;
  const canGenerate =
    selectedFromScratch || selected?.generationAllowed === true;
  const generatePromptKey = selected
    ? promptKeyForChecklistCategory(selected.category)
    : "TECHNICAL_DOCUMENT";
  const hasLinkedDocs = (selected?.documents.length || 0) > 0;
  const isManual = selected?.requirementOrigin === "MANUAL";

  function openGeneratePrompt(mode: "create" | "regenerate") {
    if (!selected || !onGenerateAi || readOnly) return;
    setGenerateMode(mode);
    setGeneratePromptOpen(true);
  }

  async function openDeleteConfirm() {
    if (!selected || !isManual || readOnly) return;
    const preview = await previewDeleteChecklistRequirementAction({
      tenderId,
      itemId: selected.id,
    });
    if (!preview.ok) {
      toast.error(preview.error);
      return;
    }
    setDeleteLinkedCount(preview.linkedDocumentCount);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!selected) return;
    setDeleting(true);
    try {
      const result = await deleteChecklistRequirementAction({
        tenderId,
        itemId: selected.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.linkedDocumentCount > 0
          ? "Requirement removed. Linked documents remain in the workspace library."
          : "Requirement removed.",
      );
      setDeleteOpen(false);
      setSelectedId(null);
      onRequirementsChanged?.();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
            {title}
          </h2>
          <p className="text-sm text-foreground-500">
            {subtitle ||
              `${progress.completed} of ${progress.total} requirements completed`}
          </p>
          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-emerald-50">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-medium text-foreground-700">
            {progress.completed} of {progress.total} ready
          </p>
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 text-foreground-700"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" />
            Add Requirement
          </Button>
        ) : null}
      </div>

      <div className="max-h-[min(62vh,640px)] overflow-y-auto rounded-lg border border-border bg-background-50/40 p-3">
        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-foreground-500">
            {emptyMessage}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {items.map((item) => {
              const complete = item.isCompleted;
              const draft = item.completionStatus === "DRAFT_AVAILABLE";
              const expired =
                item.completionStatus === "EXPIRED_DOCUMENT" ||
                item.completionStatus === "INVALID_DOCUMENT";
              const primaryDoc = item.documents[0] || null;
              const manual = item.requirementOrigin === "MANUAL";
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex min-h-[72px] w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                    complete &&
                      "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50",
                    draft &&
                      "border-amber-200 bg-amber-50/70 hover:bg-amber-50",
                    expired &&
                      "border-rose-200 bg-rose-50/70 hover:bg-rose-50",
                    !complete &&
                      !draft &&
                      !expired &&
                      "border-border bg-white hover:bg-background-50",
                  )}
                  onClick={() => {
                    setSelectedId(item.id);
                    setGeneratePromptOpen(false);
                  }}
                >
                  {complete ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <FileText className="mt-0.5 size-4 shrink-0 text-foreground-300" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm font-medium text-foreground-900",
                        complete && "text-foreground-600 line-through",
                      )}
                    >
                      {item.requirementName}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-500">
                      <span>
                        {categoryLabel(item.category)}
                        {manual ? " · Manually Added" : ""}
                        {complete ? " · Completed" : ""}
                        {!complete ? ` · ${statusLine(item)}` : ""}
                      </span>
                      {item.sourceClause ? (
                        <span className="text-foreground-400">
                          {item.sourceClause}
                        </span>
                      ) : null}
                      {primaryDoc?.downloadHref ? (
                        <a
                          className="font-medium text-emerald-700 hover:underline"
                          href={primaryDoc.downloadHref}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View Document
                        </a>
                      ) : null}
                    </span>
                    {item.documents.length > 1 ? (
                      <span className="mt-1 block text-[11px] text-foreground-400">
                        {item.documents.length} linked documents
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !selected || !onUpload) return;
          setUploading(true);
          try {
            await onUpload(selected, file);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Upload failed.",
            );
          } finally {
            setUploading(false);
          }
        }}
      />

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setGeneratePromptOpen(false);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <div className="flex items-start justify-between gap-2 pr-6">
                  <SheetTitle
                    className={cn(
                      "text-left text-base",
                      selected.isCompleted && "text-foreground-600 line-through",
                    )}
                  >
                    {selected.requirementName}
                  </SheetTitle>
                  {!readOnly && isManual ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          aria-label="Requirement actions"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditOpen(true)}>
                          Edit Requirement
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-rose-700 focus:text-rose-700"
                          onClick={() => void openDeleteConfirm()}
                        >
                          Delete Requirement
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <SheetDescription className="text-left">
                  {categoryLabel(selected.category)}
                  {isManual ? " · Manually Added" : ""}
                  {selected.mandatory ? " · Required" : " · Optional"}
                  {selected.sourcePage
                    ? ` · RFP Page ${selected.sourcePage}`
                    : ""}
                  {selected.sourceClause
                    ? ` · ${selected.sourceClause}`
                    : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">
                    Status
                  </p>
                  <p className="mt-1 text-foreground-800">
                    {selected.isCompleted ? "Completed" : "Pending"}
                  </p>
                  <p className="mt-1 text-xs text-foreground-500">
                    {statusLine(selected)}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">
                    Source
                  </p>
                  {isManual ? (
                    <p className="mt-1 text-xs text-foreground-600">
                      Added manually
                      {selected.createdByName
                        ? ` by ${selected.createdByName}`
                        : ""}
                      {formatCreatedAt(selected.createdAt)
                        ? ` · ${formatCreatedAt(selected.createdAt)}`
                        : ""}
                      {selected.aiDetected
                        ? " · AI also detected this requirement"
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-foreground-600">
                      Detected by AI
                      {selected.sourceClause
                        ? ` · ${selected.sourceClause}`
                        : selected.sourcePage
                          ? ` · RFP Page ${selected.sourcePage}`
                          : ""}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-foreground-400">
                    Section: {workspaceSectionLabel(selected.workspaceSection)}
                  </p>
                </div>

                {selected.description ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">
                      Details
                    </p>
                    <p className="mt-1 text-foreground-700">
                      {selected.description}
                    </p>
                  </div>
                ) : null}

                {selected.documents.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">
                      Documents
                    </p>
                    {selected.documents.map((doc) => (
                      <div
                        key={`${doc.source}:${doc.id}`}
                        className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3"
                      >
                        <p className="font-medium text-foreground-900">
                          {doc.fileName || doc.title}
                        </p>
                        <p className="mt-0.5 text-xs text-foreground-500">
                          {doc.source === "COMPANY"
                            ? "Company document"
                            : doc.matchedBy === "AI"
                              ? "Generated with AI"
                              : "Uploaded document"}
                          {" · "}
                          {doc.status === "drafting"
                            ? "Draft"
                            : DOCUMENT_STATUS_LABELS[
                                doc.status as keyof typeof DOCUMENT_STATUS_LABELS
                              ] || doc.status}
                          {doc.versionLabel ? ` · ${doc.versionLabel}` : ""}
                        </p>
                        {doc.downloadHref ? (
                          <a
                            className="mt-2 inline-flex text-xs font-medium text-emerald-700 hover:underline"
                            href={doc.downloadHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View / Download
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border p-3 text-foreground-600">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 size-4 shrink-0 text-foreground-400" />
                      <div>
                        <p>
                          {canGenerate
                            ? "No tender draft yet — generate this document from scratch for this RFP."
                            : "No matching document found."}
                        </p>
                        {canGenerate ? (
                          <p className="mt-1 text-xs text-foreground-500">
                            This is a tender-specific response. AI will draft it
                            from the RFP and your company profile.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-foreground-500">
                            Upload the required certificate or evidence, or mark
                            complete manually if already handled offline.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {generating ? (
                  <div className="rounded-md border border-border bg-background-50 p-3">
                    <div className="flex items-center gap-2 font-medium text-foreground-800">
                      <Loader2 className="size-4 animate-spin" />
                      Generating document…
                    </div>
                    <p className="mt-1 text-xs text-foreground-500">
                      {generationPhase ||
                        "Reading tender requirement · Preparing RFP context · Generating draft · Saving document"}
                    </p>
                  </div>
                ) : null}

                {!readOnly ? (
                  <div className="flex flex-col gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="justify-start gap-2"
                      disabled={
                        generating ||
                        togglingItemId === selected.id ||
                        !onToggleComplete
                      }
                      onClick={() =>
                        onToggleComplete?.(selected, !selected.isCompleted)
                      }
                    >
                      {selected.isCompleted
                        ? "Mark as Pending / Reopen"
                        : "Mark as Complete"}
                    </Button>
                    {canGenerate && !hasLinkedDocs ? (
                      <Button
                        type="button"
                        className="justify-start gap-2"
                        disabled={generating || !onGenerateAi}
                        onClick={() => openGeneratePrompt("create")}
                      >
                        {generating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                        Generate with AI
                      </Button>
                    ) : null}
                    {canGenerate && hasLinkedDocs ? (
                      <Button
                        type="button"
                        className="justify-start gap-2"
                        disabled={generating || !onGenerateAi}
                        onClick={() => openGeneratePrompt("regenerate")}
                      >
                        <RefreshCw className="size-4" />
                        Regenerate
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="justify-start gap-2"
                      variant="outline"
                      disabled={generating || uploading || !onUpload}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      {hasLinkedDocs
                        ? "Upload Replacement"
                        : "Upload Document"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start gap-2 text-foreground-500"
                      disabled={generating}
                      onClick={() => setSelectedId(null)}
                    >
                      <X className="size-4" />
                      Close
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {selected && onGenerateAi ? (
        <EditAiPromptDialog
          open={generatePromptOpen}
          onOpenChange={setGeneratePromptOpen}
          tenderId={tenderId}
          promptKey={generatePromptKey}
          readOnly={readOnly}
          dialogTitle={
            generateMode === "regenerate"
              ? "Edit Prompt & Regenerate"
              : "Edit Prompt & Generate"
          }
          contextLabel={selected.requirementName}
          useAiLabel="Generate with AI"
          showExtraInstructions
          extraInstructionsPlaceholder="Optional notes for this document only (e.g. emphasize onsite CV format)"
          onSaveAndUseAi={async (options) => {
            await onGenerateAi(selected, {
              customInstructions: options?.extraInstructions,
            });
          }}
        />
      ) : null}

      <AddRequirementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenderId={tenderId}
        existingItems={catalog}
        defaultSection={addSection}
        onSuccess={() => onRequirementsChanged?.()}
        onFocusExisting={(itemId) => {
          setSelectedId(itemId);
          setAddOpen(false);
        }}
      />

      {selected && isManual ? (
        <AddRequirementDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          tenderId={tenderId}
          existingItems={catalog}
          defaultSection={selected.workspaceSection}
          mode="edit"
          editItem={selected}
          onSuccess={() => onRequirementsChanged?.()}
        />
      ) : null}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete requirement?</DialogTitle>
            <DialogDescription>
              {deleteLinkedCount > 0
                ? `This requirement has ${deleteLinkedCount} linked document${deleteLinkedCount === 1 ? "" : "s"}. Deleting removes the requirement but keeps documents in the workspace library.`
                : "This permanently removes the manually added requirement from the workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              {deleteLinkedCount > 0
                ? "Delete requirement, keep documents"
                : "Delete Requirement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** @deprecated Prefer RequirementListPanel — kept for import compatibility. */
export function ChecklistCreationPanel(
  props: Omit<RequirementListPanelProps, "title"> & { title?: string },
) {
  return (
    <RequirementListPanel
      {...props}
      title={props.title || "Checklist Creation"}
    />
  );
}
