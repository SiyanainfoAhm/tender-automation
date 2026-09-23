/**
 * Phase 4 smoke test: index synthetic tender evidence + run Ask AI RAG (no SharePoint).
 *
 * Usage (from web/):
 *   npx tsx scripts/ask-ai-rag-smoke.ts
 *
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

const COMPANY_ID = "6d6ad696-be7a-4fe6-a84a-66595924966f"; // Mitaja Corp Test
const SOURCE_ID = `phase4_smoke:${randomUUID()}`;

async function main() {
  const { getServerSupabase } = await import("../src/lib/db/server");
  const { embedTexts } = await import("../src/server/ai/rag/embeddings");
  const { askTenderAiRag } = await import("../src/server/ai/rag/ask-ai-rag");
  const { indexCompanyProfile } = await import("../src/server/ai/rag/company-knowledge");

  const supabase = getServerSupabase();
  const { data: tender, error: tenderError } = await supabase
    .from("agenttender_tenders")
    .select("id, title")
    .limit(1)
    .maybeSingle();
  if (tenderError || !tender) {
    throw new Error(tenderError?.message || "No tender available for smoke test.");
  }

  const tenderId = String(tender.id);
  console.log(
    JSON.stringify({
      step: "prepare",
      tenderId,
      title: typeof tender.title === "string" ? tender.title.slice(0, 80) : null,
      companyId: COMPANY_ID,
    }),
  );

  await indexCompanyProfile(COMPANY_ID).catch((error) => {
    console.log(
      JSON.stringify({
        step: "company_profile",
        status: "warn",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });

  const tenderTexts = [
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
        "Earnest Money Deposit (EMD) of INR 2,00,000 shall be submitted as Bank Guarantee or Demand Draft. MSME / MSE / Startup bidders registered with competent authority are exempted from EMD on submission of valid registration proof. Exemption is available only when valid MSME certificate is enclosed.",
    },
  ];

  const embedStarted = Date.now();
  const { embeddings } = await embedTexts(tenderTexts.map((row) => row.content));
  console.log(
    JSON.stringify({
      step: "embed_seed",
      embeddingMs: Date.now() - embedStarted,
      chunkCount: embeddings.length,
    }),
  );

  const now = new Date().toISOString();
  const rows = tenderTexts.map((row, index) => ({
    company_id: COMPANY_ID,
    tender_id: tenderId,
    source_type: "TENDER_DOCUMENT",
    source_id: SOURCE_ID,
    document_name: "Phase4_Smoke_RFP.pdf",
    document_url: null,
    document_type: "pdf",
    page_number: index + 1,
    section: row.section,
    chunk_index: index,
    content: row.content,
    content_hash: `smoke-${SOURCE_ID}`,
    embedding: embeddings[index],
    metadata: { smoke: true, phase: 4 },
    is_active: true,
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await supabase
    .from("agenttender_ai_document_chunks")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);

  await supabase.from("agenttender_ai_document_index_status").upsert(
    {
      company_id: COMPANY_ID,
      tender_id: tenderId,
      source_type: "TENDER_DOCUMENT",
      source_id: SOURCE_ID,
      document_name: "Phase4_Smoke_RFP.pdf",
      status: "INDEXED",
      chunk_count: rows.length,
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
    "Summarize this tender.",
    "What is the turnover requirement?",
    "Do we meet the turnover requirement?",
    "What similar experience is required?",
    "Is MSME exemption available?",
    "What is the lunar landing pad requirement?",
  ];

  for (const message of questions) {
    const started = Date.now();
    const result = await askTenderAiRag({
      tenderId,
      companyId: COMPANY_ID,
      message,
    });
    console.log(
      JSON.stringify({
        step: "ask",
        message,
        answerChars: result.answer.length,
        answerPreview: result.answer.slice(0, 220).replace(/\s+/g, " "),
        sources: result.sources.map((s) => ({
          id: s.id,
          fileName: s.fileName,
          section: s.section,
          pageNumber: s.pageNumber,
        })),
        warnings: result.warnings,
        retrievalMeta: result.retrievalMeta,
        wallMs: Date.now() - started,
      }),
    );
  }

  // Follow-up: ensure retrieval still runs
  const followUp = await askTenderAiRag({
    tenderId,
    companyId: COMPANY_ID,
    message: "Do we meet it?",
    conversation: [
      { role: "user", content: "What turnover is required?" },
      {
        role: "assistant",
        content: "The tender requires INR 5 Crore average annual turnover [T1].",
      },
    ],
  });
  console.log(
    JSON.stringify({
      step: "follow_up",
      tenderChunks: followUp.retrievalMeta?.tenderChunks,
      companyChunks: followUp.retrievalMeta?.companyChunks,
      queryEmbeddingMs: followUp.retrievalMeta?.queryEmbeddingMs,
      answerPreview: followUp.answer.slice(0, 220).replace(/\s+/g, " "),
      sources: followUp.sources.map((s) => s.id),
    }),
  );

  // Cleanup smoke rows
  await supabase
    .from("agenttender_ai_document_chunks")
    .delete()
    .eq("source_id", SOURCE_ID);
  await supabase
    .from("agenttender_ai_document_index_status")
    .delete()
    .eq("source_id", SOURCE_ID);

  console.log(JSON.stringify({ step: "cleanup", sourceId: SOURCE_ID, ok: true }));
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
