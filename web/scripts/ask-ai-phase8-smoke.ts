/**
 * Phase 8 production smoke: 9 quick actions twice (miss then hit) + one GENERAL.
 *
 * Usage (from web/):
 *   npx tsx scripts/ask-ai-phase8-smoke.ts
 */
import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });
process.env.AI_ASK_DEV_META = "true";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as NodeModule;

const COMPANY_ID = "6d6ad696-be7a-4fe6-a84a-66595924966f";
const SOURCE_ID = `phase8_smoke:${randomUUID()}`;

async function runAction(options: {
  tenderId: string;
  message: string;
  action: string | null;
}) {
  const { streamTenderRagAnswer } = await import(
    "../src/server/ai/rag/stream-ask-ai"
  );
  const started = Date.now();
  let firstDeltaAt: number | null = null;
  let answer = "";
  let sourceCount = 0;
  let doneMeta: Record<string, unknown> | null = null;
  for await (const event of streamTenderRagAnswer({
    tenderId: options.tenderId,
    companyId: COMPANY_ID,
    userId: "00000000-0000-4000-8000-000000000001",
    message: options.message,
    action: options.action,
  })) {
    if (event.type === "delta") {
      if (firstDeltaAt == null) firstDeltaAt = Date.now();
      answer += event.text;
    }
    if (event.type === "sources") sourceCount = event.sources.length;
    if (event.type === "done") {
      doneMeta = (event.retrievalMeta || null) as Record<string, unknown> | null;
    }
    if (event.type === "error") throw new Error(event.message);
  }
  return {
    totalMs: Date.now() - started,
    firstTokenMs: firstDeltaAt != null ? firstDeltaAt - started : null,
    cacheHit: Boolean(doneMeta?.cacheHit),
    inputTokens: doneMeta?.inputTokens ?? null,
    outputTokens: doneMeta?.outputTokens ?? null,
    estimatedCostUsd: doneMeta?.estimatedCostUsd ?? null,
    sourceCount,
    answerChars: answer.length,
    answerPreview: answer.slice(0, 160).replace(/\s+/g, " "),
  };
}

async function main() {
  const { getServerSupabase } = await import("../src/lib/db/server");
  const { embedTexts } = await import("../src/server/ai/rag/embeddings");
  const { ASK_AI_QUICK_ACTIONS } = await import("../src/lib/ai/ask-ai-actions");
  const { indexCompanyProfile } = await import(
    "../src/server/ai/rag/company-knowledge"
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
    "Average Annual Turnover of not less than INR 5 Crore for FY 2022-23, 2023-24, 2024-25. CA certificate required.",
    "Similar experience: two Government/PSU facility management projects of INR 50 Lakh each in five years.",
    "EMD INR 2,00,000 as BG/DD. MSME/MSE/Startup exemption with valid registration proof.",
    "Mandatory documents: GST, PAN, CA turnover certificate, work orders, completion certificates, affidavits.",
    "Authority: Demo Municipal Corporation. Closing date 15 Oct 2026. Estimated value INR 3 Crore.",
  ];
  const { embeddings } = await embedTexts(texts);
  const now = new Date().toISOString();
  await supabase.from("agenttender_ai_document_chunks").insert(
    texts.map((content, index) => ({
      company_id: COMPANY_ID,
      tender_id: tenderId,
      source_type: "TENDER_DOCUMENT",
      source_id: SOURCE_ID,
      document_name: "Phase8_Smoke_RFP.pdf",
      section: `S${index + 1}`,
      chunk_index: index,
      content,
      content_hash: `smoke-${SOURCE_ID}`,
      embedding: embeddings[index],
      metadata: { smoke: true, phase: 8 },
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
      document_name: "Phase8_Smoke_RFP.pdf",
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

  await indexCompanyProfile(COMPANY_ID).catch(() => undefined);

  console.log(
    JSON.stringify({
      step: "prepare",
      tenderId,
      sourceId: SOURCE_ID,
    }),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const quick of ASK_AI_QUICK_ACTIONS) {
    const miss = await runAction({
      tenderId,
      message: quick.message,
      action: quick.action,
    });
    const hit = await runAction({
      tenderId,
      message: quick.message,
      action: quick.action,
    });
    const row = {
      action: quick.action,
      missTotalMs: miss.totalMs,
      hitTotalMs: hit.totalMs,
      missFirstTokenMs: miss.firstTokenMs,
      hitFirstTokenMs: hit.firstTokenMs,
      missCacheHit: miss.cacheHit,
      hitCacheHit: hit.cacheHit,
      inputTokens: miss.inputTokens,
      outputTokens: miss.outputTokens,
      estimatedCostUsd: miss.estimatedCostUsd,
      missSources: miss.sourceCount,
      hitSources: hit.sourceCount,
    };
    rows.push(row);
    console.log(JSON.stringify({ step: "action_pair", ...row }));
  }

  const general = await runAction({
    tenderId,
    message: "What is the closing date for this tender?",
    action: null,
  });
  console.log(
    JSON.stringify({
      step: "general",
      ...general,
      cacheHit: general.cacheHit,
    }),
  );

  await supabase
    .from("agenttender_ai_document_chunks")
    .delete()
    .eq("source_id", SOURCE_ID);
  await supabase
    .from("agenttender_ai_document_index_status")
    .delete()
    .eq("source_id", SOURCE_ID);

  const missAvg = Math.round(
    rows.reduce((s, r) => s + Number(r.missTotalMs || 0), 0) / rows.length,
  );
  const hitAvg = Math.round(
    rows.reduce((s, r) => s + Number(r.hitTotalMs || 0), 0) / rows.length,
  );
  const costSum = rows.reduce(
    (s, r) => s + Number(r.estimatedCostUsd || 0),
    0,
  );

  console.log(
    JSON.stringify({
      step: "summary",
      missAvgMs: missAvg,
      hitAvgMs: hitAvg,
      allSecondRunCacheHits: rows.every((r) => r.hitCacheHit === true),
      sumEstimatedCostUsd9Actions: Number(costSum.toFixed(6)),
      avgEstimatedCostUsd: Number((costSum / rows.length).toFixed(6)),
    }),
  );
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
