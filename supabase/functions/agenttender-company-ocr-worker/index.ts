// Automatic OCR for scanned company documents.
// Picks ONE company document whose text could not be read (extraction_status OCR_REQUIRED / PARTIAL),
// downloads it from SharePoint, sends it to Azure AI Document Intelligence ("prebuilt-read"),
// and stores the page text via agenttender_company_ocr_commit. The existing jobs then chunk (#26)
// and embed (#17) it. Does nothing until the secrets AZURE_DI_ENDPOINT and AZURE_DI_KEY exist.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const env = (n: string) => Deno.env.get(n)?.trim() || "";
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
// Accept the names we asked for plus common alternatives people use in the Azure/Supabase UI.
const pick = (...names: string[]) => { for (const n of names) { const v = env(n); if (v) return v; } return ""; };
const RAW_ENDPOINT = pick("AZURE_DI_ENDPOINT","AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT","AZURE_FORM_RECOGNIZER_ENDPOINT","DOCUMENT_INTELLIGENCE_ENDPOINT","AZURE_OCR_ENDPOINT","AZURE_ENDPOINT").replace(/\/+$/, "");
const RAW_KEY = pick("AZURE_DI_KEY","AZURE_DOCUMENT_INTELLIGENCE_KEY","AZURE_FORM_RECOGNIZER_KEY","DOCUMENT_INTELLIGENCE_KEY","AZURE_OCR_KEY","AZURE_KEY","AZURE_DI_API_KEY");
// If the two values were entered the wrong way round, swap them.
const looksUrl = (v: string) => /^https?:\/\//i.test(v);
const [DI_ENDPOINT, DI_KEY] = (!looksUrl(RAW_ENDPOINT) && looksUrl(RAW_KEY)) ? [RAW_KEY.replace(/\/+$/, ""), RAW_ENDPOINT] : [RAW_ENDPOINT, RAW_KEY];
// Never let a secret appear in an error message, log or database row.
const redact = (m: string) => [RAW_ENDPOINT, RAW_KEY].filter((x) => x && x.length > 8).reduce((a, x) => a.split(x).join("[secret]"), m);
const HOST = env("SHAREPOINT_SITE_HOSTNAME") || "it1stop.sharepoint.com";
const SITE_PATH = env("SHAREPOINT_SITE_PATH") || "/sites/SiyanaTenderDocumentRepository";
const LIBRARY = env("SHAREPOINT_LIBRARY_NAME") || "TenderDocs";
const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_BYTES = 40_000_000;

async function graphToken(): Promise<string> {
  const tenant = env("MICROSOFT_GRAPH_TENANT_ID") || env("MS_GRAPH_TENANT_ID");
  const client = env("MICROSOFT_GRAPH_CLIENT_ID") || env("MS_GRAPH_CLIENT_ID");
  const secret = env("MICROSOFT_GRAPH_CLIENT_SECRET") || env("MS_GRAPH_CLIENT_SECRET");
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: client, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Graph token HTTP ${r.status}`);
  return j.access_token;
}
async function driveId(token: string): Promise<string> {
  const configured = env("MS_GRAPH_DRIVE_ID") || env("MICROSOFT_GRAPH_DRIVE_ID");
  if (configured) return configured;
  const g = async (p: string) => { const r = await fetch(GRAPH + p, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`Graph ${r.status}`); return r.json(); };
  const site = await g(`/sites/${HOST}:${SITE_PATH}`);
  const drives = await g(`/sites/${site.id}/drives`);
  return drives.value.find((x: any) => x.name?.toLowerCase() === LIBRARY.toLowerCase()).id;
}
function itemPath(d: any): string {
  const u = new URL(d.storage_url);
  const marker = `/${LIBRARY}/`.toLowerCase();
  const i = u.pathname.toLowerCase().indexOf(marker);
  const rel = i >= 0 ? u.pathname.slice(i + marker.length) : String(d.storage_blob_name || "");
  return rel.split("/").map(decodeURIComponent).map(encodeURIComponent).join("/");
}
async function download(d: any): Promise<Uint8Array> {
  const t = await graphToken();
  const drive = await driveId(t);
  const r = await fetch(`${GRAPH}/drives/${encodeURIComponent(drive)}/root:/${itemPath(d)}:/content`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`SharePoint download HTTP ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
  return b;
}
async function azureRead(bytes: Uint8Array, mime: string): Promise<{ page: number; text: string }[]> {
  const url = `${DI_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;
  const r = await fetch(url, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": DI_KEY, "Content-Type": mime || "application/octet-stream" }, body: bytes });
  if (r.status !== 202) throw new Error(`Azure analyze HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const op = r.headers.get("operation-location");
  if (!op) throw new Error("Azure: missing operation-location");
  for (let i = 0; i < 60; i++) {
    await new Promise((s) => setTimeout(s, i < 5 ? 1500 : 3000));
    const p = await fetch(op, { headers: { "Ocp-Apim-Subscription-Key": DI_KEY } });
    const j = await p.json();
    if (j.status === "succeeded") {
      return (j.analyzeResult?.pages || []).map((pg: any) => ({
        page: pg.pageNumber,
        text: (pg.lines || []).map((l: any) => l.content).join("\n"),
      }));
    }
    if (j.status === "failed") throw new Error(`Azure analyze failed: ${JSON.stringify(j.error || {}).slice(0, 300)}`);
  }
  throw new Error("Azure analyze timed out");
}

