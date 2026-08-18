/**
 * Interactive ChatGPT authentication using the canonical persistent Chrome profile.
 * Same command as `npm run chatgpt:login`.
 */
import { runChatGptManualLogin } from "./chatgptLogin.js";
import { AutomationError } from "./browserUtils.js";

async function main(): Promise<void> {
  try {
    await runChatGptManualLogin();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AutomationError ? error.code : "";
    console.log("");
    console.log("Authentication was NOT completed.");
    if (code) {
      console.log(code);
    }
    console.log(message);
    console.log("Re-run: npm run chatgpt:login");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
