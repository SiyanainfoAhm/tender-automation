export const maxDuration = 300;

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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Will Bid</h1>
          <p className="mt-1 text-sm text-foreground-500">
            {tenders.length} tenders · Prepare documents and track submission readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected ? (
            <Link
              href={`/tenders/${selected.id}/bid-workspace/organize`}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Organize checklist
            </Link>
          ) : null}
          <Link
            href="/will-bid-test"
            className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
          >
            Open test view
          </Link>
        </div>
      </header>

      {tenders.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <h2 className="font-semibold">No Will Bid tenders yet</h2>
          <p className="my-3 text-sm text-foreground-500">
            Mark a tender Will Bid to start preparing its checklist.
          </p>
          <Link href="/tenders" className="text-primary-700 underline">
            Browse tenders
          </Link>
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <nav
            aria-label="Will Bid tenders"
            className="max-h-[45vh] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-180px)]"
          >
            {tenders.map((tender) => {
              const active = selected?.id === tender.id;

              return (
                <Link
                  key={tender.id}
                  href={`/will-bid?tender=${tender.id}`}
                  aria-current={active ? "true" : undefined}
                  className={`group block rounded-2xl border p-4 transition-all ${
                    active
                      ? "border-emerald-400 bg-emerald-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-emerald-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      Will Bid
                    </span>
                    <span className="min-w-0 truncate text-right text-[11px] text-slate-400">
                      {tender.reference_no || "No reference"}
                    </span>
                  </div>

                  <h2 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-slate-900">
                    {tender.title}
                  </h2>

                  <p className="mt-2 truncate text-xs text-slate-600">
                    {tender.organization || "Unknown organization"}
                  </p>

                  <div className="mt-4 flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 ring-1 ring-inset ring-slate-200/70">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Closing date
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">
                        {formatDate(tender.closing_date)}
                      </p>
                    </div>
                    <span className="ml-3 text-xs font-medium text-emerald-700 transition-transform group-hover:translate-x-0.5">
                      Open →
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>

          <section aria-label="Selected tender checklist" className="min-w-0">
            {selected ? (
              <Suspense
                key={selected.id}
                fallback={<p role="status" className="p-6">Loading tender checklist…</p>}
              >
                <BidWorkspacePage params={Promise.resolve({ id: selected.id })} />
              </Suspense>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
