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
  const parsedFilters = tenderFiltersSchema.safeParse(
    searchParamsForStatusCounts(raw),
  );
  if (!parsedFilters.success) {
    console.warn("[tenders] invalid status-count filters", {
      route: "/api/tenders/status-counts",
      userId: session.user.id,
      companyId: session.user.companyId,
      invalidFields: parsedFilters.error.issues.map((issue) => issue.path.join(".")),
    });
    return NextResponse.json({ error: "Invalid tender filters" }, { status: 400 });
  }

  let counts;
  try {
    counts = await getTenderListStatusCounts(parsedFilters.data);
  } catch (error) {
    console.error("[tenders] status counts query failed", {
      route: "/api/tenders/status-counts",
      userId: session.user.id,
      companyId: session.user.companyId,
      operation: "getTenderListStatusCounts",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to load tender status counts. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json(counts, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
