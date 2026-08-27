import { NextResponse } from "next/server";

import { getSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const counts = await getTenderListStatusCounts({
    date: url.searchParams.get("date"),
    selectedDate: url.searchParams.get("selectedDate"),
    createdFrom: url.searchParams.get("createdFrom"),
    createdTo: url.searchParams.get("createdTo"),
    source: url.searchParams.get("source"),
  });

  return NextResponse.json(counts, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
