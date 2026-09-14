"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BoqEditor } from "@/components/bid-workspace/boq-editor";
import { RequirementListPanel } from "@/components/bid-workspace/checklist-creation-panel";
import { WorkspaceDocuments } from "@/components/bid-workspace/workspace-documents";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { TendersBackLink } from "@/components/tenders/tenders-back-link";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  calculateSectionProgress,
} from "@/lib/bid-checklist";
import type { BidWorkspaceDTO } from "@/lib/bid-workspace";
import {
  formatDate,
  formatEmdAmount,
  formatIndianCurrency,
  formatRelativeTime,
  formatTenderValue,
} from "@/lib/format";
import { getCalendarDaysUntilDeadline } from "@/lib/tender-deadline";
import type { TenderDetailDTO } from "@/lib/tender-detail";
import { cn } from "@/lib/utils";
import {
  ensureWillBidWorkspacePreparedAction,
  generateChecklistDocumentAction,
  getChecklistPreparationStatusAction,
  ingestTenderDocumentsAction,
  markBidSubmittedAction,
  toggleChecklistItemCompleteAction,
  uploadWorkspaceDocumentAction,
} from "@/server/actions/bid-workspace";
import type {
  ChecklistItemRow,
  ChecklistProgress,
} from "@/server/repositories/bidChecklistRepository";
import type { CompanyDocument } from "@/server/repositories/documentRepository";
import { lineTotal } from "@/lib/bid-workspace";

type WorkspaceTab = "checklist" | "cost";

type BidWorkspaceClientProps = {
  tender: TenderDetailDTO;
  workspace: BidWorkspaceDTO;
  checklistItems: ChecklistItemRow[];
  checklistProgress: ChecklistProgress;
  companyDocuments: CompanyDocument[];
  canEdit: boolean;
  canSubmit: boolean;
};

const PREP_STEPS = [
  "Reading tender documents...",
  "Extracting submission requirements...",
  "Identifying pre-qualification requirements...",
  "Identifying technical requirements...",
  "Identifying annexures and undertakings...",
  "Preparing cost items...",
  "Matching available company documents...",
];

