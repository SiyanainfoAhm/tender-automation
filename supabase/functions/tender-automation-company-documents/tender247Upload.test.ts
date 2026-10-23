import {
  __setTender247TestDependenciesForTests,
  handleCompanyDocumentsRequest,
  resolveTender247StoredFilename,
  TENDER247_SHAREPOINT_SAFE_PATH_LENGTH,
  tender247DocumentPath,
} from "./index.ts";
import { SharePointGraphError } from "./sharePointStorage.ts";

const SERVICE_KEY = "test-service-role-key";
const TENDER_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("Tender247 SharePoint paths use persisted scrapedDate, not execution date", () => {
  Deno.env.set("MICROSOFT_GRAPH_TENANT_ID", "tenant"); Deno.env.set("MICROSOFT_GRAPH_CLIENT_ID", "client"); Deno.env.set("MICROSOFT_GRAPH_CLIENT_SECRET", "secret");
  const onScrapeDay = tender247DocumentPath(TENDER_ID, "doc-1", "notice.pdf", "2026-10-08");
  const resumedLater = tender247DocumentPath(TENDER_ID, "doc-1", "notice.pdf", "2026-10-08");
  assertEquals(onScrapeDay, resumedLater);
  if (!onScrapeDay.includes("/tender247/2026-10-08/")) throw new Error(`wrong date path: ${onScrapeDay}`);
  if (onScrapeDay.includes("2026-10-09")) throw new Error(`runtime date leaked into path: ${onScrapeDay}`);
});

Deno.test("Tender247 stored filenames are deterministic, extension-preserving, collision-safe, and path-bounded", () => {
  configureGraphEnv();
  const short = resolveTender247StoredFilename(TENDER_ID, "external-a", "Notice Final.pdf", "2026-10-08");
  assertEquals(short.storedFilename, "notice-final.pdf"); assertEquals(short.filenameShortened, false);
  const longName = `${"very-long-source-document-".repeat(30)}.PDF`;
  const first = resolveTender247StoredFilename(TENDER_ID, "external-a", longName, "2026-10-08");
  const repeated = resolveTender247StoredFilename(TENDER_ID, "external-a", longName, "2026-10-08");
  const second = resolveTender247StoredFilename(TENDER_ID, "external-b", longName, "2026-10-08");
  assertEquals(first.filenameShortened, true); assertEquals(first.storedFilename, repeated.storedFilename);
  if (!first.storedFilename.endsWith(".pdf")) throw new Error("extension was not preserved");
  if (first.storedFilename === second.storedFilename) throw new Error("truncated filenames collided");
  if (first.targetRelativePathLength > TENDER247_SHAREPOINT_SAFE_PATH_LENGTH) throw new Error("stored path exceeded safe limit");
  assertEquals(tender247DocumentPath(TENDER_ID, "external-a", longName, "2026-10-08").length, first.targetRelativePathLength);
});

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) throw new Error(message || `expected ${expected}, got ${actual}`);
}

function request(action: string, body: Record<string, unknown> = {}, authorization?: string) {
  return new Request("http://localhost", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ action, ...(action === "createTender247UploadSession" ? { scrapedDate: "2026-10-08" } : {}), ...body }),
  });
}

Deno.test({ name: "Tender247 endpoints reject unauthenticated and normal-user requests", sanitizeOps: false, fn: async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  __setTender247TestDependenciesForTests(null);
  const unauthenticated = await handleCompanyDocumentsRequest(request("createTender247UploadSession"));
  assertEquals(unauthenticated.status, 401);
  const normalUser = await handleCompanyDocumentsRequest(request("finalizeTender247Upload", {}, "Bearer ordinary-user-token"));
  assertEquals(normalUser.status, 401);
}});

Deno.test({ name: "Tender247 create session validates UUID and traversal before database or Graph access", sanitizeOps: false, fn: async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  __setTender247TestDependenciesForTests({
    serviceSupabase: () => { throw new Error("database must not be called for invalid input"); },
  } as never);
  const invalidId = await handleCompanyDocumentsRequest(request("createTender247UploadSession", {
    tenderId: "not-a-uuid", externalDocumentId: "doc-1", filename: "file.pdf", mimeType: "application/pdf", expectedBytes: 1,
  }, `Bearer ${SERVICE_KEY}`));
  assertEquals(invalidId.status, 400);
  const traversal = await handleCompanyDocumentsRequest(request("createTender247UploadSession", {
    tenderId: TENDER_ID, externalDocumentId: "doc-1", filename: "../file.pdf", mimeType: "application/pdf", expectedBytes: 1,
  }, `Bearer ${SERVICE_KEY}`));
  assertEquals(traversal.status, 400);
  __setTender247TestDependenciesForTests(null);
}});

