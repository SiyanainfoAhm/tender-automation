import { describe, expect, it } from "vitest";

import type { BidFeeRecord } from "@/lib/bid-fees";
import {
  buildFinancialExposureFromBidFees,
  getEmdCommitted,
  isFinanciallyActiveBidFee,
} from "@/lib/dashboard/financial-metrics";

function sampleFee(
  overrides: Partial<BidFeeRecord> = {},
): BidFeeRecord {
  return {
    id: "fee-1",
    companyId: "company-1",
    tenderId: "tender-1",
    feeType: "emd",
    amount: 50_000,
    currency: "INR",
    status: "paid",
    paymentMode: "neft_rtgs",
    paymentDate: "2026-08-01",
    dueDate: null,
    refundable: true,
    notes: null,
    paymentReference: {},
    bgNumber: null,
    bankName: null,
    issueDate: null,
    expiryDate: null,
    claimPeriodDays: null,
    urn: null,
    pbgStatus: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard financial metrics", () => {
  it("returns zero EMD committed when no bid fees exist", () => {
    expect(getEmdCommitted([])).toBe(0);
    const exposure = buildFinancialExposureFromBidFees([]);
    expect(exposure.totalFees).toBe(0);
    expect(exposure.breakdown.find((row) => row.key === "emd")).toMatchObject({
      count: 0,
      totalValue: 0,
    });
  });

  it("counts only active EMD bid fees, not returned fees", () => {
    const fees = [
      sampleFee({ id: "fee-1", amount: 50_000, status: "paid" }),
      sampleFee({ id: "fee-2", amount: 15_00_000, status: "refunded" }),
    ];
    expect(getEmdCommitted(fees)).toBe(50_000);
    expect(isFinanciallyActiveBidFee(fees[1]!)).toBe(false);
  });

  it("builds fee breakdown from persisted bid fees only", () => {
    const fees = [
      sampleFee({ id: "fee-1", feeType: "tender_fee", amount: 5_000 }),
      sampleFee({ id: "fee-2", feeType: "emd", amount: 50_000 }),
      sampleFee({
        id: "fee-3",
        feeType: "pbg",
        amount: 2_00_000,
        pbgStatus: "active",
        expiryDate: "2026-12-01",
      }),
    ];
    const exposure = buildFinancialExposureFromBidFees(fees);
    expect(exposure.totalFees).toBe(2_55_000);
    expect(exposure.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "tender_fee", count: 1, totalValue: 5_000 }),
        expect.objectContaining({ key: "emd", count: 1, totalValue: 50_000 }),
        expect.objectContaining({ key: "pbg", count: 1, totalValue: 2_00_000 }),
      ]),
    );
  });

  it("calculates refundable outstanding separately from returned amounts", () => {
    const fees = [
      sampleFee({ id: "fee-1", amount: 50_000, refundable: true, status: "paid" }),
      sampleFee({ id: "fee-2", amount: 25_000, refundable: true, status: "refunded" }),
      sampleFee({ id: "fee-3", amount: 10_000, refundable: false, status: "paid" }),
    ];
    const exposure = buildFinancialExposureFromBidFees(fees);
    expect(exposure.refundable).toBe(50_000);
    expect(exposure.returned).toBe(25_000);
  });

  it("excludes expired PBG from active PBG totals", () => {
    const fees = [
      sampleFee({
        id: "pbg-active",
        feeType: "pbg",
        amount: 5_00_000,
        pbgStatus: "active",
        expiryDate: "2027-01-01",
      }),
      sampleFee({
        id: "pbg-expired",
        feeType: "pbg",
        amount: 5_00_000,
        pbgStatus: "active",
        expiryDate: "2020-01-01",
      }),
    ];
    const exposure = buildFinancialExposureFromBidFees(fees);
    expect(exposure.activePbg).toBe(5_00_000);
    expect(exposure.breakdown.find((row) => row.key === "pbg")).toMatchObject({
      count: 1,
      totalValue: 5_00_000,
    });
  });
});
