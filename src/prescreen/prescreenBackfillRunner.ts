/**
 * Pre-screen backfill runner (importable without CLI side effects).
 * Never opens ChatGPT.
 */
import { Logger } from "../logger.js";
import { evaluatePrescreen } from "./prescreenRuleEngine.js";
import { loadPrescreenConfig } from "./prescreenConfig.js";
import { parsePrescreenBackfillArgs } from "./prescreenBackfillArgs.js";
import {
  listTendersForPrescreenBackfill,
  logPrescreenDecision,
  persistPrescreenResult,
} from "./prescreenRepository.js";
import type { PrescreenInput } from "./prescreenTypes.js";

export type PrescreenBackfillResult = {
  exitCode: number;
  found: number;
  passed: number;
  rejected: number;
  manual: number;
  errors: number;
  chatgptEligible: number;
  chatgptSkipped: number;
};

function printSummary(options: {
  dateIso: string;
  sourceLabel: string;
  id: string | null;
  found: number;
  passed: number;
  rejected: number;
  manual: number;
  errors: number;
  chatgptEligible: number;
  chatgptSkipped: number;
}): void {
  console.log("==================================");
  console.log("Pre-screen Backfill");
  console.log(`Date: ${options.dateIso}`);
  console.log(`Source: ${options.sourceLabel}`);
  if (options.id) {
    console.log(`ID: ${options.id}`);
  }
  console.log(`Found: ${options.found}`);
  console.log(`Passed: ${options.passed}`);
  console.log(`Rejected: ${options.rejected}`);
  console.log(`Manual review: ${options.manual}`);
  console.log(`Errors: ${options.errors}`);
  console.log(`ChatGPT eligible: ${options.chatgptEligible}`);
  console.log(`ChatGPT skipped: ${options.chatgptSkipped}`);
  console.log("==================================");
}

export async function runPrescreenBackfill(
  argv: string[] = process.argv.slice(2),
  options?: { skipStartupBanner?: boolean },
): Promise<PrescreenBackfillResult> {
  if (!options?.skipStartupBanner) {
    console.log("PRESCREEN_BACKFILL_START");
    const safeArgs = argv.map((a) =>
      /key|secret|password|token/i.test(a) ? "[redacted]" : a,
    );
    console.log(`PRESCREEN_BACKFILL_ARGS=${JSON.stringify(safeArgs)}`);
  }

  const parsed = parsePrescreenBackfillArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.message);
    printSummary({
      dateIso: "—",
      sourceLabel: "ALL",
      id: null,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 0,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    });
    return {
      exitCode: 1,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 0,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    };
  }

  const { dateIso, source, sourceLabel, id } = parsed;
  const logger = new Logger("./logs", "prescreen-backfill");
  const config = loadPrescreenConfig();

  console.log(`PRESCREEN_BACKFILL_DATE=${dateIso}`);
  console.log(`PRESCREEN_BACKFILL_SOURCE=${sourceLabel}`);
  if (id) {
    console.log(`PRESCREEN_BACKFILL_ID=${id}`);
  }
  logger.info(`PRESCREEN_BACKFILL_DATE=${dateIso}`);
  logger.info(`PRESCREEN_BACKFILL_SOURCE=${sourceLabel}`);
  if (id) {
    logger.info(`PRESCREEN_BACKFILL_ID=${id}`);
  }
  logger.info(`PRESCREEN_RULES_VERSION=${config.rulesVersion}`);
  logger.info("PRESCREEN_BACKFILL_CHATGPT=never");
  console.log("PRESCREEN_BACKFILL_CHATGPT=never");

  console.log("PRESCREEN_BACKFILL_QUERY_START");
  logger.info("PRESCREEN_BACKFILL_QUERY_START");

  const listed = await listTendersForPrescreenBackfill({
    dateIso,
    sourcePortal: source,
    sourceTenderId: id,
  });

  if (!listed.ok) {
    console.error("PRESCREEN_BACKFILL_QUERY_FAILED");
    console.error(`code=${listed.code ?? ""}`);
    console.error(`message=${listed.error}`);
    console.error(`details=${listed.details ?? ""}`);
    console.error(`hint=${listed.hint ?? ""}`);
    logger.error(`PRESCREEN_BACKFILL_QUERY_FAILED=${listed.error}`);
    printSummary({
      dateIso,
      sourceLabel,
      id,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 1,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    });
    return {
      exitCode: 1,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 1,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    };
  }

  console.log(`PRESCREEN_BACKFILL_ROWS_FOUND=${listed.rows.length}`);
  logger.info(`PRESCREEN_BACKFILL_ROWS_FOUND=${listed.rows.length}`);

  if (listed.rows.length === 0) {
    console.log("PRESCREEN_BACKFILL_NO_TENDERS_FOUND");
    logger.info("PRESCREEN_BACKFILL_NO_TENDERS_FOUND");
    printSummary({
      dateIso,
      sourceLabel,
      id,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 0,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    });
    return {
      exitCode: 0,
      found: 0,
      passed: 0,
      rejected: 0,
      manual: 0,
      errors: 0,
      chatgptEligible: 0,
      chatgptSkipped: 0,
    };
  }

  let passed = 0;
  let rejected = 0;
  let manual = 0;
  let errors = 0;
  let chatgptEligible = 0;
  let chatgptSkipped = 0;

  for (const row of listed.rows) {
    const label =
      row.source_portal === "TENDER247"
        ? `T247-${row.source_tender_id}`
        : row.source_tender_id.toUpperCase().startsWith("BA-")
          ? row.source_tender_id
          : `BA-${row.source_tender_id}`;

    console.log(`PRESCREEN_START=${label}`);
    logger.info(`PRESCREEN_START=${label}`);

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
    logPrescreenDecision(logger, row.source_portal, row.source_tender_id, decision);

    console.log(`PRESCREEN_RESULT=${decision.status}`);
    console.log(`PRESCREEN_REASON_CODE=${decision.reasonCode}`);
    console.log(`CHATGPT_ELIGIBLE=${decision.chatgptEligible}`);

    if (decision.chatgptEligible) {
      chatgptEligible += 1;
    } else {
      chatgptSkipped += 1;
    }

    const persisted = await persistPrescreenResult({
      tenderId: row.id,
      decision,
      sourcePortal: row.source_portal,
      sourceTenderId: row.source_tender_id,
      metadataHash: row.content_hash,
    });

    if (!persisted.ok) {
      errors += 1;
      console.error(
        `PRESCREEN_PERSIST_FAILED=${label} ${persisted.error}`,
      );
      logger.warn(
        `PRESCREEN_PERSIST_FAILED=${row.source_tender_id} ${persisted.error}`,
      );
      continue;
    }

    console.log(`PRESCREEN_SAVED=${label}`);
    logger.info(`PRESCREEN_SAVED=${label}`);

    if (decision.status === "PASSED") passed += 1;
    else if (decision.status === "REJECTED") rejected += 1;
    else if (decision.status === "MANUAL_REVIEW") manual += 1;
    else errors += 1;
  }

  const found = listed.rows.length;
  logger.info(
    `PRESCREEN_BACKFILL_DONE total=${found} passed=${passed} rejected=${rejected} manual=${manual} errors=${errors} eligible=${chatgptEligible} skipped=${chatgptSkipped}`,
  );

  printSummary({
    dateIso,
    sourceLabel,
    id,
    found,
    passed,
    rejected,
    manual,
    errors,
    chatgptEligible,
    chatgptSkipped,
  });

  return {
    exitCode: 0,
    found,
    passed,
    rejected,
    manual,
    errors,
    chatgptEligible,
    chatgptSkipped,
  };
}
