import { NextResponse } from "next/server";

import { tenderFiltersSchema } from "@/lib/validations";
import { getSession } from "@/server/auth/session";
import { listTenders } from "@/server/repositories/tenderRepository";

function flattenSearchParams(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsedFilters = tenderFiltersSchema.safeParse(flattenSearchParams(url));
  if (!parsedFilters.success) {
    console.warn("[tenders] invalid API list filters", {
      route: "/api/tenders",
      userId: session.user.id,
      companyId: session.user.companyId,
      invalidFields: parsedFilters.error.issues.map((issue) => issue.path.join(".")),
    });
    return NextResponse.json({ error: "Invalid tender filters" }, { status: 400 });
  }
  const filters = parsedFilters.data;
  const includeCountParam = url.searchParams.get("includeCount");
  const includeCount =
    includeCountParam === "0" || includeCountParam === "false"
      ? false
      : true;

  let result;
  try {
    result = await listTenders(filters, { includeCount });
  } catch (error) {
    console.error("[tenders] list query failed", {
      route: "/api/tenders",
      userId: session.user.id,
      companyId: session.user.companyId,
      operation: "listTenders",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to load tenders. Please try again." },
      { status: 503 },
    );
  }
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
