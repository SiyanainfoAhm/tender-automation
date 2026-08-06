import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getFileSizeBytes } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import { mapBidAssistWorkbook } from "./bidassistMapper.js";
import { findSourceFiles, requireTender247Source } from "./sourceFileFinder.js";
import { writeImportWorkbook } from "./templateWriter.js";
import { mapTender247Workbook } from "./tender247Mapper.js";
import {
  ExcelConversionError,
  type ConvertSourceMode,
  type ConversionResult,
  type MappingStats,
  type TenderImportRow,
} from "./types.js";

function parseSourceMode(argv: string[]): ConvertSourceMode {
  const arg = argv.find((a) => a.startsWith("--source="));
  const value = arg?.split("=")[1]?.toLowerCase() ?? "tender247";
  if (value === "all" || value === "bidassist" || value === "tender247") {
    return value;
  }
  return "tender247";
}

export function generateImportWorkbook(
  mode: ConvertSourceMode = "tender247",
): ConversionResult {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ExcelConvert");
  const files = findSourceFiles(config.downloadRoot);

  logger.info("=== Import workbook generation started ===");
  logger.info(`Source mode: ${mode}`);
  logger.info(`Date folder: ${files.dateFolder}`);

  const allRows: TenderImportRow[] = [];
  const stats: MappingStats[] = [];

  const includeTender247 = mode === "tender247" || mode === "all";
  const includeBidAssist = mode === "bidassist" || mode === "all";

  if (includeTender247) {
    if (mode === "tender247") {
      const tender247Path = requireTender247Source(files);
      logger.info(
        `Tender247 source selected: ${path.relative(process.cwd(), tender247Path)}`,
      );
      const mapped = mapTender247Workbook(tender247Path, logger);
      logMappingStats(logger, mapped.stats);
      allRows.push(...mapped.rows);
      stats.push(mapped.stats);
    } else if (files.tender247Path) {
      logger.info(
        `Tender247 source selected: ${path.relative(process.cwd(), files.tender247Path)}`,
      );
      const mapped = mapTender247Workbook(files.tender247Path, logger);
      logMappingStats(logger, mapped.stats);
      allRows.push(...mapped.rows);
      stats.push(mapped.stats);
    } else {
      logger.warn("TENDER247_SOURCE_FILE_NOT_FOUND");
    }
  }

  if (includeBidAssist) {
    if (files.bidAssistPath) {
      logger.info(
        `BidAssist source selected: ${path.relative(process.cwd(), files.bidAssistPath)}`,
      );
      const mapped = mapBidAssistWorkbook(files.bidAssistPath, logger);
      logMappingStats(logger, mapped.stats);
      allRows.push(...mapped.rows);
      stats.push(mapped.stats);
    } else {
      logger.warn("BIDASSIST_SOURCE_FILE_NOT_FOUND");
      if (mode === "bidassist") {
        throw new ExcelConversionError(
          "BIDASSIST_SOURCE_FILE_NOT_FOUND",
          `No BidAssist_*.xlsx found in ${files.dateFolder}`,
        );
      }
    }
  }

  if (allRows.length === 0) {
    if (!files.tender247Path && !files.bidAssistPath) {
      throw new ExcelConversionError(
        "TENDER247_SOURCE_FILE_NOT_FOUND",
        `No source Excel files found in ${files.dateFolder}`,
      );
    }
    throw new ExcelConversionError(
      "NO_TENDERS_MAPPED",
      "Source workbooks were found but no tender rows could be mapped",
    );
  }

  const totalSkipped = stats.reduce((sum, s) => sum + s.rowsSkipped, 0);
  const totalRead = stats.reduce((sum, s) => sum + s.rowsRead, 0);
  logger.info(`Total rows read: ${totalRead}`);
  logger.info(`Total rows mapped: ${allRows.length}`);
  logger.info(`Total rows skipped: ${totalSkipped}`);

  const outputPath = writeImportWorkbook(
    allRows,
    files.dateFolder,
    files.dateIso,
    logger,
  );
  const outputSizeBytes = getFileSizeBytes(outputPath);

  logger.info(`Final output row count: ${allRows.length}`);
  logger.info(`Output file size: ${outputSizeBytes} bytes`);
  logger.info("=== Import workbook generation completed ===");

  return {
    outputPath,
    outputSizeBytes,
    totalMapped: allRows.length,
    totalSkipped,
    stats,
  };
}

function logMappingStats(logger: Logger, mappingStats: MappingStats): void {
  logger.info(
    `${mappingStats.sourceLabel}: rowsRead=${mappingStats.rowsRead}, rowsMapped=${mappingStats.rowsMapped}, rowsSkipped=${mappingStats.rowsSkipped}, warnings=${mappingStats.warnings.length}`,
  );
}

function main(): void {
  const mode = parseSourceMode(process.argv.slice(2));
  const logger = new Logger(loadConfig().logRoot, "ExcelConvert");

  try {
    const result = generateImportWorkbook(mode);
    console.log("");
    console.log("Import workbook generation completed");
    console.log("");
    for (const s of result.stats) {
      console.log(`${s.sourceLabel}`);
      if (s.sourceFile) {
        console.log(`  Source: ${path.relative(process.cwd(), s.sourceFile)}`);
      }
      console.log(`  Rows read: ${s.rowsRead}`);
      console.log(`  Rows mapped: ${s.rowsMapped}`);
      console.log(`  Rows skipped: ${s.rowsSkipped}`);
    }
    console.log("");
    console.log(`Output: ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(`Size: ${result.outputSizeBytes} bytes`);
    console.log(`Mapped total: ${result.totalMapped}`);
    console.log(`Skipped total: ${result.totalSkipped}`);
    process.exit(0);
  } catch (error) {
    const code =
      error instanceof ExcelConversionError ? error.code : "UNEXPECTED_ERROR";
    const message = safeErrorMessage(error);
    logger.error(`[${code}] ${message}`);
    console.error(`\n${code}\n${message}\n`);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main();
}
