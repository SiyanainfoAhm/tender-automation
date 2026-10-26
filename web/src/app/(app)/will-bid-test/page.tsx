import { WillBidTestView } from "@/components/bid-workspace/will-bid-test-view";
import { requirePermission } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function WillBidTestPage() {
  await requirePermission("bids.view");
  return <WillBidTestView />;
}
