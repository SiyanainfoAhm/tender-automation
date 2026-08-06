import { Suspense } from "react";

import { tenderFiltersSchema } from "@/lib/validations";
import { requireSession } from "@/server/auth/session";
import {
  getFilterFacets,
  listTenders,
} from "@/server/repositories/tenderRepository";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

function flattenSearchParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return out;
}

type TendersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TendersPage({ searchParams }: TendersPageProps) {
  await requireSession();
  const raw = flattenSearchParams(await searchParams);
  const filters = tenderFiltersSchema.parse(raw);

  const [{ rows, total }, facets] = await Promise.all([
    listTenders(filters),
    getFilterFacets(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Tenders
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Explore, filter and qualify tenders from all connected sources.
        </p>
      </div>

      <Suspense fallback={<TenderExplorerSkeleton />}>
        <TenderExplorer
          rows={rows}
          total={total}
          filters={filters}
          facets={facets}
        />
      </Suspense>
    </div>
  );
}
