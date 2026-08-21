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
};

const PRIMARY = [
  {
    key: "totalTenders" as const,
    label: "Total Tenders",
    icon: FileText,
    iconClassName: "bg-sky-100 text-sky-700",
  },
  {
    key: "verify" as const,
    label: "Verify",
    icon: ShieldAlert,
    iconClassName: "bg-sky-100 text-sky-700",
  },
  {
    key: "underEvaluation" as const,
    label: "Under Evaluation",
    icon: Briefcase,
    iconClassName: "bg-slate-100 text-slate-700",
  },
  {
    key: "willBid" as const,
    label: "Will Bid",
    icon: Target,
    iconClassName: "bg-emerald-100 text-emerald-700",
  },
  {
    key: "mayBid" as const,
    label: "May Bid",
    icon: CheckCircle2,
    iconClassName: "bg-amber-100 text-amber-700",
  },
  {
    key: "noBid" as const,
    label: "No Bid",
    icon: FileText,
    iconClassName: "bg-rose-100 text-rose-700",
  },
];

const EXTRA = [
  {
    key: "partnership" as const,
    label: "Partnership",
    icon: Handshake,
    iconClassName: "bg-violet-100 text-violet-700",
  },
  {
    key: "submitted" as const,
    label: "Submitted",
    icon: Send,
    iconClassName: "bg-blue-100 text-blue-700",
  },
  {
    key: "closingSoon" as const,
    label: "Closing Soon",
    icon: Clock,
    iconClassName: "bg-rose-100 text-rose-700",
  },
  {
    key: "won" as const,
    label: "Won",
    icon: Trophy,
    iconClassName: "bg-emerald-100 text-emerald-800",
  },
];

export function TenderStatsCards({ counts }: TenderStatsCardsProps) {
  const [expanded, setExpanded] = useState(false);
  const cards = expanded ? [...PRIMARY, ...EXTRA] : PRIMARY;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <CompactKpiCard
            key={card.key}
            label={card.label}
            value={counts[card.key].toLocaleString("en-IN")}
            icon={card.icon}
            iconClassName={card.iconClassName}
          />
        ))}
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
