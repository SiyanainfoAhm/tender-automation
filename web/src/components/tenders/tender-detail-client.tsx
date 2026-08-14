"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Sparkles,
} from "lucide-react";

import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { ClassificationWorkflow } from "@/components/tenders/classification-workflow";
import { TenderAnalyzerPanels } from "@/components/tenders/tender-analysis-panels";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { Button } from "@/components/ui/button";
import {
  formatDate,
  formatEmdAmount,
  formatRelativeTime,
  formatTenderValue,
} from "@/lib/format";
import { getCalendarDaysUntilDeadline } from "@/lib/tender-deadline";
import type { TenderDetailDTO } from "@/lib/tender-detail";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "analyzer", label: "Analyzer" },
  { id: "documents", label: "Documents" },
  { id: "timeline", label: "Timeline" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type TenderDetailClientProps = {
  tender: TenderDetailDTO;
  canClassify: boolean;
};

export function TenderDetailClient({
  tender,
  canClassify,
}: TenderDetailClientProps) {
  const [tab, setTab] = useState<TabId>("overview");
  const days = getCalendarDaysUntilDeadline(tender.closingDate);
  const closed = days != null && days < 0;
  const urgent = days != null && days >= 0 && days <= 3;
  const valueLabel = formatTenderValue({
    amount: tender.tenderValue,
    text: tender.tenderValueText,
  }).label;
  const emdLabel = formatEmdAmount({
    amount: tender.emdAmount,
    text: tender.emdText,
  }).label;

  const quickInfo = useMemo(
    () => [
      { label: "Tender Value", value: valueLabel },
      { label: "EMD", value: emdLabel },
      { label: "Published", value: formatDate(tender.publishedDate) },
      { label: "Deadline", value: formatDate(tender.closingDate) },
      { label: "Location", value: tender.location || "—" },
      { label: "Reference No.", value: tender.sourceTenderId || "—" },
    ],
    [
      emdLabel,
      tender.closingDate,
      tender.location,
      tender.publishedDate,
      tender.sourceTenderId,
      valueLabel,
    ],
  );

  return (
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
        <span className="truncate font-medium text-foreground-900">
          {tender.sourceTenderId}
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
              ) : (
                <span className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground-500">
                  New
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold leading-snug md:text-xl">
              {tender.title}
            </h1>
            <p className="text-sm text-foreground-500">
              {tender.authority || tender.organization || "—"}
            </p>
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

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5 md:grid-cols-3 lg:grid-cols-6">
          {quickInfo.map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 truncate text-sm font-semibold" title={item.value}>
                {item.value}
              </p>
            </div>
          ))}
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
            <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
                Tender Description
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">
                {tender.description || "No tender description available."}
              </p>
            </section>
            <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
                Scope of Work
              </h2>
              {tender.scopeText ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">
                  {tender.scopeText}
                </p>
              ) : (
                <p className="mt-3 text-sm text-foreground-500">
                  No scope of work is available in the stored tender record.
                </p>
              )}
            </section>
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

      {tab === "analyzer" ? <TenderAnalyzerPanels tender={tender} compact /> : null}

      {tab === "documents" ? <DocumentsTab tender={tender} /> : null}

      {tab === "timeline" ? <TimelineTab tender={tender} /> : null}
    </div>
  );
}

function DocumentsTab({ tender }: { tender: TenderDetailDTO }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
          Tender Documents
        </h2>
        <Button variant="outline" size="sm" disabled title="Coming soon">
          <Download className="size-3.5" />
          Download All
        </Button>
      </div>
      {tender.archiveDocuments.length === 0 ? (
        <p className="mt-6 text-sm text-foreground-500">
          No tender documents are available in the web archive for this record.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {tender.archiveDocuments.map((doc) => (
            <li key={doc.name} className="flex items-center gap-3 py-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="text-xs text-foreground-500">
                  {doc.kind}
                  {doc.sizeLabel ? ` · ${doc.sizeLabel}` : ""}
                </p>
              </div>
              {doc.downloadable ? (
                <Download className="size-4 text-foreground-400" />
              ) : (
                <span className="text-[11px] text-foreground-400">
                  Archive only
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelineTab({ tender }: { tender: TenderDetailDTO }) {
  if (tender.activity.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
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
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
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
