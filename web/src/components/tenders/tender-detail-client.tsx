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
  Briefcase,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  FileText,
  FolderOpen,
  Gavel,
  Hash,
  LayoutGrid,
  Link2,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  User,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AddFeeWizard,
  type FeeEligibleTender,
} from "@/components/bid-fees/add-fee-wizard";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
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
import {
  duplicateMatchKindLabel,
  formatDuplicateReference,
} from "@/lib/duplicate-reference";
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
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "documents", label: "Documents", icon: FolderOpen },
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

function SectionCard({
  title,
  icon: Icon,
  children,
  className,
  actions,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
            <Icon className="size-3.5" aria-hidden />
          </div>
          <h2 className="truncate text-sm font-semibold text-foreground-900">
            {title}
          </h2>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="mx-5 border-b border-border" />
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {children}
    </div>
  );
}

function InfoRow({
  label,
  icon: Icon,
  children,
  highlight,
  warn,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "text-[13px] font-medium leading-snug text-foreground-900",
          highlight && "text-primary-600",
          warn && "text-rose-600",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DecisionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
      <dt className="w-full shrink-0 text-[11px] text-muted-foreground sm:w-[104px] sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13px] font-medium text-foreground-900">
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
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        applicable
          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border border-stone-200 bg-stone-100 text-stone-600",
      )}
    >
      {applicable ? "Applicable" : "Not Applicable"}
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

function downloadAllDocuments(items: DocRowItem[]) {
  const downloadable = items.filter((item) => item.url);
  if (downloadable.length === 0) {
    toast.message("No downloadable files in this section.");
    return;
  }
  for (const doc of downloadable) {
    const anchor = document.createElement("a");
    anchor.href = doc.url!;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.download = doc.name;
    anchor.click();
  }
}

