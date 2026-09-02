import { BidFeesClient } from "@/components/bid-fees/bid-fees-client";
import type { FeeEligibleTender } from "@/components/bid-fees/add-fee-wizard";
import { getServerSupabase } from "@/lib/db/server";
import { canCreateFeeForTender } from "@/lib/tender-document-access";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import {
  listBidFees,
  listTenderDocuments,
  summarizeBidFees,
  type BidFeeSummary,
} from "@/server/repositories/bidFeeRepository";
import type { BidFeeRecord, TenderDocumentRecord } from "@/lib/bid-fees";

type TenderListRow = {
  id: string;
  title: string | null;
  source_tender_id: string | null;
  folder_id: string | null;
  reference_no: string | null;
  organization: string | null;
  tender_value: number | string | null;
  emd_amount: number | string | null;
  effective_qualification_status: string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadEligibleTenders(): Promise<FeeEligibleTender[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_web_tender_list")
    .select(
      "id, title, source_tender_id, folder_id, reference_no, organization, tender_value, emd_amount, effective_qualification_status",
    )
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  return ((data || []) as TenderListRow[])
    .filter((row) =>
      canCreateFeeForTender(row.effective_qualification_status),
    )
    .map((row) => ({
      id: row.id,
      title: row.title || "Untitled tender",
      sourceTenderId: row.source_tender_id || row.id,
      referenceNo: row.reference_no || null,
      organization: row.organization,
      emdAmount: toNumber(row.emd_amount),
      tenderValue: toNumber(row.tender_value),
      qualificationStatus: row.effective_qualification_status,
    }));
}

async function loadFeeAttachments(
  companyId: string,
  fees: BidFeeRecord[],
): Promise<TenderDocumentRecord[]> {
  const tenderIds = [...new Set(fees.map((fee) => fee.tenderId))];
  if (tenderIds.length === 0) return [];

  const batches = await Promise.all(
    tenderIds.map((tenderId) =>
      listTenderDocuments({
        companyId,
        tenderId,
        section: "financial",
      }),
    ),
  );

  const feeIds = new Set(fees.map((fee) => fee.id));
  return batches.flat().filter((doc) => doc.feeId && feeIds.has(doc.feeId));
}

export default async function BidFeesPage() {
  const session = await requireSession();
  const companyId = session.user.companyId;

  if (!companyId) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-foreground-500">
        Your account is not linked to a company, so bid fees cannot be loaded.
      </div>
    );
  }

  let fees: BidFeeRecord[] = [];
  let summary: BidFeeSummary = summarizeBidFees([]);
  let eligibleTenders: FeeEligibleTender[] = [];
  let attachments: TenderDocumentRecord[] = [];

  try {
    fees = await listBidFees({ companyId });
    summary = summarizeBidFees(fees);
    [eligibleTenders, attachments] = await Promise.all([
      loadEligibleTenders(),
      loadFeeAttachments(companyId, fees),
    ]);
  } catch (error) {
    return (
      <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        <p className="font-medium">Unable to load bid fees</p>
        <p>
          {error instanceof Error
            ? error.message
            : "An unexpected error occurred."}
        </p>
      </div>
    );
  }

  return (
    <BidFeesClient
      fees={fees}
      summary={summary}
      eligibleTenders={eligibleTenders}
      attachments={attachments}
      canCreate={sessionHasPermission(session, "bids.create")}
      canEdit={sessionHasPermission(session, "bids.edit")}
    />
  );
}
