"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileText,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AddFeeWizard,
  type FeeEligibleTender,
} from "@/components/bid-fees/add-fee-wizard";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { ClassificationWorkflow } from "@/components/tenders/classification-workflow";
import { TenderAnalyzerPanels } from "@/components/tenders/tender-analysis-panels";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BID_FEE_TYPE_LABELS,
  formatFileSize,
  type BidFeeRecord,
  type BidFeeType,
  type TenderDocumentRecord,
  type TenderDocumentSection,
} from "@/lib/bid-fees";
import {
  formatDate,
  formatEmdAmount,
  formatIndianCurrency,
  formatRelativeTime,
  formatTenderValue,
} from "@/lib/format";
import { PROJECT_CATEGORIES } from "@/lib/project-category";
import { getCalendarDaysUntilDeadline } from "@/lib/tender-deadline";
import {
  displayDash,
  type TenderDetailDTO,
} from "@/lib/tender-detail";
import {
  biddingDocumentsLockReason,
  canAccessBiddingDocuments,
  canAccessDeliverables,
  canAccessFinancialDocuments,
  deliverablesLockReason,
  financialDocumentsLockReason,
} from "@/lib/tender-document-access";
import {
  STATUS_DISPLAY_LABELS,
  TENDER_STATUSES,
  type TenderStatus,
} from "@/lib/tender-status";
import { cn } from "@/lib/utils";
import {
  deleteTenderDocumentAction,
  uploadTenderSectionDocumentAction,
} from "@/server/actions/bid-fees";
import {
  updateTenderDetailsAction,
  updateTenderStatusAction,
} from "@/server/actions/tender-update";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "analyzer", label: "Analyzer" },
  { id: "documents", label: "Documents" },
  { id: "timeline", label: "Timeline" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type ContactDraft = { name: string; mobile: string; email: string };

type EditDraft = {
  title: string;
  referenceNo: string;
  portal: "TENDER247" | "BIDASSIST" | "MANUAL";
  portalLink: string;
  category: string;
  tenderType: string;
  organization: string;
  location: string;
  publishedDate: string;
  closingDate: string;
  qualificationStatus: TenderStatus | "";
  description: string;
  notes: string;
  tenderValue: string;
  tenderEstCost: string;
  emdAmount: string;
  tenderFee: string;
  processingFee: string;
  finalCost: string;
  msmeExemption: boolean;
  startupExemption: boolean;
  exemptionTypes: string[];
  contacts: ContactDraft[];
  decisionReason: string;
  lostReason: string;
  disqualificationReason: string;
};

const EXEMPTION_TYPES = ["Turnover", "Experience", "EMD"] as const;

type TenderDetailClientProps = {
  tender: TenderDetailDTO;
  documents: TenderDocumentRecord[];
  fees: BidFeeRecord[];
  eligibleTender: FeeEligibleTender | null;
  canClassify: boolean;
  canEdit: boolean;
  canCreateFee: boolean;
};

function toStatusBadge(status: TenderStatus | null): QualificationStatus | null {
  if (!status) return null;
  return status as QualificationStatus;
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function moneyOrNil(value: number | null | undefined): string {
  if (value == null) return "Nil";
  return formatIndianCurrency(value);
}

function moneyOrNotBid(value: number | null | undefined): string {
  if (value == null) return "Not bid yet";
  return formatIndianCurrency(value);
}

function buildDraft(tender: TenderDetailDTO): EditDraft {
  const portal =
    tender.sourcePortal === "BIDASSIST" ||
    tender.sourcePortal === "TENDER247" ||
    tender.sourcePortal === "MANUAL"
      ? tender.sourcePortal
      : "MANUAL";

  return {
    title: tender.title || "",
    referenceNo: tender.folderId || tender.sourceTenderId || "",
    portal,
    portalLink: tender.sourceUrl || "",
    category: tender.projectCategory || "",
    tenderType: tender.tenderType || "",
    organization: tender.organization || tender.authority || "",
    location: tender.location || "",
    publishedDate: dateInputValue(tender.publishedDate),
    closingDate: dateInputValue(tender.closingDate),
    qualificationStatus: tender.qualificationStatus || "",
    description: tender.description || "",
    notes: tender.notes || "",
    tenderValue:
      tender.tenderValue != null ? String(tender.tenderValue) : "",
    tenderEstCost:
      tender.tenderEstCost != null ? String(tender.tenderEstCost) : "",
    emdAmount: tender.emdAmount != null ? String(tender.emdAmount) : "",
    tenderFee: tender.tenderFee != null ? String(tender.tenderFee) : "",
    processingFee:
      tender.processingFee != null ? String(tender.processingFee) : "",
    finalCost: tender.finalCost != null ? String(tender.finalCost) : "",
    msmeExemption: tender.msmeExemption,
    startupExemption: tender.startupExemption,
    exemptionTypes: [...tender.exemptionTypes],
    contacts:
      tender.contacts.length > 0
        ? tender.contacts.map((c) => ({
            name: c.name || "",
            mobile: c.mobile || "",
            email: c.email || "",
          }))
        : [{ name: "", mobile: "", email: "" }],
    decisionReason: tender.decisionReason || "",
    lostReason: tender.lostReason || "",
    disqualificationReason: tender.disqualificationReason || "",
  };
}

function Card({
  title,
  children,
  className,
  actions,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-sm md:p-6",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
          {title}
        </h2>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr] sm:items-start sm:gap-3">
      <dt className="text-xs text-muted-foreground pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground-900">
        {children}
      </dd>
    </div>
  );
}

function ReadonlyText({ value }: { value: string | null | undefined }) {
  return <span className="break-words">{displayDash(value)}</span>;
}

function ApplicablePill({ applicable }: { applicable: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
        applicable
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-50 text-slate-500 border border-slate-200",
      )}
    >
      {applicable ? "Applicable" : "Not applicable"}
    </span>
  );
}

