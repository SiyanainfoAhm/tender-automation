import { TenderSummaryList } from "@/components/dashboard/tender-summary-list";
import { ErrorState } from "@/components/ui/error-state";
import type { OperationalListKey } from "@/server/repositories/analyticsRepository";
import { getOperationalList } from "@/server/repositories/analyticsRepository";

const LIST_CONFIG: {
  key: OperationalListKey;
  title: string;
  href: string;
  emptyTitle: string;
  emptyDescription: string;
}[] = [
  {
    key: "closingSoon",
    title: "Closing soon",
    href: "/tenders?quickDate=closing_7",
    emptyTitle: "No closing tenders",
    emptyDescription: "No tenders are closing in the next 7 days.",
  },
  {
    key: "recentlyQualified",
    title: "Recently qualified",
    href: "/tenders?status=GO",
    emptyTitle: "No recently qualified tenders",
    emptyDescription:
      "Tenders marked GO will appear here after qualification.",
  },
  {
    key: "recentlyActionable",
    title: "Recently actionable",
    href: "/tenders?status=GO",
    emptyTitle: "No recently actionable tenders",
    emptyDescription:
      "Tenders marked GO, CONDITIONAL GO or PARTNER BID will appear here.",
  },
  {
    key: "manualReview",
    title: "Needs verification",
    href: "/tenders?status=VERIFY",
    emptyTitle: "Nothing to verify",
    emptyDescription: "Tenders with VERIFY status will show here.",
  },
];

async function OperationalListPanel({
  config,
}: {
  config: (typeof LIST_CONFIG)[number];
}) {
  const result = await getOperationalList(config.key);
  if (!result.ok) {
    return (
      <ErrorState
        title={`Unable to load ${config.title.toLowerCase()}`}
        message={result.error.publicMessage}
        correlationId={result.error.correlationId}
        compact
      />
    );
  }
  return (
    <TenderSummaryList
      title={config.title}
      items={result.data}
      href={config.href}
      emptyTitle={config.emptyTitle}
      emptyDescription={config.emptyDescription}
    />
  );
}

export async function DashboardOperationalSection() {
  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-2">
      {LIST_CONFIG.map((config) => (
        <OperationalListPanel key={config.key} config={config} />
      ))}
    </div>
  );
}
