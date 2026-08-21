"use client";

import { useMemo, useState } from "react";
import { Eye, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BID_FEE_STATUS_LABELS,
  BID_FEE_STATUSES,
  BID_FEE_TYPE_LABELS,
  BID_FEE_TYPES,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  type BidFeeRecord,
  type BidFeeStatus,
  type BidFeeType,
  type PaymentMode,
} from "@/lib/bid-fees";
import { formatDate, formatIndianCurrency } from "@/lib/format";

type AllFeesTabProps = {
  fees: BidFeeRecord[];
  onView: (fee: BidFeeRecord) => void;
};

export function AllFeesTab({ fees, onView }: AllFeesTabProps) {
  const [q, setQ] = useState("");
  const [feeType, setFeeType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [paymentMode, setPaymentMode] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fees.filter((fee) => {
      if (feeType !== "all" && fee.feeType !== feeType) return false;
      if (status !== "all" && fee.status !== status) return false;
      if (paymentMode !== "all" && fee.paymentMode !== paymentMode) return false;
      if (fromDate && (!fee.paymentDate || fee.paymentDate < fromDate)) {
        return false;
      }
      if (toDate && (!fee.paymentDate || fee.paymentDate > toDate)) {
        return false;
      }
      if (!needle) return true;
      const hay = [
        fee.tenderTitle,
        fee.tenderSourceId,
        fee.tenderReference,
        fee.tenderOrganization,
        BID_FEE_TYPE_LABELS[fee.feeType],
        BID_FEE_STATUS_LABELS[fee.status],
        fee.paymentMode ? PAYMENT_MODE_LABELS[fee.paymentMode] : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [fees, q, feeType, status, paymentMode, fromDate, toDate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-500" />
          <Input
            className="pl-9"
            placeholder="Search tenders, org, fee type…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={feeType} onValueChange={setFeeType}>
          <SelectTrigger className="w-full lg:w-[160px]">
            <SelectValue placeholder="Fee type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {BID_FEE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {BID_FEE_TYPE_LABELS[t as BidFeeType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full lg:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {BID_FEE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {BID_FEE_STATUS_LABELS[s as BidFeeStatus]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentMode} onValueChange={setPaymentMode}>
          <SelectTrigger className="w-full lg:w-[180px]">
            <SelectValue placeholder="Payment mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modes</SelectItem>
            {PAYMENT_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {PAYMENT_MODE_LABELS[m as PaymentMode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-full lg:w-[150px]"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          aria-label="From date"
        />
        <Input
          type="date"
          className="w-full lg:w-[150px]"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          aria-label="To date"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium uppercase tracking-wide text-foreground-500">
                <th className="px-3 py-2.5">Tender</th>
                <th className="px-3 py-2.5">Fee Type</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Payment Mode</th>
                <th className="px-3 py-2.5">Payment Date</th>
                <th className="px-3 py-2.5">Due Date</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-foreground-500"
                  >
                    No fees match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((fee) => (
                  <tr
                    key={fee.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface-muted/40"
                  >
                    <td className="px-3 py-2.5">
                      <div className="max-w-[260px] truncate font-medium text-foreground-900">
                        {fee.tenderTitle || "—"}
                      </div>
                      <div className="truncate text-xs text-foreground-500">
                        {fee.tenderReference || fee.tenderSourceId || ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {BID_FEE_TYPE_LABELS[fee.feeType]}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                      {formatIndianCurrency(fee.amount)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {BID_FEE_STATUS_LABELS[fee.status]}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {fee.paymentMode
                        ? PAYMENT_MODE_LABELS[fee.paymentMode]
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {formatDate(fee.paymentDate)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {formatDate(fee.dueDate)}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
