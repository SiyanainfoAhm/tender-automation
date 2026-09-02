import { addDays, differenceInCalendarDays, parseISO, startOfDay } from "date-fns";

import {
  BID_FEE_TYPE_LABELS,
  type BidFeeRecord,
  type BidFeeStatus,
  type BidFeeType,
} from "@/lib/bid-fees";
import { formatIndianCurrency } from "@/lib/format";

import type {
  DashboardFeeBreakdownRow,
  DashboardFinancialExposure,
} from "./types";

const INACTIVE_FEE_STATUSES: ReadonlySet<BidFeeStatus> = new Set([
  "refunded",
  "released",
  "expired",
]);

const FEE_BREAKDOWN_TYPES: BidFeeType[] = [
  "tender_fee",
  "emd",
  "processing",
  "pbg",
];

function moneyLabel(value: number): string {
  if (value <= 0) return "₹0";
  return formatIndianCurrency(value);
}

/** Fee has been returned or released and no longer represents exposure. */
export function isReturnedOrReleasedBidFee(fee: BidFeeRecord): boolean {
  return fee.status === "refunded" || fee.status === "released";
}

/** Fee still represents money committed/outstanding on the dashboard. */
export function isFinanciallyActiveBidFee(fee: BidFeeRecord): boolean {
  return !INACTIVE_FEE_STATUSES.has(fee.status);
}

/** EMD / Bid Security fees that are paid/committed and not yet returned. */
export function isActiveEmdBidFee(fee: BidFeeRecord): boolean {
  return fee.feeType === "emd" && isFinanciallyActiveBidFee(fee);
}

