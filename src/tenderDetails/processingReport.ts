import fs from "node:fs";
import path from "node:path";
import { formatDurationMs } from "../dateUtils.js";
import type { Logger } from "../logger.js";
import type { CrawlReport, TenderProcessResult } from "./types.js";

export function buildCrawlReport(input: {
  dateIso: string;
  startTime: string;
  discoveredListPath: string;
  tendersDiscovered: number;
  results: TenderProcessResult[];
}): CrawlReport {
  const completionTime = new Date().toISOString();
  const startMs = Date.parse(input.startTime);
  const durationMs = Number.isFinite(startMs)
    ? Date.now() - startMs
    : 0;

  const successful = input.results.filter((r) => r.status === "success").length;
  const partial = input.results.filter((r) => r.status === "partial").length;
  const failed = input.results.filter((r) => r.status === "failed").length;

  return {
    source: "tender247",
    dateIso: input.dateIso,
    startTime: input.startTime,
    completionTime,
    durationMs,
    tendersDiscovered: input.tendersDiscovered,
    tendersProcessed: input.results.length,
    successfulTenders: successful,
    partiallySuccessfulTenders: partial,
    failedTenders: failed,
    totalDocumentsDownloaded: input.results.reduce(
      (sum, r) => sum + r.documentsDownloaded,
      0,
    ),
    totalCorrigendaDownloaded: input.results.reduce(
      (sum, r) => sum + r.corrigendaDownloaded,
      0,
    ),
    totalBytesDownloaded: input.results.reduce(
      (sum, r) => sum + r.bytesDownloaded,
      0,
    ),
    discoveredListPath: input.discoveredListPath,
    results: input.results,
  };
}

export function writeCrawlReport(
  dateFolder: string,
  dateIso: string,
  report: CrawlReport,
  logger: Logger,
): string {
  const filePath = path.join(
    dateFolder,
    `Tender247_Crawl_Report_${dateIso}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  logger.info(`Crawl report written: ${path.relative(process.cwd(), filePath)}`);
  logger.info(
    `Crawl completion: processed=${report.tendersProcessed} success=${report.successfulTenders} partial=${report.partiallySuccessfulTenders} failed=${report.failedTenders} duration=${formatDurationMs(report.durationMs)}`,
  );
  return filePath;
}