Deno.test({ name: "Tender247 chunk action requires service role before reading a session", sanitizeOps: false, fn: async () => {
  const response = await handleCompanyDocumentsRequest(new Request("http://localhost", {
    method: "POST",
    headers: { "x-upload-action": "tender247-upload-chunk", "content-type": "application/octet-stream" },
    body: new Uint8Array([1]),
  }));
  assertEquals(response.status, 401);
}});

type Row = Record<string, unknown>;

/** Minimal in-memory PostgREST mock used by the real handlers, never a network client. */
function memoryDatabase(seed: { tender?: Row | null; documents?: Row[]; sessions?: Row[]; race?: boolean } = {}) {
  const state = {
    tender: seed.tender === undefined ? { id: TENDER_ID } : seed.tender,
    documents: [...(seed.documents || [])], sessions: [...(seed.sessions || [])],
    inserts: [] as Array<{ table: string; row: Row }>, updates: [] as Array<{ table: string; row: Row }>,
    race: Boolean(seed.race),
  };
  const rows = (table: string): Row[] => table === "agenttender_tender_documents" ? state.documents
    : table === "agenttender_tender_document_upload_sessions" ? state.sessions : [];
  class Query {
    filters: Array<[string, unknown, boolean]> = []; payload: Row | null = null; mode = "select";
    constructor(readonly table: string) {}
    select() { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value, false]); return this; }
    neq(key: string, value: unknown) { this.filters.push([key, value, true]); return this; }
    insert(value: Row) { this.mode = "insert"; this.payload = { id: crypto.randomUUID(), ...value }; return this; }
    update(value: Row) { this.mode = "update"; this.payload = value; return this; }
    match(row: Row) { return this.filters.every(([k, v, neq]) => neq ? row[k] !== v : row[k] === v); }
    result() {
      if (this.table === "agenttender_tenders") return { data: this.stateTender(), error: null };
      const list = rows(this.table);
      if (this.mode === "insert") {
        if (this.table === "agenttender_tender_documents" && state.race) {
          state.race = false; state.documents.push({ ...this.payload! });
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        list.push(this.payload!); state.inserts.push({ table: this.table, row: { ...this.payload! } });
        return { data: this.payload, error: null };
      }
      const found = list.filter((row) => this.match(row));
      if (this.mode === "update") {
        for (const row of found) Object.assign(row, this.payload!);
        if (found[0]) state.updates.push({ table: this.table, row: { ...this.payload! } });
      }
      return { data: this.mode === "update" ? found[0] || null : found[0] || null, error: null };
    }
    stateTender() { return this.filters.every(([k, v]) => state.tender?.[k] === v) ? state.tender : null; }
    maybeSingle() { return Promise.resolve(this.result()); }
    single() { return Promise.resolve(this.result()); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  return { state, client: { from: (table: string) => new Query(table) } };
}

function configureGraphEnv() {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  Deno.env.set("MICROSOFT_GRAPH_TENANT_ID", "tenant");
  Deno.env.set("MICROSOFT_GRAPH_CLIENT_ID", "client");
  Deno.env.set("MICROSOFT_GRAPH_CLIENT_SECRET", "secret");
}

function createRequest(values: Row = {}) {
  return request("createTender247UploadSession", {
    tenderId: TENDER_ID, externalDocumentId: "external-doc-1", filename: "notice.pdf",
    mimeType: "application/pdf", expectedBytes: 4, ...values,
  }, `Bearer ${SERVICE_KEY}`);
}

function chunkRequest(values: Record<string, string> = {}, source?: Uint8Array<ArrayBufferLike>) {
  const input = source ?? new Uint8Array([1, 2, 3, 4]);
  const buffer = new ArrayBuffer(input.byteLength);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  bytes.set(input);
  return new Request("http://localhost", { method: "POST", headers: {
    "x-upload-action": "tender247-upload-chunk", "content-type": "application/octet-stream",
    "authorization": `Bearer ${SERVICE_KEY}`, "x-tender247-session-id": "22222222-2222-4222-8222-222222222222",
    "x-tender247-document-id": "33333333-3333-4333-8333-333333333333",
    "x-tender247-start-byte": "0", "x-tender247-end-byte": "3", "x-tender247-total-bytes": "4", ...values,
  }, body: bytes });
}

Deno.test("create session: creates, persists, hides Graph URL, and reuses canonical rows", async () => {
  configureGraphEnv();
  const db = memoryDatabase(); let graphCalls = 0;
  __setTender247TestDependenciesForTests({ serviceSupabase: () => db.client as never,
    createSharePointUploadSession: async () => { graphCalls++; return { existed: false as const, path: "x", session: { uploadUrl: "https://mock.graph/upload-secret", expirationDateTime: "2999-01-01T00:00:00Z" } }; },
  });
  const stage = { staged_id: "44444444-4444-4444-8444-444444444444", staged_size: 4, staged_filename: "notice.pdf", staged_content_type: "application/pdf", staged_expires_at: "2999-01-01T00:00:00Z" };
  const response = await handleCompanyDocumentsRequest(createRequest({ stagedMetadata: stage })); const body = await response.json();
  assertEquals(response.status, 200); assertEquals(body.status, "UPLOAD_REQUIRED"); assertEquals(graphCalls, 1);
  assertEquals(db.state.documents.length, 1); assertEquals(db.state.documents[0].external_source, "TENDER247");
  assertEquals(db.state.inserts[0].row.storage_status, "PENDING"); assertEquals(db.state.documents[0].storage_status, "UPLOADING");
  assertEquals(db.state.sessions.length, 1); assertEquals(db.state.sessions[0].graph_upload_url, "https://mock.graph/upload-secret");
  assertEquals((db.state.sessions[0].staging_metadata as Row).staged_id, stage.staged_id);
  if (JSON.stringify(body).includes("upload-secret")) throw new Error("Graph URL leaked in response");
  await handleCompanyDocumentsRequest(createRequest()); assertEquals(db.state.documents.length, 1); assertEquals(graphCalls, 1);
  __setTender247TestDependenciesForTests(null);
});

Deno.test("create session: not-found, bad external identity, completed, expired, failed, and unique-race cases", async () => {
  configureGraphEnv();
  const noTender = memoryDatabase({ tender: null });
  __setTender247TestDependenciesForTests({ serviceSupabase: () => noTender.client as never });
  assertEquals((await handleCompanyDocumentsRequest(createRequest())).status, 404);
  const invalid = await handleCompanyDocumentsRequest(createRequest({ externalDocumentId: "../bad" })); assertEquals(invalid.status, 400);
  const completed = memoryDatabase({ documents: [{ id: "d", tender_id: TENDER_ID, external_source: "TENDER247", external_document_id: "external-doc-1", file_name: "original-source-name.pdf", storage_status: "COMPLETED", storage_url: "https://safe", sharepoint_drive_item_id: "drive-item" }] });
  let calls = 0; __setTender247TestDependenciesForTests({ serviceSupabase: () => completed.client as never, createSharePointUploadSession: async () => { calls++; throw new Error("must not call"); } });
  const completeResponse = await (await handleCompanyDocumentsRequest(createRequest())).json();
  assertEquals(completeResponse.status, "ALREADY_STORED"); assertEquals(completeResponse.document.file_name, "original-source-name.pdf"); assertEquals(calls, 0);
  const active = memoryDatabase({ documents: [{ id: "d", tender_id: TENDER_ID, external_source: "TENDER247", external_document_id: "external-doc-1", storage_status: "UPLOADING" }], sessions: [{ id: "s", tender_document_id: "d", status: "ACTIVE", expected_bytes: 4, expires_at: "2999-01-01T00:00:00Z" }] });
  __setTender247TestDependenciesForTests({ serviceSupabase: () => active.client as never });
  assertEquals((await (await handleCompanyDocumentsRequest(createRequest())).json()).sessionId, "s");
  const race = memoryDatabase({ race: true }); __setTender247TestDependenciesForTests({ serviceSupabase: () => race.client as never, createSharePointUploadSession: async () => ({ existed: false as const, path: "x", session: { uploadUrl: "mock", expirationDateTime: "2999-01-01T00:00:00Z" } }) });
  assertEquals((await handleCompanyDocumentsRequest(createRequest())).status, 200); assertEquals(race.state.documents.length, 1);
  __setTender247TestDependenciesForTests(null);
});

Deno.test("create session reconciles with the same shortened stored filename", async () => {
  configureGraphEnv();
  const documentId = "44444444-4444-4444-8444-444444444444";
  const longName = `${"reconciliation-source-name-".repeat(30)}.pdf`;
  const db = memoryDatabase({ documents: [{ id: documentId, tender_id: TENDER_ID, external_source: "TENDER247", external_document_id: "external-doc-1", file_name: longName, storage_status: "PENDING" }] });
  let lookupPath = "";
  __setTender247TestDependenciesForTests({
    serviceSupabase: () => db.client as never,
    getSharePointItemByPath: async (path) => { lookupPath = path; return { id: "existing-item", name: "shortened.pdf", webUrl: "https://sharepoint.example/file" }; },
  });
  const response = await handleCompanyDocumentsRequest(createRequest({ filename: longName, existingCanonicalDocumentId: documentId }));
  const body = await response.json();
  assertEquals(response.status, 200); assertEquals(body.status, "ALREADY_STORED");
  assertEquals(lookupPath, tender247DocumentPath(TENDER_ID, "external-doc-1", longName, "2026-10-08"));
  assertEquals(db.state.documents[0].file_name, longName);
  __setTender247TestDependenciesForTests(null);
});

Deno.test("create session: preserves a sanitized Graph status and error code for the recovery CLI", async () => {
  configureGraphEnv();
  const db = memoryDatabase();
  __setTender247TestDependenciesForTests({
    serviceSupabase: () => db.client as never,
    createSharePointUploadSession: async () => {
      throw new SharePointGraphError("Access denied", 403, { error: { code: "accessDenied", message: "Access denied" }, uploadUrl: "https://secret.example" });
    },
  });
  const response = await handleCompanyDocumentsRequest(createRequest());
  const body = await response.json();
  assertEquals(response.status, 500);
  assertEquals(body.error, "Microsoft Graph createUploadSession failed (HTTP 403, accessDenied): Access denied");
  if (JSON.stringify(body).includes("secret.example")) throw new Error("Graph upload URL leaked in error response");
  __setTender247TestDependenciesForTests(null);
});

Deno.test("chunk: uses server session URL, writes Content-Range, advances or stores completion", async () => {
  configureGraphEnv(); const doc = { id: "33333333-3333-4333-8333-333333333333", external_source: "TENDER247", storage_status: "UPLOADING" };
  const session = { id: "22222222-2222-4222-8222-222222222222", tender_document_id: doc.id, status: "ACTIVE", expires_at: "2999-01-01T00:00:00Z", expected_bytes: 4, next_expected_byte: 0, graph_upload_url: "https://mock.graph/persisted" };
  const db = memoryDatabase({ documents: [doc], sessions: [session] }); __setTender247TestDependenciesForTests({ serviceSupabase: () => db.client as never });
  const originalFetch = globalThis.fetch; let range = ""; let url = "";
  globalThis.fetch = async (input, init) => { url = String(input); range = new Headers(init?.headers).get("Content-Range") || ""; return new Response(JSON.stringify({}), { status: 202 }); };
  const continued = await handleCompanyDocumentsRequest(chunkRequest({ "x-graph-url": "https://attacker" }));
  assertEquals(continued.status, 200); assertEquals(url, "https://mock.graph/persisted"); assertEquals(range, "bytes 0-3/4"); assertEquals(db.state.sessions[0].next_expected_byte, 4);
  db.state.sessions[0].next_expected_byte = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "drive-item", webUrl: "https://sharepoint/file", name: "notice.pdf", size: 4 }), { status: 201 });
  assertEquals((await handleCompanyDocumentsRequest(chunkRequest())).status, 200); assertEquals((db.state.sessions[0].completion_metadata as Row).id, "drive-item");
  globalThis.fetch = originalFetch; __setTender247TestDependenciesForTests(null);
});

