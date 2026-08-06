/**
 * Backfill deterministic pre-screen results for tenders crawled on a date.
 * Never opens ChatGPT.
 *
 * Usage:
 *   npm run backfill:prescreen -- --date=2026-08-06
 *   npm run backfill:prescreen -- --date=2026-08-06 --source=tender247
 *   npm run backfill:prescreen -- --date=2026-08-06 --source=bidassist
 */
import { config as loadDotenv } from "dotenv";
import { resolveProjectPath } from "../fileUtils.js";
import { Logger } from "../logger.js";
import { evaluatePrescreen } from "./prescreenRuleEngine.js";
import { loadPrescreenConfig } from "./prescreenConfig.js";
import {
  listTendersForPrescreenBackfill,
  logPrescreenDecision,
  persistPrescreenResult,
} from "./prescreenRepository.js";
import type { PrescreenInput, PrescreenSourcePortal } from "./prescreenTypes.js";

loadDotenv({ path: resolveProjectPath(".env"), quiet: true });

function parseArgs(argv: string[]): {
  dateIso: string | null;
  source: PrescreenSourcePortal | null;
} {
  let dateIso: string | null = null;
  let source: PrescreenSourcePortal | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--date=")) {
      dateIso = arg.slice("--date=".length).trim() || null;
    } else if (arg.startsWith("--source=")) {
      const raw = arg.slice("--source=".length).trim().toLowerCase();
      if (raw === "tender247") source = "TENDER247";
      else if (raw === "bidassist") source = "BIDASSIST";
    }
  }
  return { dateIso, source };
}

async function main(): Promise<void> {
  const { dateIso, source } = parseArgs(process.argv.slice(2));
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    console.error(
      "Usage: npm run backfill:prescreen -- --date=YYYY-MM-DD [--source=tender247|bidassist]",
    );
    process.exitCode = 1;
    return;
  }

  const logger = new Logger("./logs", "prescreen-backfill");
  const config = loadPrescreenConfig();
  logger.info(`PRESCREEN_BACKFILL_START date=${dateIso} source=${source ?? "ALL"}`);
  logger.info(`PRESCREEN_RULES_VERSION=${config.rulesVersion}`);
  logger.info("PRESCREEN_BACKFILL_CHATGPT=never");

  const listed = await listTendersForPrescreenBackfill({
    dateIso,
    sourcePortal: source,
  });
  if (!listed.ok) {
    logger.error(`PRESCREEN_BACKFILL_LIST_FAILED=${listed.error}`);
    process.exitCode = 1;
    return;
  }

  let passed = 0;
  let rejected = 0;
  let manual = 0;
  let errors = 0;

  for (const row of listed.rows) {
    const input: PrescreenInput = {
      sourcePortal: row.source_portal,
      sourceTenderId: row.source_tender_id,
      title: row.title || "",
      category: row.category,
      description: row.description,
      closingDate: row.closing_date,
      tenderValue: row.tender_value,
      tenderValueText: row.tender_value_text,
      emdAmount: row.emd_amount,
      emdText: row.emd_text,
      documentArchiveAvailable: Boolean(row.document_archive_available),
      hasNormalizedMetadata: true,
    };

    const decision = evaluatePrescreen(input, config);
    logPrescreenDecision(
      logger,
      row.source_portal,
      row.source_tender_id,
      decision,
    );

    const persisted = await persistPrescreenResult({
      tenderId: row.id,
      decision,
      sourcePortal: row.source_portal,
      sourceTenderId: row.source_tender_id,
      metadataHash: row.content_hash,
    });

    if (!persisted.ok) {
      errors += 1;
      logger.warn(
        `PRESCREEN_BACKFILL_PERSIST_FAILED=${row.source_tender_id} ${persisted.error}`,
      );
      continue;
    }

    if (decision.status === "PASSED") passed += 1;
    else if (decision.status === "REJECTED") rejected += 1;
    else if (decision.status === "MANUAL_REVIEW") manual += 1;
    else errors += 1;
  }

  logger.info(
    `PRESCREEN_BACKFILL_DONE total=${listed.rows.length} passed=${passed} rejected=${rejected} manual=${manual} errors=${errors}`,
  );
  console.log(
    JSON.stringify(
      {
        date: dateIso,
        source: source ?? "ALL",
        total: listed.rows.length,
        passed,
        rejected,
        manual,
        errors,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
