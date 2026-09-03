import { notFound } from "next/navigation";

import { TenderDetailClient } from "@/components/tenders/tender-detail-client";
import { ErrorState } from "@/components/ui/error-state";
import type { FeeEligibleTender } from "@/components/bid-fees/add-fee-wizard";
import {
  createCorrelationId,
  logDiagnostic,
  toAppError,
} from "@/lib/errors/app-error";
import { canCreateFeeForTender } from "@/lib/tender-document-access";
import type { BidFeeRecord, TenderDocumentRecord } from "@/lib/bid-fees";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import {
  listBidFees,
  listTenderDocuments,
} from "@/server/repositories/bidFeeRepository";
import { loadTenderDetailSafe } from "@/server/tenders/load-tender-detail";

type TenderDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TenderDetailPage({
  params,
}: TenderDetailPageProps) {
  const correlationId = createCorrelationId();
  const session = await requireSession();
  const { id } = await params;
  const companyId = session.user.companyId;
  if (!companyId) notFound();

  logDiagnostic({
    level: "info",
    event: "tender_detail_page_start",
    correlationId,
    operation: "TenderDetailPage",
    tenderId: id,
    userId: session.user.id,
    companyId,
    role: session.user.role,
    sessionExists: true,
    sessionExpiresAt: session.expiresAt,
  });

  const loaded = await loadTenderDetailSafe({
    tenderId: id,
    companyId,
    userId: session.user.id,
    role: session.user.role,
    sessionExpiresAt: session.expiresAt,
    correlationId,
  });

  if (!loaded.ok && loaded.kind === "not_found") {
    notFound();
  }

  if (!loaded.ok) {
    return (
      <div className="space-y-4 py-6">
        <ErrorState
          title="Unable to load this tender"
          message={
            loaded.publicMessage ||
            "Something went wrong while loading tender details."
          }
          correlationId={loaded.correlationId}
        />
      </div>
    );
  }

  const tender = loaded.tender;

  let documents: TenderDocumentRecord[] = [];
  let documentsError: { message: string; correlationId: string } | null = null;
  let fees: BidFeeRecord[] = [];

  try {
    documents = await listTenderDocuments({ companyId, tenderId: id });
    logDiagnostic({
      level: "info",
      event: "tender_documents_load_ok",
      correlationId,
      operation: "listTenderDocuments",
      tenderId: id,
      userId: session.user.id,
      companyId,
      ok: true,
      documentCount: documents.length,
    });
  } catch (error) {
    const appError = toAppError(error, {
      publicMessage: "Documents could not be loaded for this tender.",
    });
    documentsError = {
      message: appError.publicMessage,
      correlationId: appError.correlationId,
    };
    logDiagnostic({
      level: "error",
      event: "tender_documents_load_failed",
      correlationId: appError.correlationId,
      operation: "listTenderDocuments",
      tenderId: id,
      userId: session.user.id,
      companyId,
      message: appError.message,
      ok: false,
    });
  }

  try {
    fees = await listBidFees({ companyId, tenderId: id });
  } catch (error) {
    logDiagnostic({
      level: "warn",
      event: "tender_fees_load_failed",
      correlationId,
      operation: "listBidFees",
      tenderId: id,
      userId: session.user.id,
      companyId,
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    });
    fees = [];
  }

  const eligibleTender: FeeEligibleTender | null = canCreateFeeForTender(
    tender.qualificationStatus,
  )
    ? {
        id: tender.id,
        title: tender.title,
        sourceTenderId: tender.sourceTenderId,
        referenceNo: tender.referenceNo,
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
      documentsError={documentsError}
      fees={fees}
      eligibleTender={eligibleTender}
      canEdit={sessionHasPermission(session, "tenders.edit")}
      canCreateFee={sessionHasPermission(session, "bids.create")}
    />
  );
}
