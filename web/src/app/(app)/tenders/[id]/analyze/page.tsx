import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";

import {
  AnalyzeRfpExtract,
  TenderAnalyzerPanels,
} from "@/components/tenders/tender-analysis-panels";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { formatDate } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";

type AnalyzePageProps = {
  params: Promise<{ id: string }>;
};

export default async function TenderAnalyzePage({ params }: AnalyzePageProps) {
  const session = await requireSession();
  const { id } = await params;
  const tender = await loadTenderDetail({
    tenderId: id,
    companyId: session.user.companyId,
  });
  if (!tender) notFound();

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
        <Link
          href={`/tenders/${tender.id}`}
          className="truncate text-foreground-500 hover:text-foreground-900"
        >
          {tender.sourceTenderId}
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
        <span className="shrink-0 font-medium">AI Qualification Analysis</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
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
        </div>
        <h1 className="mt-3 text-lg font-semibold leading-snug md:text-xl">
          {tender.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-500">
          {tender.authority || tender.organization || "—"}
        </p>
        <p className="mt-3 text-xs text-foreground-500">
          {tender.qualification?.qualifiedAt
            ? `Last analyzed ${formatDate(tender.qualification.qualifiedAt)}`
            : "Analysis unavailable"}
          {tender.qualification?.modelName
            ? ` · ${tender.qualification.modelName}`
            : ""}
        </p>
      </div>

      <AnalyzeRfpExtract tender={tender} />
      <TenderAnalyzerPanels tender={tender} />
    </div>
  );
}