Deno.serve(async (req) => {
  if (!SERVICE_KEY || req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!DI_ENDPOINT || !DI_KEY || !looksUrl(DI_ENDPOINT)) {
    // names only (never values) so we can see what was configured
    const names = Object.keys(Deno.env.toObject()).filter((k) => /azure|document|ocr|di_/i.test(k));
    return Response.json({ ok: true, skipped: "Azure endpoint/key not usable", endpoint_found: !!RAW_ENDPOINT, endpoint_is_url: looksUrl(DI_ENDPOINT), key_found: !!RAW_KEY, related_secret_names: names });
  }
  const db = createClient(env("SUPABASE_URL"), SERVICE_KEY, { auth: { persistSession: false } });
  const { data: targets, error } = await db.rpc("agenttender_company_ocr_targets");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  // documents already OCR'd (or failed OCR) carry extraction_metadata.ocr and are not returned again
  const d = (targets || [])[0];
  if (!d) return Response.json({ ok: true, processed: 0 });
  const stateResult=await db.from('agenttender_company_document_texts').select('source_fingerprint,extraction_metadata,updated_at').eq('document_id',d.document_id).single();
  if(stateResult.error)return Response.json({ok:false,error:stateResult.error.message},{status:500});
  const state=stateResult.data,lease=crypto.randomUUID();
  const claimed=await db.from('agenttender_company_document_texts').update({lease_token:lease,lease_expires_at:new Date(Date.now()+240000).toISOString(),updated_at:new Date().toISOString()}).eq('document_id',d.document_id).eq('updated_at',state.updated_at).select();
  if(claimed.error)return Response.json({ok:false,error:claimed.error.message},{status:500});
  if(!claimed.data?.length)return Response.json({ok:true,skipped:'Document already claimed or changed'});
  try {
    const bytes = await download(d);
    const pages = await azureRead(bytes, d.mime_type);
    const current=await db.from('agenttender_company_document_texts').select('source_fingerprint,lease_token').eq('document_id',d.document_id).single();
    if(current.error||current.data?.source_fingerprint!==state.source_fingerprint||current.data?.lease_token!==lease)throw Error('Document source or lease changed during OCR');
    if(!pages.some(p=>p.text.trim().length>20))throw Error('OCR returned no readable pages');
    const name = d.original_file_name || d.name;
    const { data, error: ce } = await db.rpc("agenttender_company_ocr_commit", {
      p_document_id: d.document_id,
      p_pages: pages.map((p) => ({ member: name, page: p.page, text: p.text, native: false })),
      p_engine: "azure-di-read",
    });
    if (ce) throw ce;
    return Response.json({ ok: true, processed: 1, document: d.name, result: data });
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    const retries=Number(state.extraction_metadata?.ocr_retry_count||0)+1;
    await db.from('agenttender_company_document_texts').update({
      extraction_metadata:{...(state.extraction_metadata||{}),ocr:'failed',ocr_retry_count:retries,ocr_next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**retries)).toISOString(),ocr_failed_at:new Date().toISOString(),ocr_error:msg.slice(0,500)},
      last_error:('OCR failed: '+msg).slice(0,1000),updated_at:new Date().toISOString(),
    }).eq('document_id',d.document_id).eq('source_fingerprint',state.source_fingerprint).eq('lease_token',lease);
    return Response.json({ ok: false, document: d.name, error: msg }, { status: 200 });
  } finally {
    await db.from('agenttender_company_document_texts').update({lease_token:null,lease_expires_at:null}).eq('document_id',d.document_id).eq('lease_token',lease);
  }
});