export function getEmdCommitted(fees: BidFeeRecord[]): number {
  return fees
    .filter(isActiveEmdBidFee)
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getTotalActiveFees(fees: BidFeeRecord[]): number {
  return fees
    .filter(isFinanciallyActiveBidFee)
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getPendingFees(fees: BidFeeRecord[]): number {
  return fees
    .filter(
      (fee) =>
        isFinanciallyActiveBidFee(fee) &&
        (fee.status === "pending" || fee.status === "submitted"),
    )
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getRefundableOutstanding(fees: BidFeeRecord[]): number {
  return fees
    .filter((fee) => fee.refundable && isFinanciallyActiveBidFee(fee))
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getReturnedFeesTotal(fees: BidFeeRecord[]): number {
  return fees
    .filter(isReturnedOrReleasedBidFee)
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getActivePbgFees(
  fees: BidFeeRecord[],
  now = new Date(),
): BidFeeRecord[] {
  const today = startOfDay(now);
  return fees.filter((fee) => {
    if (fee.feeType !== "pbg") return false;
    if (!isFinanciallyActiveBidFee(fee)) return false;
    if (fee.pbgStatus === "released" || fee.pbgStatus === "expired") {
      return false;
    }
    if (fee.expiryDate) {
      const expiry = startOfDay(parseISO(fee.expiryDate));
      if (!Number.isNaN(expiry.getTime()) && expiry < today) {
        return false;
      }
    }
    return true;
  });
}

export function getActivePbgTotal(fees: BidFeeRecord[]): number {
  return getActivePbgFees(fees).reduce((sum, fee) => sum + fee.amount, 0);
}

export function getExpiredPbgFees(fees: BidFeeRecord[]): BidFeeRecord[] {
  return fees.filter(
    (fee) =>
      fee.feeType === "pbg" &&
      (fee.pbgStatus === "expired" ||
        fee.status === "expired" ||
        (fee.expiryDate != null &&
          differenceInCalendarDays(
            startOfDay(parseISO(fee.expiryDate)),
            startOfDay(new Date()),
          ) < 0)),
  );
}

export function getPbgExpiringWithin90Days(
  fees: BidFeeRecord[],
  now = new Date(),
): BidFeeRecord[] {
  const today = startOfDay(now);
  const horizon = addDays(today, 90);
  return getActivePbgFees(fees).filter((fee) => {
    if (!fee.expiryDate) return false;
    const expiry = startOfDay(parseISO(fee.expiryDate));
    if (Number.isNaN(expiry.getTime())) return false;
    return expiry >= today && expiry <= horizon;
  });
}

function buildFeeBreakdown(
  fees: BidFeeRecord[],
  maxValue: number,
): DashboardFeeBreakdownRow[] {
  return FEE_BREAKDOWN_TYPES.map((feeType) => {
    const activeFees = fees.filter(
      (fee) => fee.feeType === feeType && isFinanciallyActiveBidFee(fee),
    );
    const totalValue = activeFees.reduce((sum, fee) => sum + fee.amount, 0);
    return {
      key: feeType,
      label: BID_FEE_TYPE_LABELS[feeType],
      count: activeFees.length,
      totalValue,
      valueLabel: moneyLabel(totalValue),
      progress:
        maxValue > 0 ? Math.round((totalValue / maxValue) * 100) : 0,
    };
  });
}

/** Dashboard financial exposure from persisted Add Bid Fee records only. */
export function buildFinancialExposureFromBidFees(
  fees: BidFeeRecord[],
): DashboardFinancialExposure {
  const totalFees = getTotalActiveFees(fees);
  const pendingFees = getPendingFees(fees);
  const refundable = getRefundableOutstanding(fees);
  const returned = getReturnedFeesTotal(fees);
  const activePbgFees = getActivePbgFees(fees);
  const activePbg = getActivePbgTotal(fees);
  const expiredPbgFees = getExpiredPbgFees(fees);
  const pbgExpiring = getPbgExpiringWithin90Days(fees);
  const expiredPbg = expiredPbgFees.reduce((sum, fee) => sum + fee.amount, 0);
  const pbgExpiring90d = pbgExpiring.reduce((sum, fee) => sum + fee.amount, 0);

  const maxBreakdown = Math.max(
    1,
    ...FEE_BREAKDOWN_TYPES.map((feeType) =>
      fees
        .filter(
          (fee) => fee.feeType === feeType && isFinanciallyActiveBidFee(fee),
        )
        .reduce((sum, fee) => sum + fee.amount, 0),
    ),
  );

  return {
    totalFees,
    totalFeesLabel: moneyLabel(totalFees),
    pendingFees,
    pendingFeesLabel:
      pendingFees > 0 ? moneyLabel(pendingFees) : "No pending fees",
    refundable,
    refundableLabel:
      refundable > 0 ? moneyLabel(refundable) : "Nothing outstanding",
    returned,
    returnedLabel: moneyLabel(returned),
    activePbg,
    activePbgLabel:
      activePbg > 0
        ? moneyLabel(activePbg)
        : activePbgFees.length > 0
          ? `${activePbgFees.length} active guarantee${activePbgFees.length === 1 ? "" : "s"}`
          : "₹0",
    expiredPbg,
    expiredPbgLabel:
      expiredPbg > 0
        ? moneyLabel(expiredPbg)
        : expiredPbgFees.length > 0
          ? `${expiredPbgFees.length} expired`
          : "₹0",
    pbgExpiring90d,
    pbgExpiring90dLabel:
      pbgExpiring.length > 0
        ? moneyLabel(pbgExpiring90d)
        : "None",
    pbgExpiringCount: pbgExpiring.length,
    breakdown: buildFeeBreakdown(fees, maxBreakdown),
  };
}

export function financialExposureEmptySubtitles(
  exposure: DashboardFinancialExposure,
): {
  totalFeesSub: string;
  refundableSub: string;
  activePbgSub: string;
  pbgExpiringSub: string;
} {
  return {
    totalFeesSub:
      exposure.totalFees > 0
        ? `Pending ${exposure.pendingFeesLabel}`
        : "No bid fees recorded",
    refundableSub:
      exposure.refundable > 0
        ? `Returned ${exposure.returnedLabel}`
        : "Nothing outstanding",
    activePbgSub:
      exposure.activePbg > 0
        ? `Expired ${exposure.expiredPbgLabel}`
        : "No active guarantees",
    pbgExpiringSub:
      exposure.pbgExpiringCount > 0
        ? `${exposure.pbgExpiringCount} guarantee${exposure.pbgExpiringCount === 1 ? "" : "s"}`
        : "0 guarantees",
  };
}
