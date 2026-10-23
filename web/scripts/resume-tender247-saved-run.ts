import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

function loadEnvironment() {
  // Resolve from this script rather than process.cwd(): npm --prefix changes
  // the working directory, while direct `tsx` invocation need not. Load both
  // project layers; local files take precedence and are never committed.
  const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
  const webDirectory = dirname(scriptsDirectory);
  const repositoryDirectory = dirname(webDirectory);
  config({ path: join(repositoryDirectory, ".env") });
  config({ path: join(webDirectory, ".env") });
  config({ path: join(repositoryDirectory, ".env.local"), override: true });
  config({ path: join(webDirectory, ".env.local"), override: true });
}

function requireRecoveryEnvironment() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TENDER247_MIRROR_SUPABASE_URL",
    "TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
}

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

async function main() {
  console.log("Tender247 saved-run recovery: CLI started");
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run tender247:resume-saved -- --run-id=<saved-run-uuid> [--tender247-tender-id=<Tender247-id>] [--external-document-id=<Tender247-document-token>]");
    return;
  }

  const runId = argument("--run-id");
  if (!runId) throw new Error("Usage: npm run tender247:resume-saved -- --run-id=<saved-run-uuid>");
  const externalDocumentId = argument("--external-document-id");
  const tender247TenderId = argument("--tender247-tender-id");
  if (externalDocumentId && !/^[A-Za-z0-9_-]{8,512}$/.test(externalDocumentId)) throw new Error("external-document-id must be a Tender247 document token.");
  if (tender247TenderId && !/^\d{1,32}$/.test(tender247TenderId)) throw new Error("tender247-tender-id must be a numeric Tender247 tender id.");

  loadEnvironment();
  console.log("Tender247 saved-run recovery: env loaded");
  requireRecoveryEnvironment();
  const { createAdminSupabaseClient } = await import("@/lib/db/adminClient");
  const { loadSavedTender247Run, resumeSavedTender247Run } = await import("@/server/tender247/savedRunResume");
  const db = createAdminSupabaseClient();
  console.log("Tender247 saved-run recovery: Supabase admin client created");
  console.log("Tender247 saved-run recovery: saved run lookup starting");
  await loadSavedTender247Run(db, runId);
  console.log("Tender247 saved-run recovery: saved run lookup completed");
  const result = await resumeSavedTender247Run(runId, { canonicalDb: db, onlyTender247TenderId: tender247TenderId || undefined, onlyExternalDocumentId: externalDocumentId || undefined, onProgress: (message) => console.log(`Tender247 saved-run recovery: ${message}`) });
  // The bounded recovery intentionally does not update/create pipeline runs or
  // local report files. Its only allowed mutations are existing canonical
  // documents, their upload sessions, and idempotent mirror rows.
  console.log(JSON.stringify(result, null, 2));
  if (result.documentsFailed || result.remainingIncompleteCanonicalDocuments) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
