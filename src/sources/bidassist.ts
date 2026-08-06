import type { AppConfig } from "../config.js";
import { Logger } from "../logger.js";
import type { SourceResult } from "./tender247.js";

/**
 * BidAssist placeholder — not configured.
 * Do not invent selectors or pretend automation works.
 * Enable only after screenshots, URL, and click sequence are provided.
 */
export async function runBidAssist(config: AppConfig): Promise<SourceResult> {
  const started = Date.now();
  const logger = new Logger(config.logRoot, "BidAssist");

  if (!config.bidAssistEnabled) {
    logger.info("BidAssist skipped (BIDASSIST_ENABLED=false)");
    return {
      source: "BidAssist",
      status: "SKIPPED",
      reason: "BIDASSIST_NOT_CONFIGURED",
      durationMs: Date.now() - started,
    };
  }

  logger.warn(
    "BIDASSIST_NOT_CONFIGURED: BidAssist is enabled in .env but selectors/URL/flow are not implemented yet",
  );

  return {
    source: "BidAssist",
    status: "SKIPPED",
    reason: "BIDASSIST_NOT_CONFIGURED",
    durationMs: Date.now() - started,
  };
}