type DocRowItem = {
  key: string;
  name: string;
  sizeLabel: string;
  url: string | null;
  deletableId: string | null;
  meta?: string;
};

function DocumentSection({
  title,
  locked,
  lockReason,
  items,
  canEdit,
  uploading,
  onUpload,
  onDelete,
  headerActions,
}: {
  title: string;
  locked: boolean;
  lockReason?: string;
  items: DocRowItem[];
  canEdit: boolean;
  uploading: boolean;
  onUpload?: (file: File) => void;
  onDelete?: (documentId: string) => void;
  headerActions?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (locked) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-card/60 p-5 md:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
          {title}
        </h2>
        <div className="mt-6 flex flex-col items-center justify-center gap-2 py-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Lock className="size-4" />
          </div>
          <p className="text-sm font-medium text-foreground-700">Locked</p>
          <p className="max-w-sm text-xs text-foreground-500">
            {lockReason || "This section is locked for the current tender status."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {canEdit && onUpload ? (
            <>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onUpload(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-foreground-500">
          No documents in this section yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {items.map((doc) => (
            <li key={doc.key} className="flex items-center gap-3 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="text-xs text-foreground-500">
                  {doc.sizeLabel}
                  {doc.meta ? ` · ${doc.meta}` : ""}
                </p>
              </div>
              {doc.url ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
                >
                  <Download className="size-4" />
                  Download
                </a>
              ) : (
                <span className="text-[11px] text-foreground-400">No link</span>
              )}
              {canEdit && doc.deletableId && onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete “${doc.name}”? This cannot be undone.`,
                      )
                    ) {
                      onDelete(doc.deletableId!);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TenderDetailClient({
  tender,
  documents,
  fees,
  eligibleTender,
  canClassify,
  canEdit,
  canCreateFee,
}: TenderDetailClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => buildDraft(tender));
  const [pending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const [uploadPending, startUploadTransition] = useTransition();
  const [feeWizardOpen, setFeeWizardOpen] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(buildDraft(tender));
  }, [tender, editing]);

  const days = getCalendarDaysUntilDeadline(
    editing ? draft.closingDate || tender.closingDate : tender.closingDate,
  );
  const closed = days != null && days < 0;
  const urgent = days != null && days >= 0 && days <= 3;

  const breadcrumbId = tender.folderId || tender.sourceTenderId;
  const displayStatus = editing
    ? draft.qualificationStatus || null
    : tender.qualificationStatus;
  const statusBadge = toStatusBadge(displayStatus);

  const valueLabel = formatTenderValue({
    amount: tender.tenderValue,
    text: tender.tenderValueText,
  }).label;
  const emdLabel = formatEmdAmount({
    amount: tender.emdAmount,
    text: tender.emdText,
  }).label;

  const patchDraft = useCallback((patch: Partial<EditDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleStatusChange = (next: string) => {
    if (editing) {
      patchDraft({
        qualificationStatus: (next || "") as TenderStatus | "",
      });
      return;
    }
    if (!canEdit) return;
    if (!next || !(TENDER_STATUSES as readonly string[]).includes(next)) return;

    startStatusTransition(async () => {
      const result = await updateTenderStatusAction({
        tenderId: tender.id,
        status: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  const handleCancelEdit = () => {
    setDraft(buildDraft(tender));
    setEditing(false);
  };

  const handleSave = () => {
    startTransition(async () => {
      const showExemptions = draft.msmeExemption || draft.startupExemption;
      const result = await updateTenderDetailsAction({
        tenderId: tender.id,
        title: draft.title.trim(),
        referenceNo: draft.referenceNo.trim(),
        portal: draft.portal,
        portalLink: draft.portalLink.trim() || null,
        category: draft.category || null,
        tenderType: draft.tenderType.trim() || null,
        organization: draft.organization.trim() || null,
        location: draft.location.trim() || null,
        publishedDate: draft.publishedDate || null,
        closingDate: draft.closingDate || null,
        description: draft.description.trim() || null,
        notes: draft.notes.trim() || null,
        qualificationStatus: draft.qualificationStatus || null,
        tenderValue: parseAmount(draft.tenderValue),
        tenderEstCost: parseAmount(draft.tenderEstCost),
        emdAmount: parseAmount(draft.emdAmount),
        tenderFee: parseAmount(draft.tenderFee),
        processingFee: parseAmount(draft.processingFee),
        finalCost: parseAmount(draft.finalCost),
        msmeExemption: draft.msmeExemption,
        startupExemption: draft.startupExemption,
        exemptionTypes: showExemptions ? draft.exemptionTypes : [],
        contacts: draft.contacts
          .filter((c) => c.name.trim() || c.mobile.trim() || c.email.trim())
          .map((c) => ({
            name: c.name.trim(),
            mobile: c.mobile.trim(),
            email: c.email.trim() || null,
          })),
        decisionReason: draft.decisionReason.trim() || null,
        lostReason: draft.lostReason.trim() || null,
        disqualificationReason: draft.disqualificationReason.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setEditing(false);
      router.refresh();
    });
  };

  const tenderSectionDocs = useMemo((): DocRowItem[] => {
    const archiveItems: DocRowItem[] = tender.archiveDocuments
      .filter((d) => d.downloadable && d.url)
      .map((d, index) => ({
        key: `archive-${d.name}-${index}`,
        name: d.name,
        sizeLabel: d.sizeLabel || "—",
        url: d.url || null,
        deletableId: null,
        meta: d.kind,
      }));

    const dbItems: DocRowItem[] = documents
      .filter((d) => d.section === "tender")
      .map((d) => ({
        key: d.id,
        name: d.originalName || d.fileName,
        sizeLabel: formatFileSize(d.fileSizeBytes),
        url: d.downloadUrl,
        deletableId: d.id,
      }));

    return [...archiveItems, ...dbItems];
  }, [documents, tender.archiveDocuments]);

  const sectionDocs = useCallback(
    (section: TenderDocumentSection): DocRowItem[] =>
      documents
        .filter((d) => d.section === section)
        .map((d) => {
          const fee = d.feeId
            ? fees.find((f) => f.id === d.feeId)
            : undefined;
          return {
            key: d.id,
            name: d.originalName || d.fileName,
            sizeLabel: formatFileSize(d.fileSizeBytes),
            url: d.downloadUrl,
            deletableId: d.id,
            meta: fee
              ? BID_FEE_TYPE_LABELS[fee.feeType as BidFeeType] || fee.feeType
              : undefined,
          };
        }),
    [documents, fees],
  );

  const uploadSectionDoc = (
    section: TenderDocumentSection,
    file: File,
    feeId?: string | null,
  ) => {
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.set("tenderId", tender.id);
      formData.set("section", section);
      formData.set("file", file);
      if (feeId) formData.set("feeId", feeId);

      const result = await uploadTenderSectionDocumentAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message || "Document uploaded.");
      router.refresh();
    });
  };

  const handleFinancialUpload = (file: File) => {
    if (fees.length === 0) {
      if (canCreateFee && eligibleTender) {
        toast.message("Add a fee first, then upload financial documents.");
        setFeeWizardOpen(true);
        return;
      }
      toast.error("Create a fee before uploading financial documents.");
      return;
    }

    if (fees.length === 1) {
      uploadSectionDoc("financial", file, fees[0]!.id);
      return;
    }

    const options = fees
      .map(
        (f, i) =>
          `${i + 1}. ${BID_FEE_TYPE_LABELS[f.feeType] || f.feeType} — ${formatIndianCurrency(f.amount)}`,
      )
      .join("\n");
    const choice = window.prompt(
      `Select fee number for this upload:\n${options}`,
      "1",
    );
    if (!choice) return;
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= fees.length) {
      toast.error("Invalid fee selection.");
      return;
    }
    uploadSectionDoc("financial", file, fees[index]!.id);
  };

  const handleDeleteDoc = (documentId: string) => {
    startUploadTransition(async () => {
      const result = await deleteTenderDocumentAction(documentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message || "Document deleted.");
      router.refresh();
    });
  };

  const statusSelectValue =
    (editing ? draft.qualificationStatus : tender.qualificationStatus) ||
    undefined;

  const showLost = displayStatus === "LOST";
  const showDisqualified = displayStatus === "DISQUALIFIED";

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href="/tenders"
            className="inline-flex shrink-0 items-center gap-1 text-foreground-500 hover:text-foreground-900"
          >
            <ArrowLeft className="size-4" />
            Tenders
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <span className="truncate font-medium text-foreground-900">
            {breadcrumbId}
          </span>
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={handleCancelEdit}
                  aria-label="Cancel edit"
                >
                  <X className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={handleSave}
                  aria-label="Save"
                >
                  <Check className="size-4" />
                  {pending ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(buildDraft(tender));
                  setEditing(true);
                }}
                aria-label="Edit tender"
              >
                <Pencil className="size-4" />
                Edit
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge
                source={tender.sourcePortal}
                size="sm"
                className="rounded px-2 py-0.5 text-[11px]"
              />
              <CategoryCapsule
                category={
                  editing ? draft.category || null : tender.projectCategory
                }
                title={editing ? draft.title : tender.title}
                description={
                  editing ? draft.description : tender.description
                }
                sourceCategory={tender.sourceCategory}
                className="rounded px-2 py-0.5 text-[11px]"
              />
              {tender.tenderType || (editing && draft.tenderType) ? (
                <span className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground-600">
                  {editing
                    ? draft.tenderType || tender.tenderType
                    : tender.tenderType}
                </span>
              ) : null}
              {statusBadge ? (
                <StatusBadge status={statusBadge} size="sm" />
              ) : (
                <span className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground-500">
                  New
                </span>
              )}
            </div>

            {editing ? (
              <Input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className="text-lg font-semibold md:text-xl h-auto py-2"
              />
            ) : (
              <h1 className="text-lg font-semibold leading-snug md:text-xl">
                {tender.title}
              </h1>
            )}

            {editing ? (
              <Input
                value={draft.organization}
                onChange={(e) => patchDraft({ organization: e.target.value })}
                placeholder="Organization"
              />
            ) : (
              <p className="text-sm text-foreground-500">
                {tender.authority || tender.organization || "—"}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Label className="sr-only">Status</Label>
              <Select
                value={statusSelectValue}
                onValueChange={handleStatusChange}
                disabled={
                  (!canEdit && !editing) || statusPending || pending
                }
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Set status" />
                </SelectTrigger>
                <SelectContent>
                  {TENDER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_DISPLAY_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-center",
                urgent
                  ? "border-rose-200 bg-rose-50 text-rose-600"
                  : "border-border bg-background-50 text-foreground-800",
              )}
            >
              {closed ? (
                <p className="text-sm font-semibold">Closed</p>
              ) : days == null ? (
                <p className="text-sm font-semibold">—</p>
              ) : (
                <>
                  <p className="text-2xl font-semibold leading-none">{days}</p>
                  <p className="mt-1 text-[11px] font-medium">
                    days until deadline
                  </p>
                </>
              )}
            </div>
            <Button asChild className="justify-center">
              <Link href={`/tenders/${tender.id}/analyze`}>
                <Sparkles className="size-4" />
                AI Qualification Analysis
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-center">
              <Link href={`/tenders/${tender.id}/bid-workspace`}>
                Open Bid Workspace
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex w-fit items-center gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              tab === item.id
                ? "bg-white text-foreground-900 shadow-sm"
                : "text-foreground-500 hover:text-foreground-800",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Tender Information">
              <dl className="space-y-3">
                <FieldRow label="Tender ID">
                  <ReadonlyText value={tender.sourceTenderId} />
                </FieldRow>
                <FieldRow label="Reference No.">
                  {editing ? (
                    <Input
                      value={draft.referenceNo}
                      onChange={(e) =>
                        patchDraft({ referenceNo: e.target.value })
                      }
                    />
                  ) : (
                    <ReadonlyText
                      value={tender.folderId || tender.sourceTenderId}
                    />
                  )}
                </FieldRow>
                <FieldRow label="Portal">
                  {editing ? (
                    <Select
                      value={draft.portal}
                      onValueChange={(v) =>
                        patchDraft({
                          portal: v as EditDraft["portal"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TENDER247">Tender247</SelectItem>
                        <SelectItem value="BIDASSIST">BidAssist</SelectItem>
                        <SelectItem value="MANUAL">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <SourceBadge source={tender.sourcePortal} size="sm" />
                  )}
                </FieldRow>
                <FieldRow label="Type">
                  {editing ? (
                    <Input
                      value={draft.tenderType}
                      onChange={(e) =>
                        patchDraft({ tenderType: e.target.value })
                      }
                      placeholder="e.g. Open, Limited"
                    />
                  ) : (
                    <ReadonlyText value={tender.tenderType} />
                  )}
                </FieldRow>
                <FieldRow label="Category">
                  {editing ? (
                    <Select
                      value={draft.category || undefined}
                      onValueChange={(v) => patchDraft({ category: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <ReadonlyText value={tender.projectCategory} />
                  )}
                </FieldRow>
                <FieldRow label="Portal Link">
                  {editing ? (
                    <Input
                      value={draft.portalLink}
                      onChange={(e) =>
                        patchDraft({ portalLink: e.target.value })
                      }
                      placeholder="https://"
                    />
                  ) : tender.sourceUrl ? (
                    <a
                      href={tender.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-primary-600 hover:underline"
                    >
                      {tender.sourceUrl}
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </FieldRow>
                <FieldRow label="Creation Date">
                  {editing ? (
                    <Input
                      type="date"
                      value={draft.publishedDate}
                      onChange={(e) =>
                        patchDraft({ publishedDate: e.target.value })
                      }
                    />
                  ) : (
                    formatDate(tender.publishedDate)
                  )}
                </FieldRow>
                <FieldRow label="Deadline">
                  {editing ? (
                    <Input
                      type="date"
                      value={draft.closingDate}
                      onChange={(e) =>
                        patchDraft({ closingDate: e.target.value })
                      }
                    />
                  ) : (
                    formatDate(tender.closingDate)
                  )}
                </FieldRow>
              </dl>
            </Card>

            <Card title="Organization Details">
              <dl className="space-y-3">
                <FieldRow label="Organization">
                  {editing ? (
                    <Input
                      value={draft.organization}
                      onChange={(e) =>
                        patchDraft({ organization: e.target.value })
                      }
                    />
                  ) : (
                    <ReadonlyText
                      value={tender.organization || tender.authority}
                    />
                  )}
                </FieldRow>
                <FieldRow label="Location">
                  {editing ? (
                    <Input
                      value={draft.location}
                      onChange={(e) =>
                        patchDraft({ location: e.target.value })
                      }
                    />
                  ) : (
                    <ReadonlyText value={tender.location} />
                  )}
                </FieldRow>
              </dl>
            </Card>

            <Card
              title="Contact Details"
              actions={
                editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchDraft({
                        contacts: [
                          ...draft.contacts,
                          { name: "", mobile: "", email: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="size-3.5" />
                    Add Contact
                  </Button>
                ) : null
              }
            >
              {editing ? (
                <div className="space-y-3">
                  {draft.contacts.map((contact, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                    >
                      <Input
                        placeholder="Name"
                        value={contact.name}
                        onChange={(e) => {
                          const next = [...draft.contacts];
                          next[index] = {
                            ...contact,
                            name: e.target.value,
                          };
                          patchDraft({ contacts: next });
                        }}
                      />
                      <Input
                        placeholder="Mobile"
                        value={contact.mobile}
                        onChange={(e) => {
                          const next = [...draft.contacts];
                          next[index] = {
                            ...contact,
                            mobile: e.target.value,
                          };
                          patchDraft({ contacts: next });
                        }}
                      />
                      <Input
                        placeholder="Email"
                        value={contact.email}
                        onChange={(e) => {
                          const next = [...draft.contacts];
                          next[index] = {
                            ...contact,
                            email: e.target.value,
                          };
                          patchDraft({ contacts: next });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={draft.contacts.length <= 1}
                        onClick={() => {
                          const next = draft.contacts.filter(
                            (_, i) => i !== index,
                          );
                          patchDraft({
                            contacts:
                              next.length > 0
                                ? next
                                : [{ name: "", mobile: "", email: "" }],
                          });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : tender.contacts.length === 0 ? (
                <p className="text-sm text-foreground-500">No contacts listed.</p>
              ) : (
                <ul className="space-y-3">
                  {tender.contacts.map((c, i) => (
                    <li
                      key={`${c.name}-${i}`}
                      className="rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <p className="font-medium">{c.name || "—"}</p>
                      <p className="text-foreground-500">
                        {[c.mobile, c.email].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Bid Decision">
              <dl className="space-y-3">
                <FieldRow label="Status">
                  {statusBadge ? (
                    <StatusBadge status={statusBadge} size="sm" />
                  ) : (
                    <span className="text-foreground-500">Not evaluated</span>
                  )}
                  <span className="ml-2 text-xs text-foreground-500">
                    {displayStatus
                      ? STATUS_DISPLAY_LABELS[displayStatus]
                      : "—"}
                  </span>
                </FieldRow>
                <FieldRow label="Decision reason">
                  {editing ? (
                    <Textarea
                      value={draft.decisionReason}
                      onChange={(e) =>
                        patchDraft({ decisionReason: e.target.value })
                      }
                      rows={3}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap font-normal text-foreground-700">
                      {tender.decisionReason ||
                        tender.qualification?.reason ||
                        "—"}
                    </p>
                  )}
                </FieldRow>
                {showLost || (editing && draft.qualificationStatus === "LOST") ? (
                  <FieldRow label="Lost reason">
                    {editing ? (
                      <Textarea
                        value={draft.lostReason}
                        onChange={(e) =>
                          patchDraft({ lostReason: e.target.value })
                        }
                        rows={2}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap font-normal">
                        {tender.lostReason || "—"}
                      </p>
                    )}
                  </FieldRow>
                ) : null}
                {showDisqualified ||
                (editing && draft.qualificationStatus === "DISQUALIFIED") ? (
                  <FieldRow label="Disqualification reason">
                    {editing ? (
                      <Textarea
                        value={draft.disqualificationReason}
                        onChange={(e) =>
                          patchDraft({
                            disqualificationReason: e.target.value,
                          })
                        }
                        rows={2}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap font-normal">
                        {tender.disqualificationReason || "—"}
                      </p>
                    )}
                  </FieldRow>
                ) : null}
              </dl>
            </Card>

            <Card title="Financial Details">
              <dl className="space-y-3">
                <FieldRow label="Estimated value">
                  {editing ? (
                    <Input
                      value={draft.tenderValue}
                      onChange={(e) =>
                        patchDraft({ tenderValue: e.target.value })
                      }
                      placeholder="INR"
                    />
                  ) : (
                    <span title={valueLabel}>{moneyOrNil(tender.tenderValue)}</span>
                  )}
                </FieldRow>
                <FieldRow label="Tender est. cost">
                  {editing ? (
                    <Input
                      value={draft.tenderEstCost}
                      onChange={(e) =>
                        patchDraft({ tenderEstCost: e.target.value })
                      }
                    />
                  ) : (
                    moneyOrNil(tender.tenderEstCost)
                  )}
                </FieldRow>
                <FieldRow label="EMD">
                  {editing ? (
                    <Input
                      value={draft.emdAmount}
                      onChange={(e) =>
                        patchDraft({ emdAmount: e.target.value })
                      }
                    />
                  ) : (
                    <span title={emdLabel}>{moneyOrNil(tender.emdAmount)}</span>
                  )}
                </FieldRow>
                <FieldRow label="Tender fee">
                  {editing ? (
                    <Input
                      value={draft.tenderFee}
                      onChange={(e) =>
                        patchDraft({ tenderFee: e.target.value })
                      }
                    />
                  ) : (
                    moneyOrNil(tender.tenderFee)
                  )}
                </FieldRow>
                <FieldRow label="Processing fee">
                  {editing ? (
                    <Input
                      value={draft.processingFee}
                      onChange={(e) =>
                        patchDraft({ processingFee: e.target.value })
                      }
                    />
                  ) : (
                    moneyOrNil(tender.processingFee)
                  )}
                </FieldRow>
                <FieldRow label="Final cost">
                  {editing ? (
                    <Input
                      value={draft.finalCost}
                      onChange={(e) =>
                        patchDraft({ finalCost: e.target.value })
                      }
                    />
                  ) : (
                    moneyOrNotBid(tender.finalCost)
                  )}
                </FieldRow>
              </dl>
            </Card>

            <Card title="Exemptions">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {editing ? (
                      <Checkbox
                        checked={draft.msmeExemption}
                        onCheckedChange={(checked) =>
                          patchDraft({ msmeExemption: checked === true })
                        }
                        id="msme-exemption"
                      />
                    ) : null}
                    <Label htmlFor="msme-exemption" className="text-sm font-medium">
                      MSME
                    </Label>
                  </div>
                  <ApplicablePill
                    applicable={
                      editing ? draft.msmeExemption : tender.msmeExemption
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {editing ? (
                      <Checkbox
                        checked={draft.startupExemption}
                        onCheckedChange={(checked) =>
                          patchDraft({ startupExemption: checked === true })
                        }
                        id="startup-exemption"
                      />
                    ) : null}
                    <Label
                      htmlFor="startup-exemption"
                      className="text-sm font-medium"
                    >
                      Startup
                    </Label>
                  </div>
                  <ApplicablePill
                    applicable={
                      editing
                        ? draft.startupExemption
                        : tender.startupExemption
                    }
                  />
                </div>

                {(editing
                  ? draft.msmeExemption || draft.startupExemption
                  : tender.msmeExemption || tender.startupExemption) ? (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Exemption types
                    </p>
                    {editing ? (
                      <div className="flex flex-wrap gap-2">
                        {EXEMPTION_TYPES.map((type) => {
                          const active = draft.exemptionTypes.includes(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => {
                                const next = active
                                  ? draft.exemptionTypes.filter(
                                      (t) => t !== type,
                                    )
                                  : [...draft.exemptionTypes, type];
                                patchDraft({ exemptionTypes: next });
                              }}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium",
                                active
                                  ? "border-primary-300 bg-primary-50 text-primary-700"
                                  : "border-border text-foreground-500",
                              )}
                            >
                              {type}
                            </button>
                          );
                        })}
                      </div>
                    ) : tender.exemptionTypes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tender.exemptionTypes.map((type) => (
                          <span
                            key={type}
                            className="rounded-full border border-border px-2.5 py-0.5 text-xs"
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-500">—</p>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="Tender Notes">
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    Description
                  </p>
                  {editing ? (
                    <Textarea
                      value={draft.description}
                      onChange={(e) =>
                        patchDraft({ description: e.target.value })
                      }
                      rows={5}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">
                      {tender.description || "No tender description available."}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Notes</p>
                  {editing ? (
                    <Textarea
                      value={draft.notes}
                      onChange={(e) => patchDraft({ notes: e.target.value })}
                      rows={3}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">
                      {tender.notes || "—"}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <ClassificationWorkflow
              tenderId={tender.id}
              qualificationStatus={tender.qualificationStatus}
              submitted={tender.submitted}
              canClassify={canClassify}
              conditions={tender.qualification?.conditions ?? []}
              partnershipRequiredFor={
                tender.qualification?.partnershipRequiredFor ?? []
              }
            />
          </div>
        </div>
      ) : null}

      {tab === "analyzer" ? (
        <TenderAnalyzerPanels tender={tender} compact />
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-6">
          <DocumentSection
            title="Tender Documents"
            locked={false}
            items={tenderSectionDocs}
            canEdit={canEdit}
            uploading={uploadPending}
            onUpload={(file) => uploadSectionDoc("tender", file)}
            onDelete={handleDeleteDoc}
          />

          <DocumentSection
            title="Bidding Documents"
            locked={!canAccessBiddingDocuments(tender.qualificationStatus)}
            lockReason={biddingDocumentsLockReason(tender.qualificationStatus)}
            items={sectionDocs("bidding")}
            canEdit={canEdit}
            uploading={uploadPending}
            onUpload={(file) => uploadSectionDoc("bidding", file)}
            onDelete={handleDeleteDoc}
          />

          <DocumentSection
            title="Financials"
            locked={!canAccessFinancialDocuments(tender.qualificationStatus)}
            lockReason={financialDocumentsLockReason(
              tender.qualificationStatus,
            )}
            items={sectionDocs("financial")}
            canEdit={canEdit}
            uploading={uploadPending}
            onUpload={handleFinancialUpload}
            onDelete={handleDeleteDoc}
            headerActions={
              canCreateFee && eligibleTender ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFeeWizardOpen(true)}
                >
                  <Plus className="size-3.5" />
                  Add Fees
                </Button>
              ) : null
            }
          />

          <DocumentSection
            title="Project Deliverables"
            locked={!canAccessDeliverables(tender.qualificationStatus)}
            lockReason={deliverablesLockReason(tender.qualificationStatus)}
            items={sectionDocs("deliverable")}
            canEdit={canEdit}
            uploading={uploadPending}
            onUpload={(file) => uploadSectionDoc("deliverable", file)}
            onDelete={handleDeleteDoc}
          />

          {eligibleTender ? (
            <AddFeeWizard
              open={feeWizardOpen}
              onOpenChange={setFeeWizardOpen}
              eligibleTenders={[eligibleTender]}
              preselectTenderId={tender.id}
              suggestedAmounts={{
                emd: tender.emdAmount,
                tender_fee: tender.tenderFee,
                processing: tender.processingFee,
              }}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "timeline" ? <TimelineTab tender={tender} /> : null}
    </div>
  );
}

function TimelineTab({ tender }: { tender: TenderDetailDTO }) {
  if (tender.activity.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
          Timeline
        </h2>
        <p className="mt-6 text-sm text-foreground-500">
          No activity recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
        Timeline
      </h2>
      <ol className="mt-4 space-y-3">
        {tender.activity.map((event) => (
          <li key={event.id} className="flex gap-3">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground-900">
                {event.summary}
              </p>
              <p className="text-xs text-foreground-500">
                {formatRelativeTime(event.createdAt)}
                {event.actorName ? ` · ${event.actorName}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
