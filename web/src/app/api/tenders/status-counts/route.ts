import { NextResponse } from "next/server";

import { tenderFiltersSchema } from "@/lib/validations";
import { searchParamsForStatusCounts } from "@/lib/tender-status-count-params";
import { getSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  // Drop status/page/sort — cards are a facet over the non-status population.
  const filters = tenderFiltersSchema.parse(searchParamsForStatusCounts(raw));
  const counts = await getTenderListStatusCounts(filters);

  return NextResponse.json(counts, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
