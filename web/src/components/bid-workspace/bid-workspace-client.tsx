"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { BoqEditor } from "@/components/bid-workspace/boq-editor";
import { ChecklistCreationPanel } from "@/components/bid-workspace/checklist-creation-panel";
import { WorkspaceDocuments } from "@/components/bid-workspace/workspace-documents";
import {
  mapCompanyReferenceCard,
  mapWorkspaceDocumentCard,
  WorkspaceDocumentSection,
} from "@/components/bid-workspace/workspace-document-section";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
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
import { isChecklistItemComplete } from "@/lib/bid-checklist";
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
import { markBidSubmittedAction, ingestTenderDocumentsAction, generateChecklistDocumentAction } from "@/server/actions/bid-workspace";
import type {
  ChecklistItemRow,
  ChecklistProgress,
} from "@/server/repositories/bidChecklistRepository";
import type { CompanyDocument } from "@/server/repositories/documentRepository";
import { lineTotal } from "@/lib/bid-workspace";

type WorkspaceTab =
  | "checklist"
  | "prequalification"
  | "technical"
  | "annexures"
  | "cost";

type BidWorkspaceClientProps = {
  tender: TenderDetailDTO;
  workspace: BidWorkspaceDTO;
  checklistItems: ChecklistItemRow[];
  checklistProgress: ChecklistProgress;
  companyDocuments: CompanyDocument[];
  canEdit: boolean;
  canSubmit: boolean;
};

function isReadyCardStatus(status: string): boolean {
  return status === "ready" || status === "approved" || status === "Approved" || status === "Ready";
}

