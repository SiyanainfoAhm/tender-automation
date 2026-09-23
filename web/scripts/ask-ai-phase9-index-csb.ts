import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as NodeModule;

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER = "24950c4e-a9d5-4c07-bb4f-82152930a2fe";
const TENDER = "b4a82ba2-3a5a-42d3-8358-711066d9865d";

async function main() {
  const { getServerSupabase } = await import("../src/lib/db/server");
  const {
    indexTenderKnowledge,
    indexCompanyDocument,
    indexCompanyProfile,
  } = await import("../src/server/ai/rag");
  const sb = getServerSupabase();
  const token = randomBytes(32).toString("base64url");
  const { data: sess, error } = await sb
    .from("agenttender_user_sessions")
    .insert({
      user_id: USER,
      token_hash: createHash("sha256").update(token).digest("hex"),
      expires_at: new Date(Date.now() + 3600e3).toISOString(),
      user_agent: "phase9-csb",
      ip_address: "127.0.0.1",
    })
    .select("id")
    .single();
  if (error || !sess) throw new Error(error?.message || "session");
  process.env.AI_INDEX_SESSION_TOKEN = token;

  try {
    await indexCompanyProfile(COMPANY);
    const docs = await sb
      .from("agenttender_company_documents")
      .select("id,name")
      .eq("company_id", COMPANY)
      .eq("status", "active")
      .or(
        "name.ilike.%MSME%,name.ilike.%Experience%,name.ilike.%CMMI%,name.ilike.%Udyam%,name.ilike.%Siyana%",
      )
      .limit(8);
    for (const d of docs.data || []) {
      try {
        const r = await indexCompanyDocument({
          companyId: COMPANY,
          documentId: String(d.id),
        });
        console.log(
          JSON.stringify({
            doc: String(d.name || "").slice(0, 40),
            status: r.status,
            chunks: r.chunkCount,
            err: r.errorMessage?.slice(0, 100) ?? null,
          }),
        );
      } catch (e) {
        console.log(
          JSON.stringify({
            doc: String(d.name || "").slice(0, 40),
            err: e instanceof Error ? e.message.slice(0, 120) : String(e),
          }),
        );
      }
    }

    const started = Date.now();
    const results = await indexTenderKnowledge({
      companyId: COMPANY,
      tenderId: TENDER,
    });
    console.log(
      JSON.stringify({
        tender: TENDER,
        totalMs: Date.now() - started,
        results: results.map((r) => ({
          id: r.sourceId.slice(0, 36),
          status: r.status,
          chunks: r.chunkCount,
          err: r.errorMessage?.slice(0, 120) ?? null,
          hash: r.contentHash?.slice(0, 12) ?? null,
        })),
      }),
    );
    const { count } = await sb
      .from("agenttender_ai_document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("tender_id", TENDER)
      .eq("is_active", true);
    console.log(JSON.stringify({ activeTenderChunks: count }));
  } finally {
    await sb
      .from("agenttender_user_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: "phase9_csb",
      })
      .eq("id", sess.id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