export function BidWorkspaceClient({
  tender,
  workspace,
  checklistItems,
  checklistProgress,
  companyDocuments,
  canEdit,
  canSubmit,
}: BidWorkspaceClientProps) {
  void companyDocuments;
  const router = useRouter();
  const [tab, setTab] = useState<WorkspaceTab>("checklist");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [generatingRequirementId, setGeneratingRequirementId] = useState<
    string | null
  >(null);
  const [generationPhase, setGenerationPhase] = useState<string | null>(null);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [items, setItems] = useState(checklistItems);
  const [progress, setProgress] = useState(checklistProgress);
  const [prepStatus, setPrepStatus] = useState(
    workspace.checklistPreparationStatus,
  );
  const [prepError, setPrepError] = useState(
    workspace.checklistPreparationError,
  );
  const [prepStepIndex, setPrepStepIndex] = useState(0);
  const [autoInitStarted, setAutoInitStarted] = useState(false);
  const [reference, setReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setItems(checklistItems);
    setProgress(checklistProgress);
    setPrepStatus(workspace.checklistPreparationStatus);
    setPrepError(workspace.checklistPreparationError);
  }, [
    checklistItems,
    checklistProgress,
    workspace.checklistPreparationStatus,
    workspace.checklistPreparationError,
  ]);

  const days = getCalendarDaysUntilDeadline(tender.closingDate);
  const readOnly =
    !canEdit ||
    workspace.submissionStatus === "submitted" ||
    tender.qualificationStatus === "NO_GO";

  const isWillBid = tender.qualificationStatus === "GO";
  const showPrepLoader =
    isWillBid &&
    (prepStatus === "PROCESSING" ||
      (prepStatus === "NOT_STARTED" && !readOnly));
  const showPrepFailed = isWillBid && prepStatus === "FAILED";

  // Auto-initialize WILL_BID workspaces that are not ready yet.
  useEffect(() => {
    if (!isWillBid || readOnly || autoInitStarted) return;
    if (prepStatus === "READY") return;
    if (prepStatus === "FAILED") return;

    let cancelled = false;
    setAutoInitStarted(true);

    async function run() {
      if (prepStatus === "NOT_STARTED") {
        setPrepStatus("PROCESSING");
        const result = await ensureWillBidWorkspacePreparedAction(tender.id);
        if (cancelled) return;
        if (!result.ok) {
          setPrepStatus("FAILED");
          setPrepError(result.error);
          return;
        }
        if (result.status === "READY" || result.status === "ALREADY_READY") {
          setPrepStatus("READY");
          router.refresh();
          return;
        }
        setPrepStatus("PROCESSING");
      }

      // Poll while another tab owns the lock (or this tab is mid-flight).
      for (let i = 0; i < 90; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) return;
        const status = await getChecklistPreparationStatusAction(tender.id);
        if (!status.ok) continue;
        setPrepStatus(status.status);
        setPrepError(status.error);
        if (status.status === "READY") {
          router.refresh();
          return;
        }
        if (status.status === "FAILED") return;
      }
      setPrepStatus("FAILED");
      setPrepError("Preparation timed out. Please retry.");
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    autoInitStarted,
    isWillBid,
    prepStatus,
    readOnly,
    router,
    tender.id,
  ]);

  useEffect(() => {
    if (!showPrepLoader) return;
    const timer = window.setInterval(() => {
      setPrepStepIndex((prev) => (prev + 1) % PREP_STEPS.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [showPrepLoader]);

  async function runDocumentIngestion() {
    if (readOnly || ingesting || generatingRequirementId) return;
    setIngesting(true);
    setPrepStatus("PROCESSING");
    try {
      const result = await ingestTenderDocumentsAction(tender.id, {
        force: true,
      });
      if (!result.ok) {
        setPrepStatus("FAILED");
        setPrepError(result.error);
        toast.error(result.error);
        return;
      }
      const engineLabel =
        result.engine === "openai"
          ? "OpenAI"
          : result.engine === "needs_ai"
            ? "needs AI/OCR"
            : "heuristics";
      if (result.engine === "needs_ai" || result.checklistCount === 0) {
        toast.message(
          result.warning ||
            `Ingested ${result.sourceFileCount} files. Some tender documents could not be fully analyzed.`,
        );
      } else {
        toast.success(
          `Ingested ${result.sourceFileCount} files → ${result.checklistCount} checklist, ${result.annexureCount} annexures, ${result.costItemCount} cost items (${engineLabel}).`,
        );
      }
      if (result.warning && result.engine !== "needs_ai") {
        toast.message(result.warning);
      }
      setPrepStatus("READY");
      setPrepError(null);
      router.refresh();
    } catch (error) {
      setPrepStatus("FAILED");
      const message =
        error instanceof Error
          ? error.message
          : "Document ingestion failed.";
      setPrepError(message);
      toast.error(message);
    } finally {
      setIngesting(false);
    }
  }

  async function runChecklistDocumentGeneration(
    item: ChecklistItemRow,
    options?: { customInstructions?: string },
  ) {
    if (readOnly || generatingRequirementId || ingesting) return;
    setGeneratingRequirementId(item.id);
    setGenerationPhase("Reading tender requirement");
    const phaseTimer = window.setTimeout(() => {
      setGenerationPhase("Preparing RFP context");
    }, 1200);
    const phaseTimer2 = window.setTimeout(() => {
      setGenerationPhase("Applying company information · Generating draft");
    }, 2800);
    try {
      const result = await generateChecklistDocumentAction({
        tenderId: tender.id,
        requirementId: item.id,
        customInstructions: options?.customInstructions,
      });
      if (!result.ok) {
        toast.error(result.error || "Document generation failed.");
        return;
      }
      setGenerationPhase("Saving document");
      toast.success("AI document generated and requirement completed.");
      setItems((prev) => {
        const next = prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                completionStatus: "COMPLETED_TENDER_DOCUMENT" as const,
                matchedDocumentSource: "TENDER" as const,
                matchedWorkspaceDocumentId: result.documentId,
                matchedBy: "AI" as const,
                isCompleted: true,
                completionSource: "AI_GENERATED" as const,
                matchedWorkspaceDocument: {
                  id: result.documentId,
                  title: result.title,
                  fileName: result.fileName,
                  status: "drafting",
                },
                documents: [
                  {
                    id: result.documentId,
                    title: result.title,
                    fileName: result.fileName,
                    status: "drafting",
                    versionLabel: result.versionLabel,
                    source: "TENDER" as const,
                    hasFile: true,
                    downloadHref: `/api/bid-workspace/documents/${result.documentId}`,
                    matchedBy: "AI" as const,
                  },
                  ...row.documents.filter((d) => d.id !== result.documentId),
                ],
              }
            : row,
        );
        setProgress(calculateSectionProgress(next));
        return next;
      });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Document generation failed.",
      );
    } finally {
      window.clearTimeout(phaseTimer);
      window.clearTimeout(phaseTimer2);
      setGeneratingRequirementId(null);
      setGenerationPhase(null);
    }
  }

  async function toggleChecklistComplete(
    item: ChecklistItemRow,
    completed: boolean,
  ) {
    if (readOnly || togglingItemId) return;
    setTogglingItemId(item.id);
    const previous = items;
    const optimistic = items.map((row) =>
      row.id === item.id
        ? {
            ...row,
            manualCompleted: completed,
            isCompleted:
              completed ||
              row.documents.some((d) => d.hasFile) ||
              Boolean(row.matchedWorkspaceDocumentId) ||
              Boolean(row.matchedCompanyDocumentId),
            completionStatus: completed
              ? row.matchedDocumentSource === "COMPANY"
                ? ("COMPLETED_COMPANY_DOCUMENT" as const)
                : ("COMPLETED_TENDER_DOCUMENT" as const)
              : row.matchedWorkspaceDocumentId || row.matchedCompanyDocumentId
                ? row.matchedDocumentSource === "COMPANY"
                  ? ("COMPLETED_COMPANY_DOCUMENT" as const)
                  : ("COMPLETED_TENDER_DOCUMENT" as const)
                : ("MISSING" as const),
            completionSource: completed
              ? ("MANUAL" as const)
              : row.matchedBy === "AI"
                ? ("AI_GENERATED" as const)
                : row.matchedDocumentSource === "COMPANY"
                  ? ("COMPANY_DOCUMENT" as const)
                  : row.matchedDocumentSource === "TENDER"
                    ? ("UPLOADED" as const)
                    : null,
            matchedBy: "USER" as const,
          }
        : row,
    );
    setItems(optimistic);
    setProgress(calculateSectionProgress(optimistic));
    try {
      const result = await toggleChecklistItemCompleteAction({
        tenderId: tender.id,
        itemId: item.id,
        completed,
      });
      if (!result.ok) {
        setItems(previous);
        setProgress(calculateSectionProgress(previous));
        toast.error(result.error);
        return;
      }
      router.refresh();
    } catch (error) {
      setItems(previous);
      setProgress(calculateSectionProgress(previous));
      toast.error(
        error instanceof Error ? error.message : "Unable to update checklist.",
      );
    } finally {
      setTogglingItemId(null);
    }
  }

  async function uploadForChecklistItem(item: ChecklistItemRow, file: File) {
    const formData = new FormData();
    formData.set("tenderId", tender.id);
    formData.set("file", file);
    formData.set("title", item.requirementName);
    formData.set("checklistItemId", item.id);
    const docType =
      item.category === "TECHNICAL"
        ? "Technical"
        : item.category === "ANNEXURE" ||
            item.category === "DECLARATION" ||
            item.category === "AUTHORIZATION"
          ? "Annexure"
          : "Pre-Qualification";
    formData.set("documentType", docType);
    const result = await uploadWorkspaceDocumentAction(formData);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Document uploaded and requirement completed.");
    setItems((prev) => {
      const next = prev.map((row) =>
        row.id === item.id
          ? {
              ...row,
              completionStatus: "COMPLETED_TENDER_DOCUMENT" as const,
              matchedDocumentSource: "TENDER" as const,
              matchedBy: "USER" as const,
              isCompleted: true,
              completionSource: "UPLOADED" as const,
            }
          : row,
      );
      setProgress(calculateSectionProgress(next));
      return next;
    });
    router.refresh();
  }

  const boqTotal = useMemo(
    () =>
      workspace.boqItems.reduce(
        (sum, item) =>
          sum + lineTotal(item.quantity, item.unitRate, item.gstPercent),
        0,
      ),
    [workspace.boqItems],
  );

  const tabs = useMemo(
    () => [
      {
        id: "checklist" as const,
        label: "Checklist Creation",
        count: `${progress.completed}/${progress.total}`,
      },
      {
        id: "cost" as const,
        label: "Cost Estimator",
        count: String(workspace.boqItems.length),
      },
    ],
    [progress.completed, progress.total, workspace.boqItems.length],
  );

  async function submit() {
    setSaving(true);
    try {
      const result = await markBidSubmittedAction({
        tenderId: tender.id,
        submissionReference: reference,
        submittedAt,
        notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Bid marked submitted.");
      setSubmitOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const incomplete = workspace.readiness.incompleteRequired;
  const completedChecklist = items.filter((item) => item.isCompleted).length;

  const sharedPanelProps = {
    tenderId: tender.id,
    readOnly,
    allItems: items,
    generatingRequirementId,
    generationPhase,
    togglingItemId,
    onUpload: uploadForChecklistItem,
    onGenerateAi: runChecklistDocumentGeneration,
    onToggleComplete: toggleChecklistComplete,
    onRequirementsChanged: () => router.refresh(),
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <TendersBackLink />
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <Link
            href={`/tenders/${tender.id}`}
            className="truncate text-foreground-500 hover:text-foreground-900"
          >
            {tender.sourceTenderId}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <span className="shrink-0 font-medium text-foreground-900">
            Bid Workspace
          </span>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <SourceBadge
                  source={tender.sourcePortal}
                  size="sm"
                  className="rounded px-2 py-0.5 text-[11px]"
                />
                <CategoryCapsule
                  category={tender.projectCategory}
                  title={tender.title}
                  description={tender.description}
                  sourceCategory={tender.sourceCategory}
                  className="rounded px-2 py-0.5 text-[11px]"
                />
                {tender.qualificationStatus ? (
                  <StatusBadge status={tender.qualificationStatus} size="sm" />
                ) : null}
                {workspace.submissionStatus === "submitted" ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Submitted
                  </span>
                ) : null}
              </div>
              <h1 className="text-lg font-semibold leading-snug md:text-xl">
                {tender.title}
              </h1>
            </div>

            <div className="w-full shrink-0 sm:w-64">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-default">
                    <p className="text-xs text-foreground-500">
                      Submission Readiness
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {progress.total > 0
                        ? progress.percent
                        : workspace.readiness.percent}
                      %
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{
                          width: `${
                            progress.total > 0
                              ? progress.percent
                              : workspace.readiness.percent
                          }%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-foreground-400">
                      Checklist {completedChecklist}/{items.length} ·
                      Saved {formatRelativeTime(workspace.updatedAt)}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="space-y-1">
                  {workspace.readiness.items.map((item) => (
                    <p key={item.key}>
                      {item.label} {item.completed}/{item.total}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
              <Button
                className="mt-3 w-full"
                disabled={!canSubmit || workspace.submissionStatus === "submitted"}
                onClick={() => {
                  if (incomplete > 0) {
                    toast.error(
                      `${incomplete} required item${incomplete === 1 ? " is" : "s are"} still incomplete.`,
                    );
                    return;
                  }
                  setSubmitOpen(true);
                }}
              >
                {workspace.submissionStatus === "submitted"
                  ? "Bid submitted"
                  : "Mark Bid as Submitted"}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5 md:grid-cols-4">
            <Info
              label="Tender Value"
              value={
                formatTenderValue({
                  amount: tender.tenderValue,
                  text: tender.tenderValueText,
                }).label
              }
            />
            <Info
              label="EMD Required"
              value={
                formatEmdAmount({
                  amount: tender.emdAmount,
                  text: tender.emdText,
                }).label
              }
            />
            <Info label="Deadline" value={formatDate(tender.closingDate)} />
            <Info
              label="Days Left"
              value={
                days == null ? "—" : days < 0 ? "Closed" : String(days)
              }
            />
          </div>
        </div>

        {showPrepLoader ? (
          <div className="rounded-lg border border-border bg-card px-6 py-16 text-center shadow-sm">
            <Loader2 className="mx-auto size-8 animate-spin text-foreground-500" />
            <h2 className="mt-4 text-lg font-semibold text-foreground-900">
              Preparing Bid Workspace
            </h2>
            <p className="mt-2 text-sm text-foreground-500">
              {PREP_STEPS[prepStepIndex]}
            </p>
            <ul className="mx-auto mt-6 max-w-md space-y-1.5 text-left text-sm text-foreground-500">
              {PREP_STEPS.map((step, index) => (
                <li
                  key={step}
                  className={cn(
                    index === prepStepIndex && "font-medium text-foreground-800",
                  )}
                >
                  {index <= prepStepIndex ? "•" : "○"} {step}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showPrepFailed ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-6 py-10 text-center">
            <h2 className="text-lg font-semibold text-foreground-900">
              We couldn&apos;t prepare the Bid Workspace.
            </h2>
            <p className="mt-2 text-sm text-foreground-600">
              {prepError || "Automatic checklist extraction failed."}
            </p>
            <Button
              className="mt-5"
              disabled={readOnly || ingesting}
              onClick={() => {
                setPrepError(null);
                setAutoInitStarted(false);
                void runDocumentIngestion();
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!showPrepLoader && !showPrepFailed ? (
          <>
            <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                    tab === item.id
                      ? "bg-white text-foreground-900 shadow-sm"
                      : "text-foreground-500",
                  )}
                >
                  {item.label}{" "}
                  <span className="text-foreground-400">{item.count}</span>
                </button>
              ))}
            </div>

            {tab === "checklist" ? (
              <RequirementListPanel
                {...sharedPanelProps}
                title="Checklist Creation"
                items={items}
                progress={progress}
                addSection={null}
              />
            ) : null}

            {tab === "cost" ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
                    Cost Estimator
                  </h2>
                  <p className="mt-1 text-sm text-foreground-500">
                    {workspace.boqItems.length} line items · Total:{" "}
                    {formatIndianCurrency(boqTotal)}
                  </p>
                </div>
                <BoqEditor
                  tenderId={tender.id}
                  items={workspace.boqItems}
                  readOnly={readOnly}
                />
              </div>
            ) : null}
          </>
        ) : null}

        <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Tender documents</DialogTitle>
              <DialogDescription>
                Uploads here are saved as tender-specific documents only — they
                are never added to Company Documents.
              </DialogDescription>
            </DialogHeader>
            <WorkspaceDocuments
              tenderId={tender.id}
              documents={workspace.documents}
              readOnly={readOnly}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark this tender as submitted?</DialogTitle>
              <DialogDescription>
                This records offline / external submission in TenderFlow. It
                does not submit to a government portal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Submission Reference</Label>
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Submission Date</Label>
                <Input
                  type="date"
                  value={submittedAt}
                  onChange={(event) => setSubmittedAt(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Optional Notes</Label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSubmitOpen(false)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void submit()}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Mark submitted"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
