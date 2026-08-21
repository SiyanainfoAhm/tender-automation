import { notFound } from "next/navigation";

import { TenderDetailClient } from "@/components/tenders/tender-detail-client";
import { canCreateFeeForTender } from "@/lib/tender-document-access";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import {
  listBidFees,
  listTenderDocuments,
} from "@/server/repositories/bidFeeRepository";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";
import type { FeeEligibleTender } from "@/components/bid-fees/add-fee-wizard";

type TenderDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TenderDetailPage({
  params,
}: TenderDetailPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const companyId = session.user.companyId;
  if (!companyId) notFound();

  const tender = await loadTenderDetail({
    tenderId: id,
    companyId,
  });
  if (!tender) notFound();

  const [documents, fees] = await Promise.all([
    listTenderDocuments({ companyId, tenderId: id }).catch(() => []),
    listBidFees({ companyId, tenderId: id }).catch(() => []),
  ]);

  const eligibleTender: FeeEligibleTender | null = canCreateFeeForTender(
    tender.qualificationStatus,
  )
    ? {
        id: tender.id,
        title: tender.title,
        sourceTenderId: tender.sourceTenderId,
        referenceNo: tender.folderId,
        organization: tender.organization,
        emdAmount: tender.emdAmount,
        tenderValue: tender.tenderValue,
        qualificationStatus: tender.qualificationStatus,
      }
    : null;

  return (
    <TenderDetailClient
      tender={tender}
      documents={documents}
      fees={fees}
      eligibleTender={eligibleTender}
      canClassify={sessionHasPermission(session, "tenders.classify")}
      canEdit={sessionHasPermission(session, "tenders.edit")}
      canCreateFee={sessionHasPermission(session, "bids.create")}
    />
  );
}
