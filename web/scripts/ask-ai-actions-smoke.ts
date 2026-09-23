/**
 * Phase 7 quick-action smoke: all 9 actions via the streaming RAG path.
 *
 * Usage (from web/):
 *   npx tsx scripts/ask-ai-actions-smoke.ts
 *
 * Prefers a real indexed tender when available; otherwise seeds synthetic chunks.
 * Prints safe metadata only (no document bodies / embeddings).
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
const SOURCE_ID = `phase7_smoke:${randomUUID()}`;

async function main() {
  const { getServerSupabase } = await import("../src/lib/db/server");
  const { embedTexts } = await import("../src/server/ai/rag/embeddings");
  const { streamTenderRagAnswer } = await import(
    "../src/server/ai/rag/stream-ask-ai"
  );
  const { ASK_AI_QUICK_ACTIONS } = await import("../src/lib/ai/ask-ai-actions");
  const { indexCompanyProfile } = await import(
    "../src/server/ai/rag/company-knowledge"
  );

  const supabase = getServerSupabase();

  // Prefer a tender that already has indexed tender chunks.
  const { data: indexedChunk } = await supabase
    .from("agenttender_ai_document_chunks")
    .select("tender_id")
    .eq("source_type", "TENDER_DOCUMENT")
    .eq("is_active", true)
    .not("tender_id", "is", null)
    .limit(1)
    .maybeSingle();

  let tenderId: string;
  let seeded = false;
  let title: string | null = null;

  if (indexedChunk?.tender_id) {
    tenderId = String(indexedChunk.tender_id);
    const { data: tender } = await supabase
      .from("agenttender_tenders")
      .select("id, title")
      .eq("id", tenderId)
      .maybeSingle();
    title =
      typeof tender?.title === "string" ? tender.title.slice(0, 100) : null;
    console.log(
      JSON.stringify({
        step: "prepare",
        mode: "real_indexed",
        tenderId,
        title,
        companyId: COMPANY_ID,
      }),
    );
  } else {
    const { data: tender, error } = await supabase
      .from("agenttender_tenders")
      .select("id, title")
      .limit(1)
      .maybeSingle();
    if (error || !tender) {
      throw new Error(error?.message || "No tender available for smoke test.");
    }
    tenderId = String(tender.id);
    title =
      typeof tender.title === "string" ? tender.title.slice(0, 100) : null;
    seeded = true;
    console.log(
      JSON.stringify({
        step: "prepare",
        mode: "synthetic_seed",
        tenderId,
        title,
        companyId: COMPANY_ID,
      }),
    );

    const texts = [
      {
        section: "Financial Eligibility",
        content:
          "The bidder shall have Average Annual Turnover of not less than INR 5 Crore during the last three financial years (FY 2022-23, 2023-24, 2024-25). Audited financial statements / CA certificate must be submitted.",
      },
      {
        section: "Similar Experience",
        content:
          "The bidder must have successfully completed at least two similar works of facility management / IT support services for Central/State Government or PSU clients, each of value not less than INR 50 Lakh, in the last five years. Work order and completion certificate are mandatory.",
      },
      {
        section: "EMD / MSME",
        content:
          "Earnest Money Deposit (EMD) of INR 2,00,000 shall be submitted as Bank Guarantee or Demand Draft. MSME / MSE / Startup bidders registered with competent authority are exempted from EMD on submission of valid registration proof.",
      },
      {
        section: "Mandatory Documents",
        content:
          "Mandatory documents: GST registration, PAN, CA turnover certificate, work orders, completion certificates, MSME certificate (if claiming exemption), bid security / EMD instrument, signed tender forms and affidavits.",
      },
      {
        section: "Scope and Dates",
        content:
          "Authority: Demo Municipal Corporation. Scope: facility management for civic offices. Closing date: 15 Oct 2026. Estimated value: INR 3 Crore.",
      },
    ];
    const { embeddings } = await embedTexts(texts.map((t) => t.content));
    const now = new Date().toISOString();
    await supabase.from("agenttender_ai_document_chunks").insert(
      texts.map((row, index) => ({
        company_id: COMPANY_ID,
        tender_id: tenderId,
        source_type: "TENDER_DOCUMENT",
        source_id: SOURCE_ID,
        document_name: "Phase7_Smoke_RFP.pdf",
        document_url: null,
        document_type: "pdf",
        page_number: index + 1,
        section: row.section,
        chunk_index: index,
        content: row.content,
        content_hash: `smoke-${SOURCE_ID}`,
        embedding: embeddings[index],
        metadata: { smoke: true, phase: 7 },
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
        document_name: "Phase7_Smoke_RFP.pdf",
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
  }

  await indexCompanyProfile(COMPANY_ID).catch((error) => {
    console.log(
      JSON.stringify({
        step: "company_profile",
        status: "warn",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });

  const results: Array<Record<string, unknown>> = [];

  for (const quick of ASK_AI_QUICK_ACTIONS) {
    const started = Date.now();
    let firstDeltaAt: number | null = null;
    let answer = "";
    let statusMessages: string[] = [];
    let sourceCount = 0;
    let warnings: string[] = [];
    let doneMeta: Record<string, unknown> | null = null;
    const eventTypes: string[] = [];

    for await (const event of streamTenderRagAnswer({
      tenderId,
      companyId: COMPANY_ID,
      message: quick.message,
      action: quick.action,
    })) {
      eventTypes.push(event.type);
      if (event.type === "status") statusMessages.push(event.message);
      if (event.type === "delta") {
        if (firstDeltaAt == null) firstDeltaAt = Date.now();
        answer += event.text;
      }
      if (event.type === "sources") {
        sourceCount = event.sources.length;
        warnings = event.warnings;
      }
      if (event.type === "done") {
        doneMeta = (event.retrievalMeta || null) as Record<
          string,
          unknown
        > | null;
      }
      if (event.type === "error") {
        throw new Error(`${quick.action}: ${event.message}`);
      }
    }

    const row = {
      action: quick.action,
      label: quick.label,
      streamed: eventTypes.includes("delta") && eventTypes.includes("done"),
      statusFirst: statusMessages[0] || null,
      tenderChunks: doneMeta?.tenderChunks ?? null,
      companyChunks: doneMeta?.companyChunks ?? null,
      contextTokens: doneMeta?.contextTokensApprox ?? null,
      firstTokenMs:
        firstDeltaAt != null ? firstDeltaAt - started : null,
      totalMs: Date.now() - started,
      sourceCount,
      warnings,
      answerPreview: answer.slice(0, 280).replace(/\s+/g, " "),
      queryEmbeddingMs: doneMeta?.queryEmbeddingMs ?? null,
      retrievalTotalMs: doneMeta?.retrievalTotalMs ?? null,
    };
    results.push(row);
    console.log(JSON.stringify({ step: "action", ...row }));
  }

  // Follow-up after Turnover (fresh retrieval, no action id)
  const turnover = ASK_AI_QUICK_ACTIONS.find(
    (a) => a.action === "CHECK_TURNOVER",
  )!;
  let followAnswer = "";
  let followMeta: Record<string, unknown> | null = null;
  for await (const event of streamTenderRagAnswer({
    tenderId,
    companyId: COMPANY_ID,
    message: "What certificate do we need for this?",
    conversation: [
      { role: "user", content: turnover.message },
      {
        role: "assistant",
        content: "Turnover of INR 5 Crore is required with CA certificate [T1].",
      },
    ],
  })) {
    if (event.type === "delta") followAnswer += event.text;
    if (event.type === "done") {
      followMeta = (event.retrievalMeta || null) as Record<
        string,
        unknown
      > | null;
    }
    if (event.type === "error") throw new Error(event.message);
  }
  console.log(
    JSON.stringify({
      step: "follow_up",
      action: followMeta?.action ?? "GENERAL",
      tenderChunks: followMeta?.tenderChunks,
      companyChunks: followMeta?.companyChunks,
      queryEmbeddingMs: followMeta?.queryEmbeddingMs,
      answerPreview: followAnswer.slice(0, 220).replace(/\s+/g, " "),
    }),
  );

  if (seeded) {
    await supabase
      .from("agenttender_ai_document_chunks")
      .delete()
      .eq("source_id", SOURCE_ID);
    await supabase
      .from("agenttender_ai_document_index_status")
      .delete()
      .eq("source_id", SOURCE_ID);
    console.log(
      JSON.stringify({ step: "cleanup", sourceId: SOURCE_ID, ok: true }),
    );
  }

  console.log(
    JSON.stringify({
      step: "summary",
      actionsRun: results.length,
      allStreamed: results.every((r) => r.streamed === true),
      avgTotalMs: Math.round(
        results.reduce((s, r) => s + Number(r.totalMs || 0), 0) /
          Math.max(results.length, 1),
      ),
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