export function BidWorkspaceClient({
  tender,
  workspace,
  checklistItems,
  checklistProgress,
  companyDocuments,
  canEdit,
  canSubmit,
}: BidWorkspaceClientProps) {
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
  const [reference, setReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");

  const days = getCalendarDaysUntilDeadline(tender.closingDate);
  const readOnly =
    !canEdit ||
    workspace.submissionStatus === "submitted" ||
    tender.qualificationStatus === "NO_GO";

  async function runDocumentIngestion() {
    if (readOnly || ingesting || generatingRequirementId) return;
    setIngesting(true);
    try {
      const result = await ingestTenderDocumentsAction(tender.id);
      if (!result.ok) {
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
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Document ingestion failed.",
      );
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
      toast.success("AI draft generated successfully.");
      if (result.documentType === "Technical" || result.documentType === "Technical Proposal") {
        setTab("technical");
      } else if (result.documentType === "Annexure") {
        setTab("annexures");
      } else if (result.documentType === "Pre-Qualification") {
        setTab("prequalification");
      }
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

  const companyById = useMemo(
    () => new Map(companyDocuments.map((doc) => [doc.id, doc])),
    [companyDocuments],
  );

  const pqCards = useMemo(() => {
    const tenderCards = workspace.documents
      .filter((doc) =>
        ["Pre-Qualification", "EMD", "Tender Fee", "Power of Attorney"].includes(
          doc.documentType,
        ),
      )
      .map(mapWorkspaceDocumentCard);
    const companyRefs = checklistItems
      .filter(
        (item) =>
          item.matchedDocumentSource === "COMPANY" &&
          item.matchedCompanyDocumentId &&
          (item.category === "COMPLIANCE" ||
            item.category === "FINANCIAL" ||
            item.category === "LEGAL" ||
            item.category === "EXPERIENCE"),
      )
      .map((item) => {
        const doc = companyById.get(item.matchedCompanyDocumentId!);
        return doc
          ? mapCompanyReferenceCard(doc, item.category)
          : null;
      })
      .filter(Boolean) as ReturnType<typeof mapCompanyReferenceCard>[];
    const seen = new Set<string>();
    return [...companyRefs, ...tenderCards].filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });
  }, [checklistItems, companyById, workspace.documents]);

  const technicalCards = useMemo(() => {
    const tenderCards = workspace.documents
      .filter((doc) =>
        ["Technical", "Technical Proposal"].includes(doc.documentType),
      )
      .map(mapWorkspaceDocumentCard);
    const companyRefs = checklistItems
      .filter(
        (item) =>
          item.matchedDocumentSource === "COMPANY" &&
          item.matchedCompanyDocumentId &&
          (item.category === "TECHNICAL" || item.category === "CERTIFICATE"),
      )
      .map((item) => {
        const doc = companyById.get(item.matchedCompanyDocumentId!);
        return doc
          ? mapCompanyReferenceCard(doc, item.category)
          : null;
      })
      .filter(Boolean) as ReturnType<typeof mapCompanyReferenceCard>[];
    const seen = new Set<string>();
    return [...companyRefs, ...tenderCards].filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });
  }, [checklistItems, companyById, workspace.documents]);

  const annexureCards = useMemo(() => {
    const tenderCards = workspace.documents
      .filter((doc) => doc.documentType === "Annexure")
      .map(mapWorkspaceDocumentCard);
    const companyRefs = checklistItems
      .filter(
        (item) =>
          item.matchedDocumentSource === "COMPANY" &&
          item.matchedCompanyDocumentId &&
          (item.category === "ANNEXURE" || item.category === "DECLARATION"),
      )
      .map((item) => {
        const doc = companyById.get(item.matchedCompanyDocumentId!);
        return doc
          ? mapCompanyReferenceCard(doc, item.category)
          : null;
      })
      .filter(Boolean) as ReturnType<typeof mapCompanyReferenceCard>[];
    const seen = new Set<string>();
    return [...companyRefs, ...tenderCards].filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });
  }, [checklistItems, companyById, workspace.documents]);

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
        count: `${checklistProgress.completed}/${checklistProgress.total}`,
      },
      {
        id: "prequalification" as const,
        label: "Pre-Qualification Documents",
        count: `${pqCards.filter((c) => isReadyCardStatus(c.statusLabel)).length}/${pqCards.length}`,
      },
      {
        id: "technical" as const,
        label: "Technical Documents",
        count: `${technicalCards.filter((c) => isReadyCardStatus(c.statusLabel)).length}/${technicalCards.length}`,
      },
      {
        id: "annexures" as const,
        label: "Annexures & Undertakings",
        count: `${annexureCards.filter((c) => isReadyCardStatus(c.statusLabel)).length}/${annexureCards.length}`,
      },
      {
        id: "cost" as const,
        label: "Cost Estimator",
        count: String(workspace.boqItems.length),
      },
    ],
    [
      annexureCards,
      checklistProgress.completed,
      checklistProgress.total,
      pqCards,
      technicalCards,
      workspace.boqItems.length,
    ],
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
  const completedChecklist = checklistItems.filter((item) =>
    isChecklistItemComplete(item.completionStatus),
  ).length;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href="/tenders"
            className="inline-flex shrink-0 items-center gap-1 text-foreground-500 hover:text-foreground-900"
          >
            <ArrowLeft className="size-4" />
            Tenders
          </Link>
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
                      {checklistProgress.total > 0
                        ? checklistProgress.percent
                        : workspace.readiness.percent}
                      %
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{
                          width: `${
                            checklistProgress.total > 0
                              ? checklistProgress.percent
                              : workspace.readiness.percent
                          }%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-foreground-400">
                      Checklist {completedChecklist}/{checklistItems.length} ·
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
          <ChecklistCreationPanel
            items={checklistItems}
            progress={checklistProgress}
            readOnly={readOnly}
            ingesting={ingesting}
            generatingRequirementId={generatingRequirementId}
            generationPhase={generationPhase}
            onIngestAi={runDocumentIngestion}
            onUpload={() => {
              setDocsOpen(true);
              toast.message("Upload a tender document from the Documents panel.");
            }}
            onGenerateAi={runChecklistDocumentGeneration}
          />
        ) : null}

        {tab === "prequalification" ? (
          <WorkspaceDocumentSection
            title="Pre-Qualification Documents"
            subtitle="Mandatory credentials and compliance certificates"
            cards={pqCards}
            readyCount={pqCards.filter((c) => isReadyCardStatus(c.statusLabel)).length}
            totalCount={pqCards.length}
            readOnly={readOnly}
            ingesting={ingesting}
            onIngestAi={runDocumentIngestion}
            onUpload={() => setDocsOpen(true)}
          />
        ) : null}

        {tab === "technical" ? (
          <WorkspaceDocumentSection
            title="Technical Documents"
            subtitle="Technical proposals, certifications and approach documents"
            cards={technicalCards}
            readyCount={
              technicalCards.filter((c) => isReadyCardStatus(c.statusLabel)).length
            }
            totalCount={technicalCards.length}
            readOnly={readOnly}
            ingesting={ingesting}
            onIngestAi={runDocumentIngestion}
            onUpload={() => setDocsOpen(true)}
          />
        ) : null}

        {tab === "annexures" ? (
          <WorkspaceDocumentSection
            title="Formats: Annexures & Undertakings"
            subtitle="Standard templates, declarations and format documents"
            cards={annexureCards}
            readyCount={
              annexureCards.filter((c) => isReadyCardStatus(c.statusLabel)).length
            }
            totalCount={annexureCards.length}
            readOnly={readOnly}
            ingesting={ingesting}
            onIngestAi={runDocumentIngestion}
            onUpload={() => setDocsOpen(true)}
          />
        ) : null}

        {tab === "cost" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
                  Cost Estimator
                </h2>
                <p className="mt-1 text-sm text-foreground-500">
                  {workspace.boqItems.length} line items · Total:{" "}
                  {formatIndianCurrency(boqTotal)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled>
                  Edit Prompt
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={readOnly || ingesting}
                  onClick={runDocumentIngestion}
                >
                  <Sparkles className="size-3.5" />
                  {ingesting ? "Ingesting…" : "Use AI"}
                </Button>
              </div>
            </div>
            <BoqEditor
              tenderId={tender.id}
              items={workspace.boqItems}
              readOnly={readOnly}
            />
          </div>
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
