import { WillBidTestView } from "@/components/bid-workspace/will-bid-test-view";
import { requirePermission } from "@/server/auth/permissions";
import { listWillBidTenders } from "@/server/repositories/willBidRepository";

export const dynamic = "force-dynamic";

export default async function WillBidTestPage() {
  const session = await requirePermission("bids.view");
  if (!session.companyId) {
    return <p>Your account must be linked to a company to open Will Bid.</p>;
  }

  const tenders = await listWillBidTenders(session.companyId);
  return <WillBidTestView tenders={tenders} />;
}
