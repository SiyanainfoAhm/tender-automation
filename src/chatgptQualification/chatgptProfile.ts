/**
 * Single source of truth for the production ChatGPT browser profile.
 * Manual login (`npm run chatgpt:login`) and every ChatGPT pipeline path
 * must import this module instead of inventing another user-data dir.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";

/** Canonical persistent Chrome profile. Never use `.chatgpt-browser-profile`. */
export const CHATGPT_PROFILE_RELATIVE_DIR = path.join("auth", "chatgpt-profile");

export const DUPLICATE_CHATGPT_PROFILE_RELATIVE_DIR = ".chatgpt-browser-profile";

export function getChatGptProfileDir(): string {
  return resolveProjectPath(CHATGPT_PROFILE_RELATIVE_DIR);
}

/** Absolute path of the only ChatGPT persistent profile this project uses. */
export const CHATGPT_PROFILE_DIR = getChatGptProfileDir();

export type ChatGptPersistentLaunchOptions = {
  headless: false;
  channel: "chrome";
  chromiumSandbox: true;
  acceptDownloads: true;
  viewport: null;
  downloadsPath?: string;
};

/**
 * Exact Playwright launch options used by production ChatGPT sessions.
 * Manual login must call this same builder.
 */
export function buildChatGptPersistentLaunchOptions(
  downloadPath?: string,
): ChatGptPersistentLaunchOptions {
  return {
    headless: false,
    channel: "chrome",
    chromiumSandbox: true,
    acceptDownloads: true,
    viewport: null,
    ...(downloadPath ? { downloadsPath: downloadPath } : {}),
  };
}

export function chatgptProfileExists(profileDir = CHATGPT_PROFILE_DIR): boolean {
  try {
    return fs.existsSync(profileDir);
  } catch {
    return false;
  }
}

export function logChatGptProfileStartup(logger: Logger): void {
  const profileDir = CHATGPT_PROFILE_DIR;
  logger.info(`CHATGPT_PROFILE_DIR=${profileDir}`);
  logger.info(`CHATGPT_PROFILE_EXISTS=${chatgptProfileExists(profileDir)}`);
  const duplicate = resolveProjectPath(DUPLICATE_CHATGPT_PROFILE_RELATIVE_DIR);
  if (fs.existsSync(duplicate)) {
    logger.warn(
      `CHATGPT_DUPLICATE_PROFILE_IGNORED=${duplicate} (not used; canonical profile is ${profileDir})`,
    );
  }
}
