import { notFound } from "next/navigation";

import { TenderDetailClient } from "@/components/tenders/tender-detail-client";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";

type TenderDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TenderDetailPage({
  params,
}: TenderDetailPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const tender = await loadTenderDetail({
    tenderId: id,
    companyId: session.user.companyId,
  });
  if (!tender) notFound();

  return (
    <TenderDetailClient
      tender={tender}
      canClassify={sessionHasPermission(session, "tenders.classify")}
    />
  );
}
