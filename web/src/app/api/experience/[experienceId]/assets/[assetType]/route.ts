export const maxDuration = 60;

import { NextResponse } from "next/server";

import { getSession } from "@/server/auth/session";
import { invokeExperienceAssetRead } from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = {
  params: Promise<{
    experienceId: string;
    assetType: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session?.user.companyId) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const { experienceId, assetType } = await context.params;
  if (assetType !== "work-order" && assetType !== "completion-certificate") {
    return NextResponse.json(
      { success: false, error: "Invalid asset type." },
      { status: 400 },
    );
  }

  try {
    const upstream = await invokeExperienceAssetRead(experienceId, assetType);
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    // Content-Length is not forwarded: storage may compress the body, and a
    // mismatched length makes browsers abort the download ("Failed to fetch").
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    headers.set(
      "Cache-Control",
      upstream.ok ? "private, max-age=300" : "no-store",
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("[experience] asset read proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load experience file." },
      { status: 500 },
    );
  }
}
