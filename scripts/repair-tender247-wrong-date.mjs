import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";

dotenv.config();
dotenv.config({ path: "web/.env" });

const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mirrorBase = String(process.env.TENDER247_MIRROR_SUPABASE_URL || "").replace(/\/$/, "");
const mirrorKey = process.env.TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key || !mirrorBase || !mirrorKey) throw new Error("Canonical and mirror Supabase credentials are required");
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const mh = { apikey: mirrorKey, Authorization: `Bearer ${mirrorKey}`, "Content-Type": "application/json" };
const edgeUrl = `${base}/functions/v1/tender-automation-company-documents`;
const oldMarker = "/tender247/2026-10-09/";
const newMarker = "/tender247/2026-10-08/";
const root = "companies/siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890/tender-artifacts/tender247";
const shardCount = Math.max(1, Number(process.env.T247_REPAIR_SHARD_COUNT || 1));
const shardIndex = Math.max(0, Number(process.env.T247_REPAIR_SHARD_INDEX || 0));
if (shardIndex >= shardCount) throw new Error("Invalid repair shard index");
const report = { files_moved: 0, db_only_repairs: 0, canonical_updated: 0, document_urls_updated: 0, mirror_updated: 0, mirror_upserted: 0, collisions: [], failures: [] };

async function request(url, init, label) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const rest = (path, init = {}) => request(`${base}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } }, `canonical ${path}`);
const mirror = (path, init = {}) => request(`${mirrorBase}/rest/v1/${path}`, { ...init, headers: { ...mh, ...(init.headers || {}) } }, `mirror ${path}`);
async function edge(body) { return request(edgeUrl, { method: "POST", headers: h, body: JSON.stringify(body) }, `graph ${body.action}`); }
function graphPath(item) { return String(item?.parentReference?.path || "").replaceAll("\\", "/"); }
function isNew(item) { return graphPath(item).includes(newMarker); }
function targetFolder(item) {
  const path = graphPath(item); const index = path.indexOf(oldMarker);
  if (index < 0) throw new Error(`Source item is not in old hierarchy: ${path}`);
  return `${root}/2026-10-08/${path.slice(index + oldMarker.length)}`;
}
async function canonicalDocument(id) {
  const rows = await rest(`agenttender_tender_documents?select=id,tender_id,external_document_id,file_name,mime_type,file_size_bytes,storage_status,completed_at,storage_url,sharepoint_drive_item_id&id=eq.${encodeURIComponent(id)}`);
  if (rows.length !== 1) throw new Error(`canonical document ${id} not found uniquely`);
  return rows[0];
}
async function replaceReferences(doc, item) {
  const oldUrl = doc.storage_url; const newUrl = item.webUrl;
  const updated = await rest(`agenttender_tender_documents?id=eq.${encodeURIComponent(doc.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ storage_url: newUrl, sharepoint_drive_item_id: item.id }) });
  if (updated.length !== 1 || updated[0].storage_url !== newUrl || updated[0].sharepoint_drive_item_id !== item.id) throw new Error("canonical post-update verification failed");
  report.canonical_updated++;
  const urls = await rest("rpc/replace_tender_document_url", { method: "POST", body: JSON.stringify({ p_tender_id: doc.tender_id, p_old_document_url: oldUrl, p_new_document_url: newUrl }) });
  const values = Array.isArray(urls) ? urls : [];
  const matching = values.filter((v) => typeof v === "string" ? v === newUrl : v?.url === newUrl);
  const oldPresent = values.some((v) => typeof v === "string" ? v === oldUrl : v?.url === oldUrl);
  if (matching.length !== 1 || oldPresent) throw new Error("document_urls post-update verification failed");
  report.document_urls_updated++;
  const payload = { canonical_tender_id: doc.tender_id, canonical_document_id: doc.id, external_document_id: doc.external_document_id, filename: doc.file_name, mime_type: doc.mime_type, file_size: doc.file_size_bytes, storage_status: doc.storage_status, storage_url: newUrl, sharepoint_drive_item_id: item.id, completed_at: doc.completed_at };
  let rows = await mirror(`tender247_documents?canonical_document_id=eq.${encodeURIComponent(doc.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ storage_url: newUrl, sharepoint_drive_item_id: item.id }) });
  if (rows.length === 0) {
    const parents = await mirror(`tender247_tenders?select=id&canonical_tender_id=eq.${encodeURIComponent(doc.tender_id)}`);
    if (parents.length !== 1) throw new Error(`mirror parent identity is not unambiguous (${parents.length})`);
    payload.tender247_tender_row_id = parents[0].id;
    rows = await mirror("tender247_documents?on_conflict=tender247_tender_row_id,external_document_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
    report.mirror_upserted++;
  }
  if (rows.length !== 1 || rows[0].storage_url !== newUrl || rows[0].sharepoint_drive_item_id !== item.id) throw new Error("mirror post-update verification failed");
  report.mirror_updated++;
}

const audit = JSON.parse(await readFile("logs/tender247-wrong-date-audit.json", "utf8"));
if (audit.initial_wrong_date_canonical !== 1346) throw new Error("Audit scope is not the verified 1346 rows");
function shardForTender(tenderId) {
  let hash = 0;
  for (const char of String(tenderId || "")) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % shardCount;
}
const scopedRows = audit.rows.filter((row) => shardForTender(row.canonical_tender_id) === shardIndex);
for (let n = 0; n < scopedRows.length; n += 1) {
  const audited = scopedRows[n];
  if (!["GRAPH_ALREADY_2026_10_08_DB_STALE", "GRAPH_STILL_2026_10_09"].includes(audited.classification)) continue;
  try {
    const doc = await canonicalDocument(audited.canonical_document_id);
    let item = (await edge({ action: "tender247-correction-inspect", driveItemId: doc.sharepoint_drive_item_id })).item;
    if (!item) throw new Error("Graph item disappeared after audit");
    if (isNew(item)) report.db_only_repairs++;
    else if (graphPath(item).includes(oldMarker)) {
      const moved = await edge({ action: "tender247-correction-move", driveItemId: item.id, targetFolderPath: targetFolder(item), targetName: item.name });
      if (moved.status === "COLLISION") { report.collisions.push({ canonical_document_id: doc.id, drive_item_id: item.id, target_drive_item_id: moved.target?.id }); continue; }
      item = (await edge({ action: "tender247-correction-inspect", driveItemId: item.id })).item;
      if (!isNew(item)) throw new Error("Graph post-move hierarchy verification failed");
      report.files_moved++;
    } else throw new Error(`Graph item changed to unexpected path: ${graphPath(item)}`);
    await replaceReferences(doc, item);
  } catch (error) { report.failures.push({ canonical_document_id: audited.canonical_document_id, error: String(error) }); }
  if ((n + 1) % 50 === 0) console.log(JSON.stringify({ shard: shardIndex, processed: n + 1, scoped_total: scopedRows.length, files_moved: report.files_moved, failures: report.failures.length, collisions: report.collisions.length }));
}
await writeFile(`logs/tender247-wrong-date-repair-${shardIndex}.json`, JSON.stringify({ shard_index: shardIndex, shard_count: shardCount, scoped_total: scopedRows.length, ...report }, null, 2));
console.log(`TENDER247_REPAIR=${JSON.stringify({ shard_index: shardIndex, shard_count: shardCount, scoped_total: scopedRows.length, ...report })}`);
