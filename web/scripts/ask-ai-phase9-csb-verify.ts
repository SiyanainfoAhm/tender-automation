/**
 * Phase 9 verification on CSB AMC tender (real indexed portal zip).
 */
import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });
process.env.AI_ASK_DEV_META = "true";

const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as NodeModule;

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER = "24950c4e-a9d5-4c07-bb4f-82152930a2fe";
const TENDER = "b4a82ba2-3a5a-42d3-8358-711066d9865d";

async function ask(message: string, action?: string) {
  const { streamTenderRagAnswer } = await import(
    "../src/server/ai/rag/stream-ask-ai"
  );
  const started = Date.now();
  let first: number | null = null;
  let answer = "";
  let sources: string[] = [];
  let meta: Record<string, unknown> | null = null;
  for await (const ev of streamTenderRagAnswer({
    tenderId: TENDER,
    companyId: COMPANY,
    userId: USER,
    message,
    action,
  })) {
    if (ev.type === "delta") {
      if (first == null) first = Date.now();
      answer += ev.text;
    }
    if (ev.type === "sources") {
      sources = ev.sources.map((s) => String(s.id || ""));
    }
    if (ev.type === "done") meta = (ev.retrievalMeta || null) as Record<string, unknown> | null;
    if (ev.type === "error") throw new Error(ev.message);
  }
  return {
    totalMs: Date.now() - started,
    firstTokenMs: first != null ? first - started : null,
    cacheHit: Boolean(meta?.cacheHit),
    tenderChunks: meta?.tenderChunks,
    companyChunks: meta?.companyChunks,
    cost: meta?.estimatedCostUsd,
    sources,
    preview: answer.slice(0, 500).replace(/\s+/g, " "),
    answer,
  };
}

async function main() {
  const { ASK_AI_QUICK_ACTIONS } = await import("../src/lib/ai/ask-ai-actions");
  const { getServerSupabase } = await import("../src/lib/db/server");
  const sb = getServerSupabase();

  // Sample tender evidence (safe prefixes only)
  const { data: samples } = await sb
    .from("agenttender_ai_document_chunks")
    .select("section, page_number, left(content, 200) as snippet")
    .eq("tender_id", TENDER)
    .eq("is_active", true)
    .limit(8);
  console.log(JSON.stringify({ step: "evidence_sample", samples }, null, 2));

  for (const q of ASK_AI_QUICK_ACTIONS) {
    const miss = await ask(q.message, q.action);
    const hit = await ask(q.message, q.action);
    console.log(
      JSON.stringify({
        step: "action",
        action: q.action,
        missMs: miss.totalMs,
        hitMs: hit.totalMs,
        hitCache: hit.cacheHit,
        firstToken: miss.firstTokenMs,
        tChunks: miss.tenderChunks,
        cChunks: miss.companyChunks,
        cost: miss.cost,
        sources: miss.sources,
        preview: miss.preview,
      }),
    );
  }

  // Critical field probes
  for (const q of [
    "What is the exact turnover / average annual turnover requirement including years?",
    "What is the EMD amount, payment mode, and any MSME exemption?",
    "What similar work experience is required including project count and value?",
    "Is government/PSU experience mandatory, preferred, scoring, or not required?",
  ]) {
    const r = await ask(q);
    console.log(
      JSON.stringify({
        step: "critical",
        q,
        preview: r.preview,
        sources: r.sources,
        tChunks: r.tenderChunks,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
