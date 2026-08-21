"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
  AddFeeWizard,
  type FeeEligibleTender,
} from "@/components/bid-fees/add-fee-wizard";
import { AllFeesTab } from "@/components/bid-fees/all-fees-tab";
import { FeeModal } from "@/components/bid-fees/fee-modal";
import { PbgTab } from "@/components/bid-fees/pbg-tab";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BID_FEE_TYPE_LABELS,
  BID_FEE_TYPES,
  type BidFeeRecord,
  type BidFeeType,
  type TenderDocumentRecord,
} from "@/lib/bid-fees";
import { formatIndianCurrency } from "@/lib/format";

export type { FeeEligibleTender };

type BidFeeSummaryView = {
  byType: Record<BidFeeType, { count: number; total: number }>;
  totalRefundable: number;
  totalRefunded: number;
  totalNonRefundable: number;
  totalAmount: number;
};

type BidFeesClientProps = {
  fees: BidFeeRecord[];
  summary: BidFeeSummaryView;
  eligibleTenders: FeeEligibleTender[];
  attachments: TenderDocumentRecord[];
  canCreate?: boolean;
  canEdit?: boolean;
};

export function BidFeesClient({
  fees,
  summary,
  eligibleTenders,
  attachments,
  canCreate = true,
  canEdit = true,
}: BidFeesClientProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [preselectFeeTypes, setPreselectFeeTypes] = useState<
    BidFeeType[] | undefined
  >(undefined);
  const [selectedFee, setSelectedFee] = useState<BidFeeRecord | null>(null);
  const [feeModalOpen, setFeeModalOpen] = useState(false);

  const totals = useMemo(
    () => [
      { label: "Total Refundable", value: summary.totalRefundable },
      { label: "Total Refunded", value: summary.totalRefunded },
      { label: "Total Non-Refundable", value: summary.totalNonRefundable },
      { label: "Total Amount", value: summary.totalAmount },
    ],
    [summary],
  );

  function openWizard(feeTypes?: BidFeeType[]) {
    setPreselectFeeTypes(feeTypes);
    setWizardOpen(true);
  }

  function openFee(fee: BidFeeRecord) {
    setSelectedFee(fee);
    setFeeModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bid Fees & Payments"
        subtitle="Track tender fees, EMD, processing charges, and performance guarantees."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => openWizard()}>
              <Plus className="size-4" />
              Add Fee
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {BID_FEE_TYPES.map((type) => {
          const bucket = summary.byType[type];
          return (
            <div
              key={type}
              className="rounded-lg border border-border bg-card p-4"
            >
              <p className="text-xs font-medium text-foreground-500">
                {BID_FEE_TYPE_LABELS[type]}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground-900">
                {formatIndianCurrency(bucket.total)}
              </p>
              <p className="mt-0.5 text-xs text-foreground-500">
                {bucket.count} record{bucket.count === 1 ? "" : "s"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totals.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border bg-card px-4 py-3"
          >
            <p className="text-xs font-medium text-foreground-500">
              {item.label}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground-900">
              {formatIndianCurrency(item.value)}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Fees</TabsTrigger>
          <TabsTrigger value="pbg">Performance Guarantees</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <AllFeesTab fees={fees} onView={openFee} />
        </TabsContent>
        <TabsContent value="pbg" className="mt-4">
          <PbgTab
            fees={fees}
            onView={openFee}
            onAddPbg={canCreate ? () => openWizard(["pbg"]) : undefined}
          />
        </TabsContent>
      </Tabs>

      <AddFeeWizard
        open={wizardOpen}
        onOpenChange={(next) => {
          setWizardOpen(next);
          if (!next) setPreselectFeeTypes(undefined);
        }}
        eligibleTenders={eligibleTenders}
        preselectFeeTypes={preselectFeeTypes}
      />

      <FeeModal
        open={feeModalOpen}
        onOpenChange={setFeeModalOpen}
        fee={selectedFee}
        attachments={attachments}
        canEdit={canEdit}
      />
    </div>
  );
}
