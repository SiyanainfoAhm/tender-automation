import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";
import { ensureDir } from "./fileUtils.js";
import { Logger } from "./logger.js";

/**
 * Interactive Tender247 authentication setup.
 * Opens a visible browser, lets the user log in manually,
 * then saves Playwright storageState to auth/tender247.json.
 * Never stores username or password in source code.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "AuthSetup");

  ensureDir(config.authDir);

  logger.info("Launching visible Chromium for Tender247 login...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(config.tender247Url, { waitUntil: "domcontentloaded" });
    // Console output for operator visibility during interactive auth
    console.log("");
    console.log("======================================================");
    console.log("  Tender247 authentication setup");
    console.log("======================================================");
    console.log("1. Log in manually in the opened browser window.");
    console.log("2. Confirm you can see the tender listing page.");
    console.log("3. Return here and press Enter to save the session.");
    console.log("======================================================");
    console.log("");

    const rl = readline.createInterface({ input, output });
    await rl.question("Press Enter after successful login to save session... ");
    rl.close();

    await context.storageState({ path: config.tender247AuthPath });
    logger.info(
      `Saved storage state to ${path.relative(process.cwd(), config.tender247AuthPath)}`,
    );
    console.log("");
    console.log("Authentication saved successfully.");
    console.log(`File: ${config.tender247AuthPath}`);
    console.log("You can now run: npm run test:tender247");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Auth setup failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
