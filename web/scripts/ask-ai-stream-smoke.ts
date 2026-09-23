/**
 * Phase 5 streaming smoke test (synthetic indexed evidence).
 *
 * Usage (from web/):
 *   npx tsx scripts/ask-ai-stream-smoke.ts
 */
import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as NodeModule;

const COMPANY_ID = "6d6ad696-be7a-4fe6-a84a-66595924966f";
const SOURCE_ID = `phase5_smoke:${randomUUID()}`;

async function main() {
  const { getServerSupabase } = await import("../src/lib/db/server");
  const { embedTexts } = await import("../src/server/ai/rag/embeddings");
  const { streamTenderRagAnswer } = await import(
    "../src/server/ai/rag/stream-ask-ai"
  );

  const supabase = getServerSupabase();
  const { data: tender, error } = await supabase
    .from("agenttender_tenders")
    .select("id, title")
    .limit(1)
    .maybeSingle();
  if (error || !tender) throw new Error(error?.message || "No tender");

  const tenderId = String(tender.id);
  const texts = [
    "Mandatory eligibility: Average Annual Turnover not less than INR 5 Crore for the last three financial years.",
    "Similar experience: at least two government or PSU facility management projects of INR 50 Lakh each in five years.",
    "EMD of INR 2,00,000. MSME/MSE/Startup exemption available with valid registration proof.",
  ];
  const { embeddings } = await embedTexts(texts);
  const now = new Date().toISOString();
  await supabase.from("agenttender_ai_document_chunks").insert(
    texts.map((content, index) => ({
      company_id: COMPANY_ID,
      tender_id: tenderId,
      source_type: "TENDER_DOCUMENT",
      source_id: SOURCE_ID,
      document_name: "Phase5_Smoke_RFP.pdf",
      section: `Section ${index + 1}`,
      chunk_index: index,
      content,
      content_hash: `smoke-${SOURCE_ID}`,
      embedding: embeddings[index],
      metadata: { smoke: true, phase: 5 },
      is_active: true,
      created_at: now,
      updated_at: now,
    })),
  );
  await supabase.from("agenttender_ai_document_index_status").upsert(
    {
      company_id: COMPANY_ID,
      tender_id: tenderId,
      source_type: "TENDER_DOCUMENT",
      source_id: SOURCE_ID,
      document_name: "Phase5_Smoke_RFP.pdf",
      status: "INDEXED",
      chunk_count: texts.length,
      content_hash: `smoke-${SOURCE_ID}`,
      last_indexed_at: now,
      last_attempted_at: now,
      error_message: null,
      updated_at: now,
      created_at: now,
    },
    { onConflict: "source_type,source_id" },
  );

  const questions = [
    "What are the key eligibility requirements?",
    "What is the turnover requirement?",
    "Is MSME exemption available?",
  ];

  for (const message of questions) {
    const started = Date.now();
    let firstDeltaAt: number | null = null;
    let answer = "";
    let statusCount = 0;
    let doneMeta: Record<string, unknown> | null = null;
    const eventTypes: string[] = [];

    for await (const event of streamTenderRagAnswer({
      tenderId,
      companyId: COMPANY_ID,
      message,
    })) {
      eventTypes.push(event.type);
      if (event.type === "status") statusCount += 1;
      if (event.type === "delta") {
        if (firstDeltaAt == null) firstDeltaAt = Date.now();
        answer += event.text;
      }
      if (event.type === "done") {
        doneMeta = event.retrievalMeta as unknown as Record<string, unknown>;
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    console.log(
      JSON.stringify({
        message,
        eventTypes,
        statusBeforeDelta:
          eventTypes.indexOf("status") >= 0 &&
          eventTypes.indexOf("status") < eventTypes.indexOf("delta"),
        statusCount,
        answerChars: answer.length,
        answerPreview: answer.slice(0, 160).replace(/\s+/g, " "),
        retrieval_ms: doneMeta?.retrievalTotalMs ?? null,
        first_token_ms: doneMeta?.llmFirstTokenMs ?? (firstDeltaAt ? firstDeltaAt - started : null),
        llm_total_ms: doneMeta?.llmMs ?? null,
        total_ms: doneMeta?.totalMs ?? Date.now() - started,
        tender_chunks: doneMeta?.tenderChunks ?? null,
        company_chunks: doneMeta?.companyChunks ?? null,
      }),
    );
  }

  await supabase
    .from("agenttender_ai_document_chunks")
    .delete()
    .eq("source_id", SOURCE_ID);
  await supabase
    .from("agenttender_ai_document_index_status")
    .delete()
    .eq("source_id", SOURCE_ID);
  console.log(JSON.stringify({ cleanup: true, sourceId: SOURCE_ID }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
