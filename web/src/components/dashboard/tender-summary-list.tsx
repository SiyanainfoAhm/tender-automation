import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatIndianCurrency } from "@/lib/format";

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
    <div className="flex h-full flex-col rounded-[14px] border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="section-title text-base">{title}</h3>
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
            className="border-0 bg-transparent py-6"
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
                  className="block rounded-[10px] border border-border bg-surface-secondary px-4 py-3 transition-colors hover:border-primary/30 hover:bg-primary-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 text-sm font-medium text-text-primary">
                      {String(item.title || "Untitled tender")}
                    </p>
                    {item.source_portal ? (
                      <SourceBadge
                        source={item.source_portal as TenderSource}
                        size="sm"
                      />
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
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
