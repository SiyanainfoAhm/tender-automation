import { Card, CardContent } from "@/components/ui/card";
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
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Pipeline insights across sources, statuses and value bands.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-5">
              <p className="text-2xl font-bold text-text-primary">{m.value}</p>
              <p className="text-sm text-text-muted">{m.label}</p>
              {m.sub ? (
                <p className="mt-1 text-xs text-text-subtle">{m.sub}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <AnalyticsChartsLoader data={data} />
    </div>
  );
}
