/** Repair company profile index after Phase 9 reindex bug. */
import { config } from "dotenv";
import { createRequire } from "node:module";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as NodeModule;

async function main() {
  const { indexCompanyProfile } = await import(
    "../src/server/ai/rag/company-knowledge"
  );
  const r = await indexCompanyProfile(
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  );
  console.log(
    JSON.stringify({
      status: r.status,
      skipped: r.skipped,
      chunks: r.chunkCount,
      hash: r.contentHash?.slice(0, 12) ?? null,
      error: r.errorMessage?.slice(0, 120) ?? null,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
