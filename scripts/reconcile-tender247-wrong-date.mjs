import "dotenv/config";
import { execFileSync } from "node:child_process";

const canonicalUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const edgeUrl = `${canonicalUrl}/functions/v1/tender-automation-company-documents`;
if (!canonicalUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const OLD = "/tender247/2026-10-09/";
const NEW = "/tender247/2026-10-08/";
const shardCount = Math.max(1, Number(process.env.T247_SHARD_COUNT || 1));
const shardIndex = Math.max(0, Number(process.env.T247_SHARD_INDEX || 0));
const root = "companies/siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890/tender-artifacts/tender247";
const report = { successfulDocsReconciled: 0, originalWrongDateCount: 0, graphItemsChecked: 0, filesMoved: 0, filesAlreadyCorrect: 0, collisions: 0, collisionsResolved: 0, graphMoveFailures: [], canonicalUpdated: 0, canonicalUpdateFailures: [], documentUrlsUpdated: 0, mirrorUpdated: 0, mirrorMissingRepaired: 0, mirrorFailures: [], difference: {}, recoveryRequired: [] };
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;

async function rest(path, init = {}) {
  const response = await fetch(`${canonicalUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}
async function edge(body) {
  const response = await fetch(edgeUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Graph operation ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}
async function savedRunTenders() {
  const [run] = await rest("agenttender_pipeline_runs?select=summary&id=eq.cf2f14d7-1e71-4d9a-a836-47bdc769aa4c");
  const raw = run?.summary?.rawResponse || {};
  const source = Array.isArray(raw.Data) ? raw.Data : Array.isArray(raw.data) ? raw.data : [];
  const identities = new Set(source.map((t) => `${String(t?.tenderid ?? t?.tenderId ?? "").trim()}|${String(t?.region || "INDIAN").trim().toUpperCase()}`).filter((x) => !x.startsWith("|")));
  const stableIds = [...new Set([...identities].map((x) => x.split("|")[0]))];
  if (stableIds.length !== 327) throw new Error(`Safety stop: saved run contains ${stableIds.length} stable Tender247 IDs, expected 327`);
  const rows = [];
  for (let i = 0; i < stableIds.length; i += 40) {
    rows.push(...await rest(`agenttender_tenders?select=id,source_tender_id,source_region,scraped_date&source_portal=eq.TENDER247&scraped_date=eq.2026-10-08&source_tender_id=in.(${stableIds.slice(i, i + 40).join(",")})&limit=1000`));
  }
  return rows.filter((t) => identities.has(`${t.source_tender_id}|${String(t.source_region || "INDIAN").toUpperCase()}`));
}
async function allDocs(tenderIds) {
  const rows = [];
  for (let i = 0; i < tenderIds.length; i += 40) {
    const ids = tenderIds.slice(i, i + 40).join(",");
    const query = `agenttender_tender_documents?select=id,tender_id,external_document_id,file_name,mime_type,file_size_bytes,storage_url,sharepoint_drive_item_id,storage_status,completed_at&external_source=eq.TENDER247&storage_status=eq.COMPLETED&tender_id=in.(${ids})&limit=1000`;
    rows.push(...await rest(query));
  }
  return rows;
}
function isOld(item) { return String(item?.parentReference?.path || "").replaceAll("\\", "/").includes("/tender247/2026-10-09/"); }
function isNew(item) { return String(item?.parentReference?.path || "").replaceAll("\\", "/").includes("/tender247/2026-10-08/"); }
function targetFolder(item) {
  const parent = String(item.parentReference?.path || "").replaceAll("\\", "/");
  const marker = "/tender247/2026-10-09/";
  const pos = parent.indexOf(marker);
  if (pos < 0) throw new Error("Source is not in old Tender247 date hierarchy");
  return `${root}/2026-10-08/${parent.slice(pos + marker.length)}`;
}
function collisionName(doc, source) {
  const identity = String(doc.external_document_id || doc.id).replace(/[^A-Za-z0-9_-]/g, "-");
  return `${identity}--${source.name}`.slice(0, 255);
}
async function updateCanonical(doc, item) {
  const oldUrl = doc.storage_url;
  const newUrl = item.webUrl;
  await rest(`agenttender_tender_documents?id=eq.${encodeURIComponent(doc.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ storage_url: newUrl, sharepoint_drive_item_id: item.id }) });
  report.canonicalUpdated += 1;
  await rest("rpc/replace_tender_document_url", { method: "POST", body: JSON.stringify({ p_tender_id: doc.tender_id, p_old_document_url: oldUrl, p_new_document_url: newUrl }) });
  report.documentUrlsUpdated += 1;
  doc.storage_url = newUrl; doc.sharepoint_drive_item_id = item.id;
}
function updateMirror(rows) {
  for (let i = 0; i < rows.length; i += 30) {
    const batch = rows.slice(i, i + 30);
    const values = batch.map((d) => `(${sql(d.tender_id)}::uuid,${sql(d.id)}::uuid,${sql(d.external_document_id)},${sql(d.file_name)},${sql(d.mime_type)},${Number(d.file_size_bytes || 0)},${sql(d.storage_status)},${sql(d.storage_url)},${sql(d.sharepoint_drive_item_id)},${sql(d.completed_at)}::timestamptz)`).join(",");
    const query = `with v(canonical_tender_id,canonical_document_id,external_document_id,filename,mime_type,file_size,storage_status,storage_url,sharepoint_drive_item_id,completed_at) as (values ${values}), up as (insert into public.tender247_documents(tender247_tender_row_id,canonical_tender_id,canonical_document_id,external_document_id,filename,mime_type,file_size,storage_status,storage_url,sharepoint_drive_item_id,completed_at) select t.id,v.canonical_tender_id,v.canonical_document_id,v.external_document_id,v.filename,v.mime_type,v.file_size,v.storage_status,v.storage_url,v.sharepoint_drive_item_id,v.completed_at from v join public.tender247_tenders t on t.canonical_tender_id=v.canonical_tender_id on conflict (tender247_tender_row_id,external_document_id) do update set canonical_document_id=excluded.canonical_document_id,storage_url=excluded.storage_url,sharepoint_drive_item_id=excluded.sharepoint_drive_item_id,filename=excluded.filename,mime_type=excluded.mime_type,file_size=excluded.file_size,storage_status=excluded.storage_status,completed_at=excluded.completed_at returning 1) select count(*) as updated from up;`;
    const output = execFileSync("npx.cmd", ["supabase", "db", "query", "--linked", "--project-ref", "mawtvjyaorsvjgcizwks", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const match = output.match(/"updated"\s*:\s*(\d+)/); report.mirrorUpdated += Number(match?.[1] || batch.length);
  }
}

const tenders = await savedRunTenders();
if (tenders.length !== 327) throw new Error(`Safety stop: expected 327 Tender247 tenders, found ${tenders.length}`);
const docs = await allDocs(tenders.map((t) => t.id));
if (docs.length !== 1708) throw new Error(`Safety stop: expected 1708 successful documents, found ${docs.length}`);
const selectedDocs = docs.filter((_, index) => index % shardCount === shardIndex);
report.successfulDocsReconciled = selectedDocs.length;
const byDriveId = new Map(docs.filter((d) => d.sharepoint_drive_item_id).map((d) => [d.sharepoint_drive_item_id, d]));
const mirrorCandidates = [];
for (const doc of selectedDocs) {
  if (!doc.storage_url) { report.difference.MISSING_STORAGE_URL = (report.difference.MISSING_STORAGE_URL || 0) + 1; continue; }
  if (!doc.sharepoint_drive_item_id) { report.difference.MISSING_DRIVE_ITEM = (report.difference.MISSING_DRIVE_ITEM || 0) + 1; continue; }
  let source;
  try { source = (await edge({ action: "tender247-correction-inspect", driveItemId: doc.sharepoint_drive_item_id })).item; report.graphItemsChecked += 1; }
  catch (error) { report.graphMoveFailures.push({ id: doc.id, error: String(error) }); continue; }
  if (!source) { report.graphMoveFailures.push({ id: doc.id, error: "drive item missing" }); continue; }
  if (isOld(source)) {
    report.originalWrongDateCount += 1;
    let result;
    try { result = await edge({ action: "tender247-correction-move", driveItemId: source.id, targetFolderPath: targetFolder(source), targetName: source.name }); }
    catch (error) { report.graphMoveFailures.push({ id: doc.id, error: String(error) }); continue; }
    if (result.status === "COLLISION") {
      report.collisions += 1;
      const same = byDriveId.get(result.target?.id);
      if (same && same.external_document_id === doc.external_document_id && Number(result.target.size) === Number(source.size)) result = { status: "ALREADY_CORRECT", item: result.target };
      else {
        try { result = await edge({ action: "tender247-correction-move", driveItemId: source.id, targetFolderPath: targetFolder(source), targetName: collisionName(doc, source) }); report.collisionsResolved += 1; }
        catch (error) { report.graphMoveFailures.push({ id: doc.id, error: `collision: ${String(error)}` }); continue; }
      }
    }
    if (!isNew(result.item) || Number(result.item.size) !== Number(source.size)) { report.graphMoveFailures.push({ id: doc.id, error: "post-move verification failed" }); continue; }
    if (result.status === "MOVED") report.filesMoved += 1; else report.filesAlreadyCorrect += 1;
    try { await updateCanonical(doc, result.item); mirrorCandidates.push(doc); }
    catch (error) { report.canonicalUpdateFailures.push({ id: doc.id, error: String(error) }); report.recoveryRequired.push({ id: doc.id, oldUrl: doc.storage_url, newUrl: result.item.webUrl, driveItemId: result.item.id }); }
  } else if (isNew(source)) {
    report.filesAlreadyCorrect += 1; report.difference.ALREADY_CORRECT_2026_10_08 = (report.difference.ALREADY_CORRECT_2026_10_08 || 0) + 1;
    if (doc.storage_url !== source.webUrl) { try { await updateCanonical(doc, source); } catch (error) { report.canonicalUpdateFailures.push({ id: doc.id, error: String(error) }); } }
    mirrorCandidates.push(doc);
  } else report.difference.OTHER_EXISTING_PATH = (report.difference.OTHER_EXISTING_PATH || 0) + 1;
  if (report.graphItemsChecked % 100 === 0) console.log(JSON.stringify({ progress: report.graphItemsChecked, moved: report.filesMoved, failures: report.graphMoveFailures.length }));
  await sleep(10);
}
try { updateMirror(mirrorCandidates); } catch (error) { report.mirrorFailures.push(String(error)); }
console.log(`TENDER247_CORRECTION_REPORT=${JSON.stringify(report)}`);
