import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type TenderSummaryListProps = {
  title: string;
  items: Record<string, unknown>[];
  href: string;
  emptyTitle: string;
  emptyDescription: string;
};

export function TenderSummaryList({
  title,
  items,
  href,
  emptyTitle,
  emptyDescription,
}: TenderSummaryListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h3>
        <Link
          href={href}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="flex-1 p-4">
        {items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={emptyTitle}
            description={emptyDescription}
            className={cn(
              "min-h-[160px] max-h-[180px] justify-center border-0 bg-transparent py-5",
            )}
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const id = String(item.id);
              const status = item.effective_qualification_status as
                | QualificationStatus
                | null
                | undefined;
              return (
                <Link
                  key={id}
                  href={`/tenders/${id}`}
                  className="block rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary-muted/30 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-1 text-sm font-medium text-slate-900 dark:text-slate-50">
                      {String(item.title || "Untitled tender")}
                    </p>
                    {item.source_portal ? (
                      <SourceBadge
                        source={item.source_portal as TenderSource}
                        size="sm"
                      />
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {status ? (
                      <StatusBadge status={status} size="sm" />
                    ) : (
                      <span>Not evaluated</span>
                    )}
                    {item.closing_date ? (
                      <span>Closes {formatDate(String(item.closing_date))}</span>
                    ) : null}
                    {item.tender_value != null ? (
                      <span>{formatIndianCurrency(Number(item.tender_value))}</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
