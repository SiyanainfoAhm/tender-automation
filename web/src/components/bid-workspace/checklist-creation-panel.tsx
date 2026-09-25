"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  completionSourceLabel,
  isFromScratchGeneratable,
  type RequirementDestinationSection,
} from "@/lib/bid-checklist";
import { promptKeyForChecklistCategory } from "@/lib/bid-ai-prompts";
import { DOCUMENT_STATUS_LABELS } from "@/lib/bid-workspace";
import { cn } from "@/lib/utils";
import { AddRequirementDialog } from "@/components/bid-workspace/add-requirement-dialog";
import { CompanyDocumentPickerDialog } from "@/components/bid-workspace/company-document-picker-dialog";
import { EditAiPromptDialog } from "@/components/bid-workspace/edit-ai-prompt-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  CERTIFICATE_TYPES,
  DOCUMENT_CATEGORIES,
  FINANCIAL_DOCUMENT_TYPES,
  generateFinancialYears,
  type DocumentCategory,
} from "@/lib/company/types";
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
import { Label } from "@/components/ui/label";
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
  /** Archive/delete the checklist requirement itself (manual items). */
  deleteChecklistItem?: boolean;
};

type RequirementListPanelProps = {
  tenderId: string;
  title: string;
  subtitle?: string;
  items: ChecklistItemRow[];
  /** All workspace requirements (for duplicate checks / aggregate add). */
  allItems?: ChecklistItemRow[];
  /** Shared once for the page — used by every checklist row. */
  companyDocuments?: CompanyDocument[];
  progress: ChecklistProgress;
  readOnly: boolean;
  /** null = Checklist Creation (user must pick section). */
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

function itemHasWorkspaceDocs(item: ChecklistItemRow): boolean {
  return item.documents.some((doc) => doc.source === "TENDER");
}

function itemHasCompanyDocs(item: ChecklistItemRow): boolean {
  return (
    item.matchedDocumentSource === "COMPANY" ||
    item.documents.some((doc) => doc.source === "COMPANY")
  );
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
  generationPhase = null,
  togglingItemId = null,
  emptyMessage = "No requirements in this section yet. Checklist extraction runs automatically when you open Bid Workspace for a Will Bid tender.",
  onUpload,
  onLinkCompanyDocument,
  onUnlinkDocument,
  onGenerateAi,
  onToggleComplete,
  onRequirementsChanged,
}: RequirementListPanelProps) {
  const catalog = allItems || items;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [generatePromptOpen, setGeneratePromptOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<"create" | "regenerate">(
    "create",
  );
  const [uploading, setUploading] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [saveAsCompanyDocument, setSaveAsCompanyDocument] = useState(false);
  const [companyDocumentName, setCompanyDocumentName] = useState("");
  const [companyDocumentCategory, setCompanyDocumentCategory] =
    useState<DocumentCategory>("General");
  const [certificateType, setCertificateType] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [financialYear, setFinancialYear] = useState("");
  const [financialDocumentType, setFinancialDocumentType] = useState("");
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
  const actionItem = useMemo(
    () => items.find((item) => item.id === actionItemId) || null,
    [items, actionItemId],
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
  const busy = uploading || linking || unlinking;

  function openGeneratePrompt(mode: "create" | "regenerate") {
    if (!selected || !onGenerateAi || readOnly) return;
    setGenerateMode(mode);
    setGeneratePromptOpen(true);
  }

  function startSelectCompany(item: ChecklistItemRow) {
    if (readOnly || !onLinkCompanyDocument) return;
    setActionItemId(item.id);
    setPickerOpen(true);
  }

  function startUpload(item: ChecklistItemRow) {
    if (readOnly || !onUpload) return;
    setActionItemId(item.id);
    setSaveAsCompanyDocument(false);
    setCompanyDocumentName(item.requirementName);
    setCompanyDocumentCategory("General");
    setCertificateType("");
    setIssuingAuthority("");
    setIssueDate("");
    setExpiryDate("");
    setFinancialYear("");
    setFinancialDocumentType("");
    setPendingUploadFile(null);
    fileInputRef.current?.click();
  }

  function startUnlink(item: ChecklistItemRow) {
    if (readOnly || !onUnlinkDocument || item.documents.length === 0) return;
    setActionItemId(item.id);
    // Always confirm — workspace and/or company delete is optional.
    setUnlinkConfirmOpen(true);
  }

  async function confirmUnlink(
    item: ChecklistItemRow,
    options?: UnlinkOptions,
  ) {
    if (!onUnlinkDocument) return;
    setUnlinking(true);
    try {
      await onUnlinkDocument(item, options);
      if (options?.deleteChecklistItem) {
        const deleted = await deleteChecklistRequirementAction({
          tenderId,
          itemId: item.id,
        });
        if (!deleted.ok) {
          toast.error(deleted.error);
          return;
        }
        toast.success("Requirement deleted.");
        setSelectedId((id) => (id === item.id ? null : id));
        onRequirementsChanged?.();
      }
      setUnlinkConfirmOpen(false);
      setActionItemId(null);
    } finally {
      setUnlinking(false);
    }
  }

  async function confirmUpload() {
    if (!actionItem || !pendingUploadFile || !onUpload) return;
    if (saveAsCompanyDocument && !companyDocumentName.trim()) {
      toast.error("Enter a document name for Company Documents.");
      return;
    }
    if (
      saveAsCompanyDocument &&
      companyDocumentCategory === "Certificate" &&
      (!certificateType || !issuingAuthority.trim() || !issueDate)
    ) {
      toast.error("Certificate type, issuing authority, and issue date are required.");
      return;
    }
    if (
      saveAsCompanyDocument &&
      companyDocumentCategory === "Financial" &&
      (!financialYear || !financialDocumentType)
    ) {
      toast.error("Financial year and document type are required.");
      return;
    }
    setUploading(true);
    try {
      await onUpload(actionItem, pendingUploadFile, {
        saveAsCompanyDocument,
        companyDocument: saveAsCompanyDocument
          ? {
              name: companyDocumentName.trim(),
              category: companyDocumentCategory,
              certificateType,
              issuingAuthority: issuingAuthority.trim(),
              issueDate,
              expiryDate,
              financialYear,
              documentType: financialDocumentType,
            }
          : undefined,
      });
      setUploadConfirmOpen(false);
      setPendingUploadFile(null);
      setSaveAsCompanyDocument(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function openDeleteConfirm(item?: ChecklistItemRow | null) {
    const target = item || selected;
    if (!target || readOnly) return;
    setActionItemId(target.id);
    setSelectedId(target.id);
    const preview = await previewDeleteChecklistRequirementAction({
      tenderId,
      itemId: target.id,
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
              const itemBusy =
                busy && actionItemId === item.id;
              const itemGenerating = generatingRequirementId === item.id;
              const linked = item.documents.length > 0;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex min-h-[72px] w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
                    complete && "border-emerald-200 bg-emerald-50/80",
                    draft && "border-amber-200 bg-amber-50/70",
                    expired && "border-rose-200 bg-rose-50/70",
                    !complete &&
                      !draft &&
                      !expired &&
                      "border-border bg-white",
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 text-left hover:opacity-90"
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
                          {[
                            manual ? "Manually Added" : null,
                            complete ? "Completed" : statusLine(item),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
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

                  {!readOnly ? (
                    <div
                      className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={
                          itemBusy ||
                          itemGenerating ||
                          !onLinkCompanyDocument
                        }
                        onClick={() => startSelectCompany(item)}
                      >
                        {linking && actionItemId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <FileText className="size-3" />
                        )}
                        Select
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={itemBusy || itemGenerating || !onUpload}
                        onClick={() => startUpload(item)}
                      >
                        {uploading && actionItemId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Upload className="size-3" />
                        )}
                        {linked ? "Replace" : "Upload"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={
                          itemGenerating ||
                          togglingItemId === item.id ||
                          !onToggleComplete
                        }
                        onClick={() =>
                          onToggleComplete?.(item, !item.isCompleted)
                        }
                      >
                        {togglingItemId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : complete ? (
                          <RotateCcw className="size-3" />
                        ) : (
                          <CheckCircle2 className="size-3" />
                        )}
                        {complete ? "Reopen" : "Mark done"}
                      </Button>
                      {linked ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-status-nogo"
                          disabled={
                            itemBusy || itemGenerating || !onUnlinkDocument
                          }
                          onClick={() => startUnlink(item)}
                        >
                          {unlinking && actionItemId === item.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                          Remove
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-rose-700"
                        disabled={itemBusy || itemGenerating || deleting}
                        onClick={() => void openDeleteConfirm(item)}
                      >
                        {deleting && actionItemId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !actionItemId) return;
          setPendingUploadFile(file);
          setSaveAsCompanyDocument(false);
          setUploadConfirmOpen(true);
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
                  {!readOnly ? (
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
                        {isManual ? (
                          <DropdownMenuItem onClick={() => setEditOpen(true)}>
                            Edit Requirement
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-rose-700 focus:text-rose-700"
                          onClick={() => void openDeleteConfirm(selected)}
                        >
                          Delete Requirement
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <SheetDescription className="text-left">
                  {[
                    isManual ? "Manually Added" : null,
                    selected.mandatory ? "Required" : "Optional",
                    selected.sourcePage
                      ? `RFP Page ${selected.sourcePage}`
                      : null,
                    selected.sourceClause || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
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
                          {doc.source === "COMPANY"
                            ? doc.title || doc.fileName
                            : doc.fileName || doc.title}
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
                            ? "No tender draft yet — generate this document from scratch for this RFP, or link a company document."
                            : "No matching document found."}
                        </p>
                        {canGenerate ? (
                          <p className="mt-1 text-xs text-foreground-500">
                            This is a tender-specific response. AI will draft it
                            from the RFP and your company profile.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-foreground-500">
                            Use Select or Upload on the checklist card, or mark
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
                ? `This requirement has ${deleteLinkedCount} linked document${deleteLinkedCount === 1 ? "" : "s"}. Deleting removes the requirement row but keeps documents in the library.`
                : "This permanently deletes the checklist requirement record from the workspace."}
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

      <Dialog
        open={uploadConfirmOpen}
        onOpenChange={(open) => {
          setUploadConfirmOpen(open);
          if (!open) {
            setPendingUploadFile(null);
            setSaveAsCompanyDocument(false);
            setCompanyDocumentName("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription>
              {actionItem
                ? `Attach a file for “${actionItem.requirementName}”.`
                : "Attach a file for this requirement."}
            </DialogDescription>
          </DialogHeader>
          {pendingUploadFile ? (
            <p className="truncate text-sm text-foreground-700">
              File:{" "}
              <span className="font-medium">{pendingUploadFile.name}</span>
            </p>
          ) : null}
          <div className="flex items-start gap-2 rounded-md border border-border bg-background-50/80 p-3">
            <Checkbox
              id="save-as-company-doc"
              checked={saveAsCompanyDocument}
              onCheckedChange={(checked) =>
                setSaveAsCompanyDocument(checked === true)
              }
              disabled={uploading}
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="save-as-company-doc"
                className="cursor-pointer text-sm font-medium text-foreground-900"
              >
                Save as template in Company Documents
              </Label>
              <p className="text-xs text-foreground-500">
                Adds this file to your company library so you can reuse it on
                future tenders. You can remove it from a checklist later without
                deleting the library copy — or choose to delete it when asked.
              </p>
            </div>
          </div>
          {saveAsCompanyDocument ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="company-document-name">Document name *</Label>
                <Input
                  id="company-document-name"
                  value={companyDocumentName}
                  onChange={(event) => setCompanyDocumentName(event.target.value)}
                  disabled={uploading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-document-category">Category *</Label>
                <select
                  id="company-document-category"
                  value={companyDocumentCategory}
                  disabled={uploading}
                  onChange={(event) =>
                    setCompanyDocumentCategory(event.target.value as DocumentCategory)
                  }
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                >
                  {DOCUMENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              {companyDocumentCategory === "Certificate" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="template-certificate-type">Certificate type *</Label>
                    <select
                      id="template-certificate-type"
                      value={certificateType}
                      disabled={uploading}
                      onChange={(event) => setCertificateType(event.target.value)}
                      className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                    >
                      <option value="">Select type</option>
                      {CERTIFICATE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="template-issuing-authority">Issuing authority *</Label>
                    <Input
                      id="template-issuing-authority"
                      value={issuingAuthority}
                      disabled={uploading}
                      onChange={(event) => setIssuingAuthority(event.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="template-issue-date">Issue date *</Label>
                      <Input id="template-issue-date" type="date" value={issueDate} disabled={uploading} onChange={(event) => setIssueDate(event.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="template-expiry-date">Expiry date</Label>
                      <Input id="template-expiry-date" type="date" value={expiryDate} disabled={uploading} onChange={(event) => setExpiryDate(event.target.value)} />
                    </div>
                  </div>
                </>
              ) : null}
              {companyDocumentCategory === "Financial" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="template-financial-year">Financial year *</Label>
                    <select
                      id="template-financial-year"
                      value={financialYear}
                      disabled={uploading}
                      onChange={(event) => setFinancialYear(event.target.value)}
                      className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                    >
                      <option value="">Select financial year</option>
                      {generateFinancialYears(12).map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="template-financial-document-type">Document type *</Label>
                    <select
                      id="template-financial-document-type"
                      value={financialDocumentType}
                      disabled={uploading}
                      onChange={(event) => setFinancialDocumentType(event.target.value)}
                      className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm disabled:opacity-60"
                    >
                      <option value="">Select type</option>
                      {FINANCIAL_DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={uploading}
              onClick={() => setUploadConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={uploading || !pendingUploadFile}
              onClick={() => void confirmUpload()}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : null}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unlinkConfirmOpen}
        onOpenChange={(open) => {
          setUnlinkConfirmOpen(open);
          if (!open) setActionItemId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove document?</DialogTitle>
            <DialogDescription>
              {actionItem && itemHasCompanyDocs(actionItem)
                ? "This requirement links a company document. You can keep the requirement while removing its document, or delete both."
                : actionItem && itemHasWorkspaceDocs(actionItem)
                  ? "This document was uploaded for this tender only. Choose whether to also delete the file or this requirement."
                  : "Remove the linked document from this checklist requirement."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              variant="outline"
              disabled={unlinking || !actionItem}
              className="w-full"
              onClick={() =>
                actionItem &&
                void confirmUnlink(actionItem, {
                  deleteWorkspaceFiles: false,
                  deleteCompanyDocument: false,
                })
              }
            >
              {unlinking ? <Loader2 className="size-4 animate-spin" /> : null}
              Remove from checklist only
            </Button>
            {actionItem && itemHasWorkspaceDocs(actionItem) ? (
              <Button
                type="button"
                variant="destructive"
                disabled={unlinking}
                className="w-full"
                onClick={() =>
                  void confirmUnlink(actionItem, {
                    deleteWorkspaceFiles: true,
                    deleteCompanyDocument: false,
                  })
                }
              >
                {unlinking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Remove and delete uploaded file
              </Button>
            ) : null}
            {actionItem && itemHasCompanyDocs(actionItem) ? (
              <Button
                type="button"
                variant="destructive"
                disabled={unlinking}
                className="w-full"
                onClick={() =>
                  void confirmUnlink(actionItem, {
                    deleteWorkspaceFiles: false,
                    deleteCompanyDocument: true,
                    deleteChecklistItem: false,
                  })
                }
              >
                {unlinking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Delete company doc, keep requirement
              </Button>
            ) : null}
            {actionItem && itemHasCompanyDocs(actionItem) ? (
              <Button
                type="button"
                variant="destructive"
                disabled={unlinking}
                className="w-full"
                onClick={() =>
                  void confirmUnlink(actionItem, {
                    deleteWorkspaceFiles: itemHasWorkspaceDocs(actionItem),
                    deleteCompanyDocument: true,
                    deleteChecklistItem: true,
                  })
                }
              >
                {unlinking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Delete company doc & requirement
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={unlinking || !actionItem}
              className="w-full"
              onClick={() =>
                actionItem &&
                void confirmUnlink(actionItem, {
                  deleteWorkspaceFiles: false,
                  deleteCompanyDocument: false,
                  deleteChecklistItem: true,
                })
              }
            >
              {unlinking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Delete this requirement
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={unlinking}
              className="w-full"
              onClick={() => setUnlinkConfirmOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {actionItem && onLinkCompanyDocument ? (
        <CompanyDocumentPickerDialog
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open);
            if (!open) setActionItemId(null);
          }}
          documents={companyDocuments}
          selectedId={
            actionItem.documents.find((doc) => doc.source === "COMPANY")?.id ||
            null
          }
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
