import { loadConfig } from "./config.js";
import { ensureDir } from "./fileUtils.js";
import { Logger } from "./logger.js";
import { AutomationError } from "./browserUtils.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
} from "./chatgptQualification/ensureChatGptLoggedIn.js";

/**
 * Interactive ChatGPT authentication setup using a persistent Chrome profile.
 * Saves storageState (indexedDB) to CHATGPT_STORAGE_STATE only after strong
 * auth verification + fresh-page validation.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ChatGptAuthSetup");
  ensureDir(config.authDir);

  logger.info("Launching persistent Chrome profile for ChatGPT login...");
  const session = await launchChatGptPersistentSession({ config, logger });

  try {
    await ensureChatGptLoggedIn({
      page: session.page,
      context: session.context,
      config,
      logger,
    });
    console.log("You can now run: npm run qualify:chatgpt");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AutomationError ? error.code : "";
    logger.error(`ChatGPT auth setup failed: ${message}`);
    console.log("");
    console.log("Authentication was NOT saved.");
    if (code === "CHATGPT_SAVED_SESSION_VALIDATION_FAILED") {
      console.log(
        "Browser was left open long enough for retry — re-run after logging in:",
      );
    }
    console.log("  npm run auth:chatgpt");
    process.exitCode = 1;
  } finally {
    await closeChatGptSession(session);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
