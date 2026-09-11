"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
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
} from "@/lib/bid-checklist";
import { promptKeyForChecklistCategory } from "@/lib/bid-ai-prompts";
import { DOCUMENT_STATUS_LABELS } from "@/lib/bid-workspace";
import { cn } from "@/lib/utils";
import { EditAiPromptDialog } from "@/components/bid-workspace/edit-ai-prompt-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  ChecklistItemRow,
  ChecklistProgress,
} from "@/server/repositories/bidChecklistRepository";

type RequirementListPanelProps = {
  tenderId: string;
  title: string;
  subtitle?: string;
  items: ChecklistItemRow[];
  progress: ChecklistProgress;
  readOnly: boolean;
  ingesting?: boolean;
  generatingRequirementId?: string | null;
  generationPhase?: string | null;
  togglingItemId?: string | null;
  emptyMessage?: string;
  onIngestAi?: () => void;
  onEditPrompt?: () => void;
  onUpload?: (item: ChecklistItemRow, file: File) => void | Promise<void>;
  onGenerateAi?: (
    item: ChecklistItemRow,
    options?: { customInstructions?: string },
  ) => void | Promise<void>;
  onToggleComplete?: (item: ChecklistItemRow, completed: boolean) => void;
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

export function RequirementListPanel({
  tenderId,
  title,
  subtitle,
  items,
  progress,
  readOnly,
  ingesting = false,
  generatingRequirementId = null,
  generationPhase = null,
  togglingItemId = null,
  emptyMessage = "No requirements in this section yet. Run Use AI to extract submission requirements from the tender documents.",
  onIngestAi,
  onEditPrompt,
  onUpload,
  onGenerateAi,
  onToggleComplete,
}: RequirementListPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatePromptOpen, setGeneratePromptOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<"create" | "regenerate">(
    "create",
  );
  const [uploading, setUploading] = useState(false);
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

  function openGeneratePrompt(mode: "create" | "regenerate") {
    if (!selected || !onGenerateAi || readOnly) return;
    setGenerateMode(mode);
    setGeneratePromptOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-foreground-500">
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly || !onEditPrompt}
            onClick={onEditPrompt}
          >
            Edit Prompt
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={readOnly || ingesting || !onIngestAi}
            onClick={onIngestAi}
          >
            <Sparkles className="size-3.5" />
            {ingesting ? "Ingesting…" : "Use AI"}
          </Button>
        </div>
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
                        {categoryLabel(item.category)} · {statusLine(item)}
                      </span>
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
                <SheetTitle
                  className={cn(
                    "pr-8 text-left text-base",
                    selected.isCompleted && "text-foreground-600 line-through",
                  )}
                >
                  {selected.requirementName}
                </SheetTitle>
                <SheetDescription className="text-left">
                  {categoryLabel(selected.category)}
                  {selected.mandatory ? " · Required" : " · Optional"}
                  {selected.sourcePage
                    ? ` · RFP Page ${selected.sourcePage}`
                    : ""}
                  {selected.sourceClause
                    ? ` · Clause ${selected.sourceClause}`
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
                        : canGenerate
                          ? "Upload Document"
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
