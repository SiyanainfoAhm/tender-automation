import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

function argument(name: string) { return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || null; }
function csv(value: unknown) { const text = value == null ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
async function main() {
  const runId = argument("--run-id"); if (!runId) throw new Error("Usage: npm run tender247:audit-historical-gap -- --run-id=<saved-run-uuid>");
  const scriptDir = dirname(fileURLToPath(import.meta.url)); const webDir = dirname(scriptDir); const repoDir = dirname(webDir);
  for (const path of [join(repoDir, ".env"), join(webDir, ".env"), join(repoDir, ".env.local"), join(webDir, ".env.local")]) config({ path, override: path.endsWith(".local") });
  const { createAdminSupabaseClient } = await import("@/lib/db/adminClient");
  const { auditTender247HistoricalGap } = await import("@/server/tender247/historicalGap");
  const report = await auditTender247HistoricalGap(runId, createAdminSupabaseClient(), { onProgress: (message) => console.log(`Tender247 historical-gap audit: ${message}`) });
  const directory = join(webDir, "scripts", "recovery", "report"); await mkdir(directory, { recursive: true });
  const stem = `tender247-historical-gap-${runId}`; const jsonPath = join(directory, `${stem}.json`); const csvPath = join(directory, `${stem}.csv`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  const headers = Object.keys(report.rows[0] || {}); await writeFile(csvPath, `${headers.join(",")}\n${report.rows.map((row) => headers.map((header) => csv(row[header as keyof typeof row])).join(",")).join("\n")}\n`);
  console.log(JSON.stringify({ ...report.summary, jsonPath, csvPath }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
