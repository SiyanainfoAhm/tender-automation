"use client";

import { useMemo } from "react";
import { Eye, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BID_FEE_STATUS_LABELS,
  pbgExpiryTone,
  type BidFeeRecord,
} from "@/lib/bid-fees";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type PbgTabProps = {
  fees: BidFeeRecord[];
  onView: (fee: BidFeeRecord) => void;
  onAddPbg?: () => void;
};

const TONE_CLASS = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  orange: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-rose-50 text-rose-800 border-rose-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
} as const;

export function PbgTab({ fees, onView, onAddPbg }: PbgTabProps) {
  const pbgFees = useMemo(
    () => fees.filter((fee) => fee.feeType === "pbg"),
    [fees],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-foreground-500">
          Performance bank guarantees linked to won / submitted tenders.
        </p>
        {onAddPbg ? (
          <Button type="button" size="sm" onClick={onAddPbg}>
            <Plus className="size-4" />
            Add PBG
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium uppercase tracking-wide text-foreground-500">
                <th className="px-3 py-2.5">Tender</th>
                <th className="px-3 py-2.5">BG Number</th>
                <th className="px-3 py-2.5">Bank</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5">Issue</th>
                <th className="px-3 py-2.5">Expiry</th>
                <th className="px-3 py-2.5">URN</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pbgFees.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-10 text-center text-foreground-500"
                  >
                    No performance guarantees recorded yet.
                  </td>
                </tr>
              ) : (
                pbgFees.map((fee) => {
                  const tone = pbgExpiryTone(fee.expiryDate);
                  return (
                    <tr
                      key={fee.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface-muted/40"
                    >
                      <td className="px-3 py-2.5">
                        <div className="max-w-[240px] truncate font-medium text-foreground-900">
                          {fee.tenderTitle || "—"}
                        </div>
                        <div className="truncate text-xs text-foreground-500">
                          {fee.tenderReference || fee.tenderSourceId || ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fee.bgNumber || "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fee.bankName || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                        {formatIndianCurrency(fee.amount)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {formatDate(fee.issueDate)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                            TONE_CLASS[tone],
                          )}
                        >
                          {formatDate(fee.expiryDate)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fee.urn || "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fee.pbgStatus
                          ? fee.pbgStatus.charAt(0).toUpperCase() +
                            fee.pbgStatus.slice(1)
                          : BID_FEE_STATUS_LABELS[fee.status]}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onView(fee)}
                        >
                          <Eye className="size-4" />
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
