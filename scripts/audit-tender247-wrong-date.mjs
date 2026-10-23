import "dotenv/config";
import { writeFile } from "node:fs/promises";

const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const edgeUrl = `${base}/functions/v1/tender-automation-company-documents`;
const oldMarker = "/tender247/2026-10-09/";
const newMarker = "/tender247/2026-10-08/";

async function rest(path, range) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: { ...headers, ...(range ? { Range: range } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`REST ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function graphItem(driveItemId) {
  const response = await fetch(edgeUrl, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "tender247-correction-inspect", driveItemId }) });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Graph ${response.status}: ${JSON.stringify(body)}`);
  return body?.item || null;
}
function graphPath(item) { return String(item?.parentReference?.path || "").replaceAll("\\", "/"); }
function classify(item) {
  if (!item) return "GRAPH_ITEM_MISSING";
  const path = graphPath(item);
  if (path.includes(newMarker)) return "GRAPH_ALREADY_2026_10_08_DB_STALE";
  if (path.includes(oldMarker)) return "GRAPH_STILL_2026_10_09";
  return "GRAPH_OTHER_PATH";
}

const select = "id,tender_id,external_document_id,file_name,storage_url,sharepoint_drive_item_id,agenttender_tenders!inner(scraped_date)";
const query = `agenttender_tender_documents?select=${select}&external_source=eq.TENDER247&agenttender_tenders.scraped_date=eq.2026-10-08&storage_url=like.*2026-10-09*`;
const documents = [];
for (let start = 0; ; start += 1000) {
  const page = await rest(query, `${start}-${start + 999}`);
  documents.push(...page);
  if (page.length < 1000) break;
}
if (documents.length !== 1346) throw new Error(`Safety stop: expected 1346 wrong-date canonical documents, got ${documents.length}`);

const output = [];
for (let offset = 0; offset < documents.length; offset += 12) {
  const batch = documents.slice(offset, offset + 12);
  const entries = await Promise.all(batch.map(async (doc) => {
    try {
      const item = doc.sharepoint_drive_item_id ? await graphItem(doc.sharepoint_drive_item_id) : null;
      return { canonical_document_id: doc.id, canonical_tender_id: doc.tender_id, external_document_id: doc.external_document_id, file_name: doc.file_name, storage_url: doc.storage_url, sharepoint_drive_item_id: doc.sharepoint_drive_item_id, graph_item: item, graph_path: graphPath(item), classification: doc.sharepoint_drive_item_id ? classify(item) : "GRAPH_ITEM_MISSING" };
    } catch (error) {
      return { canonical_document_id: doc.id, canonical_tender_id: doc.tender_id, external_document_id: doc.external_document_id, file_name: doc.file_name, storage_url: doc.storage_url, sharepoint_drive_item_id: doc.sharepoint_drive_item_id, graph_error: String(error), classification: "GRAPH_OTHER_PATH" };
    }
  }));
  output.push(...entries);
  console.log(JSON.stringify({ inspected: output.length, total: documents.length }));
}
const counts = Object.fromEntries(["GRAPH_ALREADY_2026_10_08_DB_STALE", "GRAPH_STILL_2026_10_09", "GRAPH_OTHER_PATH", "GRAPH_ITEM_MISSING"].map((kind) => [kind, output.filter((x) => x.classification === kind).length]));
const report = { initial_wrong_date_canonical: documents.length, counts, graph_errors: output.filter((x) => x.graph_error).length, rows: output };
await writeFile("logs/tender247-wrong-date-audit.json", JSON.stringify(report, null, 2));
console.log(`TENDER247_AUDIT=${JSON.stringify({ initial_wrong_date_canonical: documents.length, ...counts, graph_errors: report.graph_errors })}`);
