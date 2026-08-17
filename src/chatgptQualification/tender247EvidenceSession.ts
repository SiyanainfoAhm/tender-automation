/**
 * Lazy Tender247 browser session for bounded document acquisition during GPT batch.
 * Separate from ChatGPT persistent context — uses auth/tender247.json.
 */
import type { BrowserContext, Page } from "playwright";
import { launchBrowserSession } from "../browserUtils.js";
import { resolveTender247AuthPath, type AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { loginToTender247 } from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { playwrightDownloadsDir } from "../tender247Batch/createTenderZip.js";

export type Tender247EvidenceSession = {
  context: BrowserContext;
  listPage: Page;
  close: () => Promise<void>;
};

let activeSession: Tender247EvidenceSession | null = null;

export async function ensureTender247EvidenceSession(options: {
  config: AppConfig;
  logger: Logger;
  dateFolder: string;
}): Promise<Tender247EvidenceSession | null> {
  if (activeSession && !activeSession.listPage.isClosed()) {
    return activeSession;
  }

  const authPath = resolveTender247AuthPath(options.config);
  if (!authPath) {
    options.logger.warn(
      "T247_EVIDENCE_SESSION_SKIPPED reason=missing_tender247_auth",
    );
    return null;
  }

  const playwrightTemp = playwrightDownloadsDir(options.dateFolder);
  const session = await launchBrowserSession({
    headless: options.config.headless,
    storageStatePath: authPath,
    downloadPath: playwrightTemp,
    pageTimeoutMs: options.config.pageTimeoutMs,
  });

  const listPage = session.page;
  const { context } = session;
  await loginToTender247(listPage, context, options.logger, options.config);
  await dismissTender247Interruptions(
    listPage,
    options.logger,
    options.config,
  );

  options.logger.info("T247_EVIDENCE_SESSION_READY=true");
  console.log("T247_EVIDENCE_SESSION_READY=true");

  activeSession = {
    context,
    listPage,
    close: async () => {
      try {
        await context.close();
      } catch {
        // ignore
      }
      if (activeSession?.context === context) {
        activeSession = null;
      }
    },
  };
  return activeSession;
}

export async function closeTender247EvidenceSession(): Promise<void> {
  if (!activeSession) {
    return;
  }
  await activeSession.close();
  activeSession = null;
}
