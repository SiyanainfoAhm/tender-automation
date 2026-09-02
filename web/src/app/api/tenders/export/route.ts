import { NextResponse } from "next/server";

import { tenderFiltersSchema } from "@/lib/validations";
import { getSession } from "@/server/auth/session";
import { listAllTendersForExport } from "@/server/repositories/tenderRepository";

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

  try {
    const filters = tenderFiltersSchema.parse(
      flattenSearchParams(new URL(request.url)),
    );
    const { rows, total } = await listAllTendersForExport(filters);
    return NextResponse.json(
      { rows, total },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to export tenders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
