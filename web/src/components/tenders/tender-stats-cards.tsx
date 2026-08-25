"use client";

import { useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  Handshake,
  Send,
  ShieldAlert,
  Target,
  Trophy,
} from "lucide-react";

import { CompactKpiCard } from "@/components/tenders/compact-kpi-card";
import { Button } from "@/components/ui/button";
import type { TenderListStatusCounts } from "@/server/repositories/analyticsRepository";

type TenderStatsCardsProps = {
  counts: TenderListStatusCounts;
  /** Current URL status chip (`ALL` when none). */
  activeStatus?: string;
  onSelectStatus?: (status: string | undefined) => void;
  disabled?: boolean;
};

type CardDef = {
  key: keyof TenderListStatusCounts;
  label: string;
  icon: typeof FileText;
  iconClassName: string;
  /** URL `status` value; undefined clears the status filter (Total). */
  filterStatus?: string;
};

const PRIMARY: CardDef[] = [
  {
    key: "totalTenders",
    label: "Total Tenders",
    icon: FileText,
    iconClassName: "bg-sky-100 text-sky-700",
    filterStatus: undefined,
  },
  {
    key: "verify",
    label: "Verify",
    icon: ShieldAlert,
    iconClassName: "bg-sky-100 text-sky-700",
    filterStatus: "verify",
  },
  {
    key: "underEvaluation",
    label: "Under Evaluation",
    icon: Briefcase,
    iconClassName: "bg-slate-100 text-slate-700",
    filterStatus: "under_evaluation",
  },
  {
    key: "willBid",
    label: "Will Bid",
    icon: Target,
    iconClassName: "bg-emerald-100 text-emerald-700",
    filterStatus: "will_bid",
  },
  {
    key: "mayBid",
    label: "May Bid",
    icon: CheckCircle2,
    iconClassName: "bg-amber-100 text-amber-700",
    filterStatus: "may_bid",
  },
  {
    key: "noBid",
    label: "No Bid",
    icon: FileText,
    iconClassName: "bg-rose-100 text-rose-700",
    filterStatus: "no_bid",
  },
];

const EXTRA: CardDef[] = [
  {
    key: "partnership",
    label: "Partnership",
    icon: Handshake,
    iconClassName: "bg-violet-100 text-violet-700",
    filterStatus: "partnership",
  },
  {
    key: "submitted",
    label: "Submitted",
    icon: Send,
    iconClassName: "bg-blue-100 text-blue-700",
    filterStatus: "submitted",
  },
  {
    key: "closingSoon",
    label: "Closing Soon",
    icon: Clock,
    iconClassName: "bg-rose-100 text-rose-700",
    // No dedicated status filter — display-only in View More.
  },
  {
    key: "won",
    label: "Won",
    icon: Trophy,
    iconClassName: "bg-emerald-100 text-emerald-800",
    filterStatus: "won",
  },
];

function isCardActive(
  card: CardDef,
  activeStatus: string | undefined,
): boolean {
  const current =
    !activeStatus || activeStatus === "ALL" ? undefined : activeStatus;
  if (card.key === "totalTenders") return current === undefined;
  if (card.filterStatus === undefined) return false;
  return current === card.filterStatus;
}

export function TenderStatsCards({
  counts,
  activeStatus = "ALL",
  onSelectStatus,
  disabled = false,
}: TenderStatsCardsProps) {
  const [expanded, setExpanded] = useState(false);
  const cards = expanded ? [...PRIMARY, ...EXTRA] : PRIMARY;
  const interactive = typeof onSelectStatus === "function";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => {
          const clickable =
            interactive &&
            (card.key === "totalTenders" || card.filterStatus !== undefined);
          return (
            <CompactKpiCard
              key={card.key}
              label={card.label}
              value={counts[card.key].toLocaleString("en-IN")}
              icon={card.icon}
              iconClassName={card.iconClassName}
              active={isCardActive(card, activeStatus)}
              disabled={disabled}
              onClick={
                clickable
                  ? () => onSelectStatus?.(card.filterStatus)
                  : undefined
              }
            />
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-xs font-medium text-foreground-600"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "View Less" : "View More"}
        </Button>
      </div>
    </div>
  );
}
