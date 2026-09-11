"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  FileText,
  Loader2,
  RefreshCw,
  Square,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import {
  categoryLabel,
  isChecklistItemComplete,
  isFromScratchGeneratable,
} from "@/lib/bid-checklist";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

type ChecklistCreationPanelProps = {
  items: ChecklistItemRow[];
  progress: ChecklistProgress;
  readOnly: boolean;
  ingesting?: boolean;
  generatingRequirementId?: string | null;
  generationPhase?: string | null;
  onIngestAi?: () => void;
  onUpload?: (item: ChecklistItemRow) => void;
  onGenerateAi?: (
    item: ChecklistItemRow,
    options?: { customInstructions?: string },
  ) => void;
};

export function ChecklistCreationPanel({
  items,
  progress,
  readOnly,
  ingesting = false,
  generatingRequirementId = null,
  generationPhase = null,
  onIngestAi,
  onUpload,
  onGenerateAi,
}: ChecklistCreationPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenInstructions, setRegenInstructions] = useState("");
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
  const canGenerate = selectedFromScratch || selected?.generationAllowed === true;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
            Checklist Creation
          </h2>
          <p className="mt-1 text-sm text-foreground-500">
            {progress.completed} of {progress.total} items completed
          </p>
          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-emerald-50">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
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
            No checklist requirements yet. Run Use AI to ingest the tender
            document package (ZIP/RFP/BOQ) into checklist items.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {items.map((item) => {
              const complete = isChecklistItemComplete(item.completionStatus);
              const draft = item.completionStatus === "DRAFT_AVAILABLE";
              const expired =
                item.completionStatus === "EXPIRED_DOCUMENT" ||
                item.completionStatus === "INVALID_DOCUMENT";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setRegenOpen(false);
                    setRegenInstructions("");
                  }}
                  className={cn(
                    "flex min-h-[64px] items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
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
                >
                  {complete ? (
                    <CheckSquare className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Square className="mt-0.5 size-4 shrink-0 text-foreground-300" />
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-sm font-medium text-foreground-900",
                        complete && "text-foreground-600 line-through",
                      )}
                    >
                      {item.requirementName}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-foreground-500">
                      {categoryLabel(item.category)}
                      {draft
                        ? " · Draft available"
                        : item.matchedDocumentSource === "COMPANY"
                          ? " · Company Document"
                          : item.matchedDocumentSource === "TENDER"
                            ? " · Tender Document"
                            : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setRegenOpen(false);
            setRegenInstructions("");
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8 text-left text-base">
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
                    {selected.completionStatus === "DRAFT_AVAILABLE"
                      ? "Draft available"
                      : selected.completionStatus.replace(/_/g, " ")}
                  </p>
                  {selected.matchReason &&
                  !selected.matchReason.includes("meta=") ? (
                    <p className="mt-1 text-xs text-foreground-500">
                      {selected.matchReason}
                    </p>
                  ) : selected.matchedBy === "AI" ? (
                    <p className="mt-1 text-xs text-foreground-500">
                      Generated by AI
                    </p>
                  ) : null}
                </div>

                {selected.matchedCompanyDocument ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      Matched Document
                    </p>
                    <p className="mt-1 font-medium text-foreground-900">
                      {selected.matchedCompanyDocument.originalFileName ||
                        selected.matchedCompanyDocument.name}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground-500">
                      Source: Company Library ·{" "}
                      {selected.matchedCompanyDocument.verificationStatus}
                    </p>
                    <a
                      className="mt-2 inline-flex text-xs font-medium text-emerald-700 hover:underline"
                      href={`/api/documents/${selected.matchedCompanyDocument.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Document
                    </a>
                  </div>
                ) : null}

                {selected.matchedWorkspaceDocument ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                      {selected.matchedBy === "AI" ||
                      selected.completionStatus === "DRAFT_AVAILABLE"
                        ? "Generated Document"
                        : "Matched Document"}
                    </p>
                    <p className="mt-1 font-medium text-foreground-900">
                      {selected.matchedWorkspaceDocument.fileName ||
                        selected.matchedWorkspaceDocument.title}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground-500">
                      Status:{" "}
                      {selected.matchedWorkspaceDocument.status === "drafting"
                        ? "Draft"
                        : selected.matchedWorkspaceDocument.status}
                      {selected.matchedBy === "AI" ? " · Generated by AI" : ""}
                    </p>
                    <a
                      className="mt-2 inline-flex text-xs font-medium text-amber-900 hover:underline"
                      href={`/api/bid-workspace/documents/${selected.matchedWorkspaceDocument.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View / Download
                    </a>
                  </div>
                ) : null}

                {!selected.matchedCompanyDocument &&
                !selected.matchedWorkspaceDocument ? (
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
                            This is a tender-specific response (not a reusable
                            company certificate). AI will draft it from the RFP
                            and your company profile.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-foreground-500">
                            Upload the required certificate or evidence from
                            your files / company library.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {generating ? (
                  <div className="rounded-md border border-border bg-background-50 p-3">
                    <div className="flex items-center gap-2 font-medium text-foreground-800">
                      <Loader2 className="size-4 animate-spin" />
                      Generating document…
                    </div>
                    <p className="mt-1 text-xs text-foreground-500">
                      {generationPhase ||
                        "Reading tender requirement · Preparing RFP context · Applying company information · Generating draft · Saving document"}
                    </p>
                  </div>
                ) : null}

                {regenOpen && canGenerate ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium text-foreground-700">
                      Optional regeneration instructions
                    </p>
                    <Textarea
                      value={regenInstructions}
                      onChange={(e) => setRegenInstructions(e.target.value)}
                      placeholder="e.g. Make implementation plan more detailed"
                      rows={3}
                      disabled={generating}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={generating || !onGenerateAi}
                        onClick={() => {
                          onGenerateAi?.(selected, {
                            customInstructions: regenInstructions.trim() || undefined,
                          });
                          setRegenOpen(false);
                        }}
                      >
                        Regenerate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={generating}
                        onClick={() => setRegenOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!readOnly ? (
                  <div className="flex flex-col gap-2 pt-2">
                    {canGenerate && !selected.matchedWorkspaceDocument ? (
                      <Button
                        type="button"
                        className="justify-start gap-2"
                        disabled={generating || !onGenerateAi}
                        onClick={() => onGenerateAi?.(selected)}
                      >
                        {generating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                        Generate with AI
                      </Button>
                    ) : null}
                    {canGenerate &&
                    selected.matchedWorkspaceDocument &&
                    !regenOpen ? (
                      <Button
                        type="button"
                        className="justify-start gap-2"
                        disabled={generating || !onGenerateAi}
                        onClick={() => setRegenOpen(true)}
                      >
                        <RefreshCw className="size-4" />
                        Regenerate
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="justify-start gap-2"
                      variant="outline"
                      disabled={generating}
                      onClick={() => onUpload?.(selected)}
                    >
                      <Upload className="size-4" />
                      {selected.matchedWorkspaceDocument
                        ? "Upload Replacement"
                        : canGenerate
                          ? "Upload existing instead"
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
    </div>
  );
}
