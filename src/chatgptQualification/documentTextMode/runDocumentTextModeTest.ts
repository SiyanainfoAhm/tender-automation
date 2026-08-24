/**
 * CLI: document-text qualification for all ZIP-ready tenders under downloads/{date}
 * (or optional DOCUMENT_TEXT_TEST_TENDER_IDS subset).
 * Usage: npm run qualify:chatgpt:text-mode -- --date=2026-08-21
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config.js";
import { resolveRequestedDate } from "../../cli/requestedDate.js";
import { resolveProjectPath } from "../../fileUtils.js";
import { Logger, safeErrorMessage } from "../../logger.js";
import { runDocumentTextModeTest } from "./qualifyDocumentTextMode.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "DocumentTextMode");

  if (!config.documentTextMode) {
    console.error("Set DOCUMENT_TEXT_MODE=true to run this experimental path.");
    process.exitCode = 1;
    return;
  }

  const dateIso = resolveRequestedDate(process.argv.slice(2)).requestedDate;
  const dateFolder = path.join(
    resolveProjectPath(config.downloadRoot),
    dateIso,
  );

  logger.info(`DATE=${dateIso}`);
  const { results, complete } = await runDocumentTextModeTest({
    dateFolder,
    dateIso,
    tenderIds: config.documentTextTestTenderIds,
    config,
    logger,
  });

  console.log(
    JSON.stringify(
      {
        complete,
        results: results.map((r) => ({
          tenderId: r.tenderId,
          status: r.status,
          reason: r.reason,
          error: r.error,
          resultPath: r.resultPath,
        })),
      },
      null,
      2,
    ),
  );
  if (!complete) process.exitCode = 1;
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirect) {
  main().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
