import Link from "next/link";
import { Suspense } from "react";
import BidWorkspacePage from "../tenders/[id]/bid-workspace/page";
import { requirePermission } from "@/server/auth/permissions";
import { listWillBidTenders } from "@/server/repositories/willBidRepository";
import { formatDate } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function WillBidPage({ searchParams }: { searchParams: Promise<{ tender?: string }> }) {
  const session = await requirePermission("bids.view");
  if (!session.companyId) return <p>Your account must be linked to a company to open Will Bid.</p>;
  const tenders = await listWillBidTenders(session.companyId);
  const requested = (await searchParams).tender;
  const selected = tenders.find((tender) => tender.id === requested) ?? tenders[0];
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Will Bid</h1><p className="mt-1 text-sm text-foreground-500">{tenders.length} tenders · Prepare documents and track submission readiness.</p></div><Link href="/will-bid-test" className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100">Open test view</Link></header>
    {tenders.length === 0 ? <div className="rounded-lg border bg-card p-8 text-center">
      <h2 className="font-semibold">No Will Bid tenders yet</h2><p className="my-3 text-sm text-foreground-500">Mark a tender Will Bid to start preparing its checklist.</p><Link href="/tenders" className="text-primary-700 underline">Browse tenders</Link>
    </div> : <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Will Bid tenders" className="max-h-[45vh] space-y-3 overflow-y-auto lg:sticky lg:top-4 lg:max-h-[calc(100vh-180px)]">
        {tenders.map((tender) => <Link key={tender.id} href={`/will-bid?tender=${tender.id}`} aria-current={selected?.id === tender.id ? "true" : undefined}
          className={`block rounded-xl border p-4 transition-colors ${selected?.id === tender.id ? "border-primary-500 bg-primary-50" : "bg-card hover:bg-background-100"}`}>
          <span className="text-xs font-medium text-emerald-700">Will Bid</span><h2 className="mt-2 break-words text-sm font-semibold">{tender.title}</h2>
          <p className="mt-2 text-xs text-foreground-500">{tender.organization}</p><p className="mt-2 break-words text-xs text-foreground-500">{tender.reference_no}</p><p className="mt-3 text-xs">Due {formatDate(tender.closing_date)}</p>
        </Link>)}
      </nav>
      <section aria-label="Selected tender checklist" className="min-w-0">
        {selected ? <Suspense key={selected.id} fallback={<p role="status" className="p-6">Loading tender checklist…</p>}><BidWorkspacePage params={Promise.resolve({ id: selected.id })} /></Suspense> : null}
      </section>
    </div>}
  </div>;
}
