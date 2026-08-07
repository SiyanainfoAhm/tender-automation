/**
 * CLI entry point for deterministic pre-screen backfill.
 * Never opens ChatGPT.
 *
 * Usage:
 *   npm run backfill:prescreen -- --date=2026-08-06
 *   npx tsx src/prescreen/backfillPrescreenResults.ts --date=2026-08-06
 *
 * IMPORTANT: This file must invoke main() unconditionally at the bottom.
 * Do not use CommonJS or ESM entry-point guards — they break under tsx.
 */
async function main(): Promise<void> {
  // First runtime output — before any heavy imports / dotenv / Supabase.
  console.log("PRESCREEN_BACKFILL_START");

  const args = process.argv.slice(2);
  const safeArgs = args.map((a) =>
    /key|secret|password|token/i.test(a) ? "[redacted]" : a,
  );
  console.log(`PRESCREEN_BACKFILL_ARGS=${JSON.stringify(safeArgs)}`);

  const { config: loadDotenv } = await import("dotenv");
  const { resolveProjectPath } = await import("../fileUtils.js");
  loadDotenv({ path: resolveProjectPath(".env"), quiet: true });

  const { runPrescreenBackfill } = await import("./prescreenBackfillRunner.js");
  const result = await runPrescreenBackfill(args, {
    skipStartupBanner: true,
  });
  process.exitCode = result.exitCode;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);

  console.error("PRESCREEN_BACKFILL_FATAL");
  console.error(message);

  process.exitCode = 1;
});
