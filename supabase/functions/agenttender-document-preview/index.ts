// Document preview for TenderFlow. Called only by the Next.js server with the service key after it
// has checked the user's session and company. Returns the file as a PDF when possible:
// Word/Excel/PowerPoint files stored in SharePoint are converted by Microsoft Graph
// (?format=pdf) so the viewer shows real pages, including every-page footers and stamps.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const base = Deno.env.get("SUPABASE_URL") || "";
const db = createClient(base, key, { auth: { persistSession: false } });
const GRAPH = "https://graph.microsoft.com/v1.0";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let token = "";
let tokenUntil = 0;
async function graphToken(): Promise<string> {
  if (token && tokenUntil > Date.now()) return token;
  const tenant = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID") || Deno.env.get("MS_GRAPH_TENANT_ID");
  const client = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID") || Deno.env.get("MS_GRAPH_CLIENT_ID");
  const secret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET") || Deno.env.get("MS_GRAPH_CLIENT_SECRET");
  if (!tenant || !client || !secret) throw new Error("GRAPH_CREDENTIALS_UNAVAILABLE");
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: client,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("GRAPH_TOKEN_HTTP_" + r.status);
  token = j.access_token;
  tokenUntil = Date.now() + Math.max(60, (j.expires_in || 3600) - 120) * 1000;
  return token;
}

function shareId(url: string): string {
  return "u!" + btoa(unescape(encodeURIComponent(url))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Follow Graph's 302 to the pre-authenticated download without sending the bearer token. */
async function graphContent(path: string): Promise<Response> {
  const auth = { Authorization: "Bearer " + (await graphToken()) };
  const first = await fetch(GRAPH + path, { headers: auth, redirect: "manual", signal: AbortSignal.timeout(90000) });
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("Location");
    if (!location) throw new Error("GRAPH_REDIRECT_MISSING");
    return await fetch(location, { redirect: "follow", signal: AbortSignal.timeout(90000) });
  }
  return first;
}

const OFFICE = /\.(docx?|xlsx?|pptx?|rtf|odt)$/i;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const accepted = [key, Deno.env.get("SUPABASE_SECRET_KEY") || ""].filter(Boolean).map((k) => "Bearer " + k);
  if (req.method !== "POST" || !accepted.includes(req.headers.get("Authorization") || "")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  try {
    const input = await req.json().catch(() => ({}));
    const kind = input.kind === "company" ? "company" : "workspace";
    const id = String(input.id || "");
    const companyId = String(input.company_id || "");
    const wantPdf = input.format === "pdf";
    if (!ID.test(id) || !ID.test(companyId)) return json({ ok: false, error: "Invalid id" }, 400);

    // deno-lint-ignore no-explicit-any
    const row: Record<string, any> | null =
      kind === "company"
        ? (
            await db
              .from("agenttender_company_documents")
              .select("id, company_id, status, storage_url, original_file_name, name, mime_type")
              .eq("id", id)
              .maybeSingle()
          ).data
        : (
            await db
              .from("agenttender_bid_workspace_documents")
              .select("id, company_id, storage_url, blob_name, file_name, mime_type")
              .eq("id", id)
              .maybeSingle()
          ).data;
    if (!row) return json({ ok: false, error: "Document not found." }, 404);
    if (String(row.company_id) !== companyId) return json({ ok: false, error: "Access denied." }, 403);

    const fileName = String(row.file_name || row.original_file_name || row.name || "document");
    const storageUrl = String(row.storage_url || "");
    const convert = wantPdf && OFFICE.test(fileName);
    let upstream: Response;

    if (/^https:\/\/[^/]+\.sharepoint\.com\//i.test(storageUrl)) {
      const sid = shareId(storageUrl);
      upstream = await graphContent(`/shares/${sid}/driveItem/content${convert ? "?format=pdf" : ""}`);
    } else if (storageUrl.startsWith(base + "/functions/v1/agenttender-bid-draft-download")) {
      upstream = await fetch(storageUrl, { signal: AbortSignal.timeout(60000) });
    } else if (row.blob_name) {
      const r = await db.storage.from("agenttender-bid-drafts").download(String(row.blob_name));
      if (r.error || !r.data) return json({ ok: false, error: "File not found." }, 404);
      upstream = new Response(r.data);
    } else {
      return json({ ok: false, error: "File not found." }, 404);
    }

    if (!upstream.ok) {
      return json({ ok: false, error: "Storage returned HTTP " + upstream.status }, upstream.status === 404 ? 404 : 502);
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    const contentType = isPdf
      ? "application/pdf"
      : upstream.headers.get("content-type") || String(row.mime_type || "application/octet-stream");
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-transform, max-age=300",
        "X-Preview-Converted": convert && isPdf ? "pdf" : "original",
        "X-File-Name": encodeURIComponent(fileName),
      },
    });
  } catch (error) {
    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