Deno.test("chunk: rejects unknown, mismatch, completed, expired, ranges and bad chunk length", async () => {
  configureGraphEnv(); const base = { id: "22222222-2222-4222-8222-222222222222", tender_document_id: "33333333-3333-4333-8333-333333333333", status: "ACTIVE", expected_bytes: 4, next_expected_byte: 0, expires_at: "2999-01-01T00:00:00Z", graph_upload_url: "mock" };
  const run = async (session: Row[], documents: Row[], headers: Record<string, string> = {}, bytes?: Uint8Array) => { const db = memoryDatabase({ sessions: session, documents }); __setTender247TestDependenciesForTests({ serviceSupabase: () => db.client as never }); return await handleCompanyDocumentsRequest(chunkRequest(headers, bytes)); };
  assertEquals((await run([], [])).status, 404);
  assertEquals((await run([{ ...base, tender_document_id: "other" }], [])).status, 404);
  assertEquals((await run([base], [{ id: base.tender_document_id, external_source: "OTHER", storage_status: "UPLOADING" }])).status, 404);
  assertEquals((await run([base], [{ id: base.tender_document_id, external_source: "TENDER247", storage_status: "COMPLETED" }])).status, 409);
  assertEquals((await run([{ ...base, expires_at: "2000-01-01T00:00:00Z" }], [{ id: base.tender_document_id, external_source: "TENDER247", storage_status: "UPLOADING" }])).status, 410);
  assertEquals((await run([base], [{ id: base.tender_document_id, external_source: "TENDER247", storage_status: "UPLOADING" }], { "x-tender247-end-byte": "4" })).status, 400);
  assertEquals((await run([base], [{ id: base.tender_document_id, external_source: "TENDER247", storage_status: "UPLOADING" }], {}, new Uint8Array([1]))).status, 400);
  assertEquals((await run([base], [{ id: base.tender_document_id, external_source: "TENDER247", storage_status: "UPLOADING" }], { "x-tender247-total-bytes": "5" })).status, 409);
  __setTender247TestDependenciesForTests(null);
});

