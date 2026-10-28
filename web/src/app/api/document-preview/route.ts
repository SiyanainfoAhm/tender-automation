export const maxDuration = 60;
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { roleHasPermission } from "@/lib/rbac/permissions";
import { getSession } from "@/server/auth/session";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inline preview of a checklist document. Word / Excel / PowerPoint files are
 * converted to PDF by SharePoint so the viewer shows real pages (with every-page
 * footers and stamps). Query: ?kind=workspace|company&id=<uuid>
 */
export async function GET(request: Request) {
  const session = await getSession();
  const companyId = session?.user.companyId;
  if (!session || !companyId) {
    return NextResponse.json({ success: false, error: "Sign in again to view this document." }, { status: 401 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "company" ? "company" : "workspace";
  const id = url.searchParams.get("id") || "";
  if (!ID.test(id)) {
    return NextResponse.json({ success: false, error: "Document id is required." }, { status: 400 });
  }
  if (kind === "company" && !roleHasPermission(session.user.role, "documents.view")) {
    return NextResponse.json({ success: false, error: "Document access denied." }, { status: 403 });
  }

  const base = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || "";
  if (!base || !key) {
    return NextResponse.json({ success: false, error: "Document storage is not configured." }, { status: 503 });
  }

  try {
    const upstream = await fetch(`${base}/functions/v1/agenttender-document-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ kind, id, company_id: companyId, format: "pdf" }),
      cache: "no-store",
    });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => null)) as { error?: string } | null;
      return NextResponse.json(
        { success: false, error: body?.error || "Unable to load this document." },
        { status: upstream.status === 404 || upstream.status === 403 ? upstream.status : 502 },
      );
    }
    // Stream the body (large PDFs exceed the platform's buffered response limit).
    // No Content-Length: the upstream body may have been decompressed in transit.
    const fileName = decodeURIComponent(upstream.headers.get("x-file-name") || "document");
    const converted = upstream.headers.get("x-preview-converted") === "pdf";
    const shownName = converted ? fileName.replace(/\.[a-z0-9]+$/i, ".pdf") : fileName;
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(shownName)}`,
        "Cache-Control": "private, no-transform, max-age=300",
        "X-Preview-Converted": converted ? "pdf" : "original",
      },
    });
  } catch (error) {
    console.error("[document-preview] failed", error);
    return NextResponse.json({ success: false, error: "Unable to load this document." }, { status: 502 });
  }
}
