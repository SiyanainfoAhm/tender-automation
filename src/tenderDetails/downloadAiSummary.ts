import type { BrowserContext, Page } from "playwright";
import type { Logger } from "../logger.js";
import { dismissPageOverlays } from "./collectTenderLinks.js";
import { clickAndSaveDownload } from "./downloadHelpers.js";
import type { DownloadedFileRecord } from "./types.js";

export interface AiSummaryDownloadOptions {
  page: Page;
  context: BrowserContext;
  /** Usually the tender root folder */
  destinationDir: string;
  timeoutMs: number;
  logger: Logger;
}

/**
 * Download AI Summary PDF when a visible download control exists.
 * Does not fail the tender when unavailable.
 */
export async function downloadAiSummary(
  options: AiSummaryDownloadOptions,
): Promise<DownloadedFileRecord | null> {
  const { page, context, destinationDir, timeoutMs, logger } = options;
  await dismissPageOverlays(page, logger);

  const control = page
    .getByRole("link", { name: /AI\s*Summary.*PDF|PDF.*AI\s*Summary|AI\s*Summary.*Download/i })
    .or(
      page.getByRole("button", {
        name: /AI\s*Summary.*PDF|PDF.*AI\s*Summary|AI\s*Summary.*Download/i,
      }),
    )
    .or(page.getByText(/AI\s*Summary\s*PDF\s*Download/i))
    .or(
      page
        .locator("a, button")
        .filter({ hasText: /AI\s*Summary/i })
        .filter({ hasText: /Download|PDF/i }),
    )
    .first();

  if (!(await control.isVisible().catch(() => false))) {
    logger.info("AI Summary PDF Download not available");
    return null;
  }

  logger.info("AI Summary PDF download starting");
  try {
    return await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await control.click({ timeout: 15_000 });
      },
      destinationDir,
      preferredBaseName: "AI_Summary",
      preferredExtension: "pdf",
      timeoutMs,
      logger,
      kind: "ai_summary",
      linkText: "AI Summary PDF Download",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`AI Summary PDF download failed (non-fatal): ${message}`);
    return {
      kind: "ai_summary",
      linkText: "AI Summary PDF Download",
      originalFilename: null,
      finalFilename: "",
      relativePath: "",
      sizeBytes: 0,
      status: "failed",
      error: message,
    };
  }
}
