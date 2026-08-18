/**
 * Standalone ChatGPT manual login.
 * Opens the SAME persistent Chrome profile as the production pipeline.
 * Does not download Tender247 Excel, screen, crawl, or qualify tenders.
 */
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { AutomationError } from "./browserUtils.js";
import {
  CHATGPT_AUTH_BROWSER_CLOSED,
  CHATGPT_AUTH_READY,
  CHATGPT_AUTH_REQUIRED,
  CHATGPT_PROJECT_NAVIGATION_FAILED,
  inspectChatGptAuth,
  isChatGptBrowserGone,
  logChatGptAuthDiagnostics,
} from "./chatgptQualification/chatgptAuthState.js";
import { CHATGPT_PROFILE_DIR } from "./chatgptQualification/chatgptProfile.js";
import {
  closeChatGptSession,
  launchChatGptPersistentSession,
} from "./chatgptQualification/ensureChatGptLoggedIn.js";
import { openChatGptProject } from "./chatgptQualification/openProject.js";

export async function runChatGptManualLogin(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ChatGptManualLogin");
  const session = await launchChatGptPersistentSession({ config, logger });

  console.log("CHATGPT_MANUAL_AUTH_BROWSER_OPEN");
  console.log(`PROFILE=${CHATGPT_PROFILE_DIR}`);
  console.log("Login manually, open Siyana Tender Qualification Automation,");
  console.log("then close the browser.");
  logger.info("CHATGPT_MANUAL_AUTH_BROWSER_OPEN");
  logger.info(`PROFILE=${CHATGPT_PROFILE_DIR}`);

  let lastState = CHATGPT_AUTH_REQUIRED;
  let projectNavAttempted = false;

  try {
    await session.page.goto(config.chatgptUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(config.pageTimeoutMs, 60_000),
    });
    await session.page.waitForTimeout(1500);

    let lastLoggedState = "";
    while (!isChatGptBrowserGone(session.page)) {
      const inspected = await inspectChatGptAuth(
        session.page,
        config.chatgptProjectName,
      );
      lastState = inspected.state;
      if (inspected.state !== lastLoggedState) {
        lastLoggedState = inspected.state;
        await logChatGptAuthDiagnostics({
          page: session.page,
          logger,
          projectName: config.chatgptProjectName,
        });
      }

      if (inspected.state === CHATGPT_AUTH_READY && !projectNavAttempted) {
        projectNavAttempted = true;
        try {
          await openChatGptProject({
            page: session.page,
            projectName: config.chatgptProjectName,
            projectUrl: config.chatgptProjectUrl,
            projectMatch: config.chatgptProjectMatch,
            config,
            logger,
          });
          await logChatGptAuthDiagnostics({
            page: session.page,
            logger,
            projectName: config.chatgptProjectName,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(CHATGPT_PROJECT_NAVIGATION_FAILED);
          logger.error(message);
          logger.info(
            "Login is still valid. Open Siyana Tender Qualification Automation in the browser, then close it.",
          );
        }
      }

      await session.page.waitForTimeout(2000).catch(() => undefined);
    }

    if (lastState !== CHATGPT_AUTH_READY) {
      throw new AutomationError(
        CHATGPT_AUTH_BROWSER_CLOSED,
        "Browser was closed during authentication wait",
      );
    }

    logger.info(CHATGPT_AUTH_READY);
    logger.info("ChatGPT persistent profile retained (not reset).");
    console.log(CHATGPT_AUTH_READY);
    console.log(`PROFILE=${CHATGPT_PROFILE_DIR}`);
  } finally {
    await closeChatGptSession(session);
  }
}

const isDirectRun =
  process.argv[1] &&
  /chatgptLogin\.(ts|js)$/i.test(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  runChatGptManualLogin().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AutomationError ? error.code : "";
    console.error(code ? `${code}: ${message}` : message);
    process.exit(1);
  });
}
