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
  const filters = tenderFiltersSchema.parse(flattenSearchParams(url));
  const includeCountParam = url.searchParams.get("includeCount");
  const includeCount =
    includeCountParam === "0" || includeCountParam === "false"
      ? false
      : true;

  const result = await listTenders(filters, { includeCount });
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
