/**
 * Controlled one-source AI RAG indexing (Phase 3).
 *
 * Usage:
 *   cd web
 *   npx tsx scripts/index-ai-source.ts --company-profile <companyId>
 *   npx tsx scripts/index-ai-source.ts --company-inventory <companyId>
 *   npx tsx scripts/index-ai-source.ts --company <companyId>
 *   npx tsx scripts/index-ai-source.ts --company-document <companyId> <documentId>
 *   npx tsx scripts/index-ai-source.ts --tender <companyId> <tenderId>
 *   npx tsx scripts/index-ai-source.ts --tender-document <companyId> <tenderId> <tenderDocumentId>
 *
 * Prints safe metadata only (no document text).
 */
import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

// Allow importing server-only modules from a Node script.
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as NodeModule;

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  const {
    indexCompanyDocument,
    indexCompanyDocumentInventory,
    indexCompanyKnowledge,
    indexCompanyProfile,
    indexTenderDocumentById,
    indexTenderKnowledge,
  } = await import("../src/server/ai/rag");

  let results;

  if (mode === "--company-profile") {
    const companyId = args[1];
    if (!companyId) throw new Error("companyId required");
    results = [await indexCompanyProfile(companyId)];
  } else if (mode === "--company-inventory") {
    const companyId = args[1];
    if (!companyId) throw new Error("companyId required");
    results = [await indexCompanyDocumentInventory(companyId)];
  } else if (mode === "--company") {
    const companyId = args[1];
    if (!companyId) throw new Error("companyId required");
    results = await indexCompanyKnowledge(companyId);
  } else if (mode === "--company-document") {
    const companyId = args[1];
    const documentId = args[2];
    if (!companyId || !documentId) {
      throw new Error("companyId and documentId required");
    }
    results = [await indexCompanyDocument({ companyId, documentId })];
  } else if (mode === "--tender") {
    const companyId = args[1];
    const tenderId = args[2];
    if (!companyId || !tenderId) {
      throw new Error("companyId and tenderId required");
    }
    results = await indexTenderKnowledge({ companyId, tenderId });
  } else if (mode === "--tender-document") {
    const companyId = args[1];
    const tenderId = args[2];
    const tenderDocumentId = args[3];
    if (!companyId || !tenderId || !tenderDocumentId) {
      throw new Error("companyId, tenderId, tenderDocumentId required");
    }
    results = [
      await indexTenderDocumentById({
        companyId,
        tenderId,
        tenderDocumentId,
      }),
    ];
  } else {
    throw new Error(
      "Usage: --company-profile | --company-inventory | --company | --company-document | --tender | --tender-document",
    );
  }

  for (const row of results) {
    console.log(
      JSON.stringify({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        status: row.status,
        chunkCount: row.chunkCount,
        skipped: row.skipped,
        contentHashPrefix: row.contentHash?.slice(0, 12) ?? null,
        totalMs: row.timings.totalMs,
        embeddingMs: row.timings.embeddingMs,
        errorMessage: row.errorMessage ?? null,
      }),
    );
  }
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