Deno.test("finalize: trusted completion metadata completes once, clears staged metadata, and validates ownership", async () => {
  configureGraphEnv(); const doc = { id: "33333333-3333-4333-8333-333333333333", tender_id: TENDER_ID, external_source: "TENDER247", external_document_id: "external-doc-1", storage_status: "UPLOADING", file_name: "old.pdf", file_size_bytes: 4 };
  const session = { id: "22222222-2222-4222-8222-222222222222", tender_document_id: doc.id, tender_id: TENDER_ID, external_document_id: "external-doc-1", status: "ACTIVE", staging_metadata: { staged_id: "44444444-4444-4444-8444-444444444444" }, completion_metadata: { id: "drive-item", webUrl: "https://trusted.sharepoint/file", name: "new.pdf", size: 4 } };
  const db = memoryDatabase({ documents: [doc], sessions: [session] }); __setTender247TestDependenciesForTests({ serviceSupabase: () => db.client as never });
  const response = await handleCompanyDocumentsRequest(request("finalizeTender247Upload", { tenderId: TENDER_ID, documentId: doc.id, sessionId: session.id, externalDocumentId: "external-doc-1", storage_url: "https://attacker" }, `Bearer ${SERVICE_KEY}`));
  assertEquals(response.status, 200); assertEquals(db.state.documents[0].storage_url, "https://trusted.sharepoint/file"); assertEquals(db.state.documents[0].sharepoint_drive_item_id, "drive-item"); assertEquals(db.state.documents[0].storage_status, "COMPLETED");
  if (!db.state.documents[0].completed_at) throw new Error("completed_at missing"); assertEquals(db.state.sessions[0].status, "COMPLETED"); assertEquals(db.state.sessions[0].staging_metadata, null);
  assertEquals((await handleCompanyDocumentsRequest(request("finalizeTender247Upload", { tenderId: TENDER_ID, documentId: doc.id, sessionId: session.id, externalDocumentId: "external-doc-1" }, `Bearer ${SERVICE_KEY}`))).status, 200);
  const bad = await handleCompanyDocumentsRequest(request("finalizeTender247Upload", { tenderId: "44444444-4444-4444-8444-444444444444", documentId: doc.id, sessionId: session.id, externalDocumentId: "external-doc-1" }, `Bearer ${SERVICE_KEY}`)); assertEquals(bad.status, 404);
  __setTender247TestDependenciesForTests(null);
});
