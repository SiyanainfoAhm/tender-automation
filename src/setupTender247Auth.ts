/**
 * Interactive Tender247 authentication setup (account-scoped).
 *
 * Usage:
 *   npm run auth:tender247
 *   npm run auth:tender247 -- --account-id=<uuid>
 *
 * Saves Playwright storageState under:
 *   auth/tender247/company-{companyId}/account-{accountId}/storage-state.json
 */
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  resolveTender247RunAccount,
  resolveTender247AccountAuthPaths,
} from "./company/tender247Accounts.js";
import { resolveRunCompanyId } from "./company/siyanaCompany.js";
import { loadConfig } from "./config.js";
import { getArgValue } from "./cli/requestedDate.js";
import { ensureDir } from "./fileUtils.js";
import { Logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  const accountId =
    getArgValue(argv, "account-id") ||
    process.env.TENDER247_ACCOUNT_ID?.trim() ||
    null;
  const companyId =
    getArgValue(argv, "company-id") ||
    resolveRunCompanyId();

  const account = await resolveTender247RunAccount({
    companyId,
    accountId,
  });
  const paths = resolveTender247AccountAuthPaths({
    companyId: account.companyId,
    accountId: account.accountId,
  });
  ensureDir(paths.accountRoot);
  ensureDir(paths.profileDir);

  const logger = new Logger(
    config.logRoot,
    "AuthSetup",
    account.logPrefix,
  );

  logger.info("Launching visible Chromium for Tender247 login...");
  logger.info(`ACCOUNT=${account.accountLabel} (${account.accountId})`);
  logger.info(`STORAGE_STATE=${paths.storageStatePath}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(config.tender247Url, { waitUntil: "domcontentloaded" });
    console.log("");
    console.log("======================================================");
    console.log("  Tender247 authentication setup");
    console.log(`  Company: ${account.companyId}`);
    console.log(`  Account: ${account.accountLabel}`);
    if (account.username) {
      console.log(`  Username: ${account.username}`);
    }
    console.log("======================================================");
    console.log("1. Log in manually in the opened browser window.");
    console.log("2. Confirm you can see the tender listing page.");
    console.log("3. Return here and press Enter to save the session.");
    console.log("======================================================");
    console.log("");

    const rl = readline.createInterface({ input, output });
    await rl.question("Press Enter after successful login to save session... ");
    rl.close();

    await context.storageState({
      path: paths.storageStatePath,
      indexedDB: true,
    });
    // Keep legacy path in sync only for the default/legacy account.
    if (account.accountId === "legacy-env") {
      await context.storageState({
        path: config.tender247AuthPath,
        indexedDB: true,
      });
    } else {
      try {
        const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
          "./supabase/client.js"
        );
        if (isSupabaseConfigured()) {
          const relative = path
            .relative(process.cwd(), paths.storageStatePath)
            .replace(/\\/g, "/");
          await getSupabaseAdminClient()
            .from("agenttender_company_tender247_accounts")
            .update({ session_storage_path: relative })
            .eq("id", account.accountId);
        }
      } catch {
        // non-fatal
      }
    }

    logger.info(
      `Saved storage state to ${path.relative(process.cwd(), paths.storageStatePath)}`,
    );
    console.log("");
    console.log("Authentication saved successfully.");
    console.log(`File: ${paths.storageStatePath}`);
    console.log(
      `Run: npm run pipeline:tender247 -- --account-id=${account.accountId}`,
    );
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
