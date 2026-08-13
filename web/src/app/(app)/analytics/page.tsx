import { formatIndianCurrency } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import {
  getAnalytics,
  lastNDaysIso,
} from "@/server/repositories/analyticsRepository";

import { AnalyticsChartsLoader } from "./analytics-charts-loader";

type AnalyticsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  await requireSession();
  const raw = await searchParams;
  const source = typeof raw.source === "string" ? raw.source : "ALL";
  const status = typeof raw.status === "string" ? raw.status : "ALL";
  const category = typeof raw.category === "string" ? raw.category : undefined;
  const from =
    typeof raw.from === "string" ? raw.from : lastNDaysIso(30);
  const to = typeof raw.to === "string" ? raw.to : undefined;

  const data = await getAnalytics({ from, to, source, status, category });

  const metrics = [
    {
      label: "Total tenders",
      value: data.totals.count.toLocaleString("en-IN"),
    },
    {
      label: "Qualified",
      value: data.totals.qualifiedCount.toLocaleString("en-IN"),
    },
    {
      label: "Manual review",
      value: data.totals.manualReviewCount.toLocaleString("en-IN"),
    },
    {
      label: "Disclosed value",
      value: formatIndianCurrency(data.totals.disclosedValueSum),
      sub: `${data.totals.disclosedValueCount} tenders`,
    },
    {
      label: "Disclosed EMD",
      value: formatIndianCurrency(data.totals.disclosedEmdSum),
      sub: `${data.totals.disclosedEmdCount} tenders`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pipeline insights across sources, statuses and value bands.
        </p>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex h-full min-h-[104px] max-h-[112px] flex-col justify-center rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              {m.value}
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              {m.label}
            </p>
            {m.sub ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {m.sub}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <AnalyticsChartsLoader data={data} />
    </div>
  );
}