function DocumentSection({
  title,
  subtitle,
  locked,
  lockReason,
  items,
  canEdit,
  uploading,
  onUpload,
  onDelete,
  headerActions,
  showUpload = true,
  showDownloadAll = false,
}: {
  title: string;
  subtitle?: string;
  locked: boolean;
  lockReason?: string;
  items: DocRowItem[];
  canEdit: boolean;
  uploading: boolean;
  onUpload?: (file: File) => void;
  onDelete?: (documentId: string) => void;
  headerActions?: ReactNode;
  showUpload?: boolean;
  showDownloadAll?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (locked) {
    return (
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                <FolderOpen className="size-3.5" aria-hidden />
              </div>
              <h2 className="text-sm font-semibold text-foreground-900">
                {title}
              </h2>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                Locked
              </span>
            </div>
            {subtitle ? (
              <p className="mt-1 pl-9 text-[11px] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mx-5 border-b border-border" />
        <div className="px-5 py-4">
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-background-50 px-4 py-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Lock className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground-800">
                Section locked
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {lockReason ||
                  "This section is locked for the current tender status."}
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
              <FolderOpen className="size-3.5" aria-hidden />
            </div>
            <h2 className="text-sm font-semibold text-foreground-900">
              {title}
            </h2>
          </div>
          {subtitle ? (
            <p className="mt-1 pl-9 text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {showUpload && canEdit && onUpload ? (
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
                className="h-8 gap-1.5 text-xs"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </>
          ) : null}
          {showDownloadAll && items.some((item) => item.url) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => downloadAllDocuments(items)}
            >
              <Download className="size-3.5" />
              Download All
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mx-5 border-b border-border" />

      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No documents in this section yet.
        </p>
      ) : (
        <div className="px-5 py-4">
          <ul className="max-h-[360px] space-y-2 overflow-y-auto rounded-lg border border-border/70 bg-background-50/50 p-2">
            {items.map((doc) => (
              <li
                key={doc.key}
                className="group flex min-w-0 items-center gap-3 rounded-lg border border-border/80 bg-white px-3 py-3"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <FileText className="size-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground-900">
                    {doc.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {doc.sizeLabel}
                    {doc.meta ? ` · ${doc.meta}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-stone-100 hover:text-foreground-800"
                      aria-label={`Download ${doc.name}`}
                    >
                      <Download className="size-4" />
                    </a>
                  ) : (
                    <span className="px-1 text-[11px] text-foreground-400">
                      No link
                    </span>
                  )}
                  {canEdit && doc.deletableId && onDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 text-rose-600 opacity-0 transition-opacity hover:text-rose-700 group-hover:opacity-100"
                      aria-label={`Delete ${doc.name}`}
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
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function TenderDetailClient({
  tender,
  documents,
  fees,
  eligibleTender,
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
  const urgent = days != null && days >= 0 && days <= 7;

  const breadcrumbId = tender.folderId || tender.sourceTenderId;
  const displayStatus = editing
    ? draft.qualificationStatus || null
    : tender.qualificationStatus;
  const statusBadge = toStatusBadge(displayStatus);
  const duplicateReference = formatDuplicateReference({
    duplicateOfSourceTenderId: tender.duplicateOfSourceTenderId,
    duplicateOfTenderId: tender.duplicateOfTenderId,
    duplicateMatchKind: tender.duplicateMatchKind,
    screeningReason: tender.decisionReason || tender.qualification?.reason,
    sourcePortal: tender.sourcePortal,
  });
  const duplicateKindLabel = duplicateReference?.matchKind
    ? duplicateMatchKindLabel(duplicateReference.matchKind)
    : null;

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
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            href="/tenders"
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground-900"
          >
            <ArrowLeft className="size-4" />
            Tenders
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <span
            className="truncate font-medium text-foreground-900"
            title={breadcrumbId ?? undefined}
          >
            {breadcrumbId}
          </span>
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={pending}
                  onClick={handleCancelEdit}
                  aria-label="Cancel edit"
                >
                  <X className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
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
                size="icon"
                className="size-9 shrink-0"
                onClick={() => {
                  setDraft(buildDraft(tender));
                  setEditing(true);
                }}
                aria-label="Edit tender"
              >
                <Pencil className="size-4" />
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2.5">
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
                <span className="rounded border border-border px-2 py-0.5 text-[11px] font-medium text-foreground-600">
                  {editing
                    ? draft.tenderType || tender.tenderType
                    : tender.tenderType}
                </span>
              ) : null}
            </div>

            {editing ? (
              <Input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className="h-auto py-2 text-lg font-semibold leading-snug md:text-xl"
              />
            ) : (
              <h1 className="text-lg font-semibold leading-snug text-foreground-900 md:text-xl">
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
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {tender.authority || tender.organization || "—"}
                </span>
              </p>
            )}
          </div>

          <div className="flex w-full flex-col items-stretch gap-2.5 lg:w-[248px] lg:shrink-0">
            <div className="flex justify-center">
              <Label className="sr-only">Status</Label>
              <Select
                value={statusSelectValue}
                onValueChange={handleStatusChange}
                disabled={(!canEdit && !editing) || statusPending || pending}
              >
                <SelectTrigger className="h-9 w-full rounded-full border-border bg-background px-4 text-sm font-medium shadow-sm">
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
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">

      </div>

      <div className="inline-flex w-fit max-w-full items-center gap-1 rounded-lg bg-stone-100 p-1">
        {TABS.map((item) => {
          const TabIcon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                tab === item.id
                  ? "bg-[#e8e2d6] text-foreground-900 shadow-sm"
                  : "text-muted-foreground hover:text-foreground-800",
              )}
            >
              <TabIcon className="size-3.5 shrink-0" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <SectionCard title="Tender Information" icon={FileText}>
              <InfoGrid>
                <InfoRow label="Tender ID" icon={Hash} highlight>
                  <ReadonlyText value={tender.sourceTenderId} />
                </InfoRow>
                <InfoRow label="Reference No." icon={Hash}>
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
                </InfoRow>
                <InfoRow label="Portal" icon={Tag}>
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
                </InfoRow>
                <InfoRow label="Tender Type" icon={ClipboardList}>
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
                </InfoRow>
                <InfoRow label="Category" icon={Tag}>
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
                </InfoRow>
                <InfoRow label="Portal Link" icon={Link2}>
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
                      className="block truncate font-medium text-primary-600 hover:underline"
                      title={tender.sourceUrl}
                    >
                      {tender.sourceUrl}
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </InfoRow>
                <InfoRow label="Creation Date" icon={Clock}>
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
                </InfoRow>
                <InfoRow
                  label="Deadline"
                  icon={Clock}
                  warn={urgent && !closed}
                >
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
                </InfoRow>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Organization Details" icon={Building2}>
              <InfoGrid>
                <InfoRow label="Organization" icon={Building2}>
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
                </InfoRow>
                <InfoRow label="Location" icon={Building2}>
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
                </InfoRow>
              </InfoGrid>
            </SectionCard>

            <SectionCard
              title="Contact Details"
              icon={Users}
              actions={
                editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
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
                      className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background-50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
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
                <p className="text-sm text-muted-foreground">
                  No contacts listed.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tender.contacts.map((c, i) => (
                    <li
                      key={`${c.name}-${i}`}
                      className="flex min-w-0 items-start gap-3 rounded-lg border border-border/80 bg-background-50 p-3"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background-200 text-foreground-600">
                        <User className="size-4" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground-900">
                          {c.name || "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[c.mobile, c.email].filter(Boolean).join(" · ") ||
                            "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Bid Decision" icon={Gavel}>
              <dl className="space-y-4">
                <DecisionRow label="Current Status">
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge ? (
                      <StatusBadge status={statusBadge} size="sm" />
                    ) : (
                      <span className="font-normal text-muted-foreground">
                        Not evaluated
                      </span>
                    )}
                  </div>
                </DecisionRow>
                <DecisionRow label="Decision Reason">
                  {editing ? (
                    <Textarea
                      value={draft.decisionReason}
                      onChange={(e) =>
                        patchDraft({ decisionReason: e.target.value })
                      }
                      rows={3}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap font-normal leading-relaxed text-foreground-700">
                      {tender.decisionReason ||
                        tender.qualification?.reason ||
                        "—"}
                    </p>
                  )}
                </DecisionRow>
                {displayStatus === "DUPLICATE" && duplicateReference ? (
                  <DecisionRow label="Duplicate of">
                    <div className="space-y-1 font-normal leading-relaxed text-foreground-700">
                      {duplicateKindLabel ? (
                        <p className="text-sm text-foreground-500">
                          {duplicateKindLabel}
                        </p>
                      ) : null}
                      {duplicateReference.href ? (
                        <Link
                          href={duplicateReference.href}
                          className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:underline"
                        >
                          <Link2 className="size-3.5 shrink-0" aria-hidden />
                          {duplicateReference.label}
                        </Link>
                      ) : (
                        <p className="text-sm">{duplicateReference.label}</p>
                      )}
                    </div>
                  </DecisionRow>
                ) : null}
                {showLost ||
                (editing && draft.qualificationStatus === "LOST") ? (
                  <DecisionRow label="Lost Reason">
                    {editing ? (
                      <Textarea
                        value={draft.lostReason}
                        onChange={(e) =>
                          patchDraft({ lostReason: e.target.value })
                        }
                        rows={2}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap font-normal leading-relaxed">
                        {tender.lostReason || "—"}
                      </p>
                    )}
                  </DecisionRow>
                ) : null}
                {showDisqualified ||
                (editing && draft.qualificationStatus === "DISQUALIFIED") ? (
                  <DecisionRow label="Disqualification">
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
                      <p className="whitespace-pre-wrap font-normal leading-relaxed">
                        {tender.disqualificationReason || "—"}
                      </p>
                    )}
                  </DecisionRow>
                ) : null}
              </dl>
            </SectionCard>
          </div>

          <div className="space-y-5">
            <SectionCard title="Financial Details" icon={Wallet}>
              <InfoGrid>
                <InfoRow label="Estimated Value" icon={Wallet}>
                  {editing ? (
                    <Input
                      value={draft.tenderValue}
                      onChange={(e) =>
                        patchDraft({ tenderValue: e.target.value })
                      }
                      placeholder="INR"
                    />
                  ) : (
                    <span title={valueLabel}>
                      {moneyOrNil(tender.tenderValue)}
                    </span>
                  )}
                </InfoRow>
                <InfoRow label="Tender Est. Cost" icon={Wallet}>
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
                </InfoRow>
                <InfoRow label="EMD" icon={Wallet}>
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
                </InfoRow>
                <InfoRow label="Tender Fee" icon={Wallet}>
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
                </InfoRow>
                <InfoRow label="Processing Fee" icon={Wallet}>
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
                </InfoRow>
                <InfoRow
                  label="Final Cost / Bid Value"
                  icon={Wallet}
                  highlight={!editing && tender.finalCost == null}
                >
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
                </InfoRow>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Exemptions & Benefits" icon={ShieldCheck}>
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {editing ? (
                        <Checkbox
                          checked={draft.msmeExemption}
                          onCheckedChange={(checked) =>
                            patchDraft({ msmeExemption: checked === true })
                          }
                          id="msme-exemption"
                        />
                      ) : null}
                      <Label
                        htmlFor="msme-exemption"
                        className="text-sm font-medium"
                      >
                        <span className="text-muted-foreground">•</span> MSME
                        Exemption
                      </Label>
                    </div>
                    <ApplicablePill
                      applicable={
                        editing ? draft.msmeExemption : tender.msmeExemption
                      }
                    />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {editing
                      ? draft.msmeExemption
                        ? "MSME exemption is marked as applicable for this tender."
                        : "No MSME exemption available for this tender."
                      : tender.msmeExemption
                        ? "MSME exemption is applicable for this tender."
                        : "No MSME exemption available for this tender."}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
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
                        <span className="text-muted-foreground">•</span>{" "}
                        Startup India Exemption
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
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {editing
                      ? draft.startupExemption
                        ? "Startup India exemption is marked as applicable."
                        : "No Startup India exemption available for this tender."
                      : tender.startupExemption
                        ? "Startup India exemption is applicable for this tender."
                        : "No Startup India exemption available for this tender."}
                  </p>
                </div>

                {(editing
                  ? draft.msmeExemption || draft.startupExemption
                  : tender.msmeExemption || tender.startupExemption) ? (
                  <div>
                    <p className="mb-2 text-[11px] text-muted-foreground">
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
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard title="Tender Notes" icon={NotebookPen}>
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      Description
                    </p>
                    <Textarea
                      value={draft.description}
                      onChange={(e) =>
                        patchDraft({ description: e.target.value })
                      }
                      rows={5}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      Notes
                    </p>
                    <Textarea
                      value={draft.notes}
                      onChange={(e) => patchDraft({ notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                </div>
              ) : (
                <p
                  className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground-700"
                  title={tender.description || tender.notes || undefined}
                >
                  {tender.description ||
                    tender.notes ||
                    "No tender notes available."}
                </p>
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-5">
          <DocumentSection
            title="Tender Documents"
            subtitle="Official documents issued by the buyer"
            locked={false}
            items={tenderSectionDocs}
            canEdit={canEdit}
            uploading={uploadPending}
            showDownloadAll
            onUpload={(file) => uploadSectionDoc("tender", file)}
            onDelete={handleDeleteDoc}
          />

          <DocumentSection
            title="Bidding Documents"
            subtitle="Your bid submission documents"
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
            subtitle="EMD, tender fee & performance bank guarantee"
            locked={!canAccessFinancialDocuments(tender.qualificationStatus)}
            lockReason={financialDocumentsLockReason(
              tender.qualificationStatus,
            )}
            items={sectionDocs("financial")}
            canEdit={canEdit}
            uploading={uploadPending}
            showUpload={false}
            onUpload={handleFinancialUpload}
            onDelete={handleDeleteDoc}
            headerActions={
              canCreateFee && eligibleTender ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
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
            subtitle="Documents delivered after winning the tender"
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
              </div>
  );
}
