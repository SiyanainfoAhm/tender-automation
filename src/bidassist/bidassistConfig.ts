import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { getTodayIsoDate } from "../dateUtils.js";
import { resolveProjectPath } from "../fileUtils.js";

loadDotenv({ path: resolveProjectPath(".env"), quiet: true });

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const BIDASSIST_ACTIVE_TENDERS_URL =
  "https://bidassist.com/all-tenders/active";

export interface BidassistConfig {
  baseUrl: string;
  tendersUrl: string;
  categoryUrl: string | null;
  authProfile: string;
  storageState: string;
  manualLoginTimeoutMs: number;
  mobileNumber: string | null;
  headless: boolean;
  category: string;
  openingDateFrom: string;
  openingDateTo: string | null;
  maxTenders: number;
  downloadTimeoutMs: number;
  continueOnError: boolean;
  downloadRoot: string;
  logRoot: string;
  screenshotRoot: string;
  pageTimeoutMs: number;
  projectRoot: string;
}

/** Format local date as "05 Aug 2026" for BidAssist date pickers. */
export function formatBidassistDisplayDate(date: Date = new Date()): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()]!;
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export function parseOpeningDateFromEnv(raw: string | undefined): string {
  const value = raw?.trim() || "";
  if (!value) {
    return formatBidassistDisplayDate(new Date());
  }
  // Accept YYYY-MM-DD and convert to display format
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return formatBidassistDisplayDate(d);
  }
  return value;
}

export function openingDateFromIso(raw: string | undefined): string {
  const value = raw?.trim() || "";
  if (!value) {
    return getTodayIsoDate();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  // Best-effort: keep as-is for metadata if already ISO-like
  return getTodayIsoDate();
}

export function loadBidassistConfig(): BidassistConfig {
  const projectRoot = process.cwd();
  const openingFromRaw = process.env.BIDASSIST_OPENING_DATE_FROM;
  const openingToRaw = process.env.BIDASSIST_OPENING_DATE_TO?.trim() || "";

  return {
    baseUrl: process.env.BIDASSIST_BASE_URL?.trim() || "https://bidassist.com",
    tendersUrl:
      process.env.BIDASSIST_TENDERS_URL?.trim() || BIDASSIST_ACTIVE_TENDERS_URL,
    categoryUrl: process.env.BIDASSIST_CATEGORY_URL?.trim() || null,
    authProfile:
      process.env.BIDASSIST_AUTH_PROFILE?.trim() || "./auth/bidassist-profile",
    storageState:
      process.env.BIDASSIST_STORAGE_STATE?.trim() || "./auth/bidassist.json",
    manualLoginTimeoutMs: Math.max(
      60_000,
      parseIntEnv(process.env.BIDASSIST_MANUAL_LOGIN_TIMEOUT_MS, 600_000),
    ),
    mobileNumber: process.env.BIDASSIST_MOBILE_NUMBER?.trim() || null,
    // First OTP login must be headed; honor env only when explicitly true after session exists
    headless: parseBool(process.env.BIDASSIST_HEADLESS, false),
    category:
      process.env.BIDASSIST_CATEGORY?.trim() || "Software and IT Solutions",
    openingDateFrom: parseOpeningDateFromEnv(openingFromRaw),
    openingDateTo: openingToRaw || null,
    maxTenders: Math.max(0, parseIntEnv(process.env.MAX_BIDASSIST_TENDERS, 5)),
    downloadTimeoutMs: Math.max(
      30_000,
      parseIntEnv(process.env.BIDASSIST_DOWNLOAD_TIMEOUT_MS, 300_000),
    ),
    continueOnError: parseBool(process.env.BIDASSIST_CONTINUE_ON_ERROR, true),
    downloadRoot: process.env.DOWNLOAD_ROOT?.trim() || "./downloads",
    logRoot: process.env.LOG_ROOT?.trim() || "./logs",
    screenshotRoot: process.env.SCREENSHOT_ROOT?.trim() || "./screenshots",
    pageTimeoutMs: parseIntEnv(process.env.PAGE_TIMEOUT_MS, 90_000),
    projectRoot,
  };
}

/** Direct category route wins over the generic active-tenders list. */
export function resolveBidassistTargetUrl(config: BidassistConfig): string {
  return config.categoryUrl || config.tendersUrl;
}

/** Route used when the preferred target URL renders Page Not Found. */
export function resolveBidassistFallbackUrl(config: BidassistConfig): string {
  const target = resolveBidassistTargetUrl(config);
  if (config.tendersUrl && config.tendersUrl !== target) {
    return config.tendersUrl;
  }
  return BIDASSIST_ACTIVE_TENDERS_URL;
}

export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function resolveBidassistProfilePath(config: BidassistConfig): string {
  return resolveProjectPath(config.authProfile);
}

export function resolveBidassistStorageStatePath(
  config: BidassistConfig,
): string {
  return resolveProjectPath(config.storageState);
}

export function bidassistDayRoot(
  config: BidassistConfig,
  dateIso = getTodayIsoDate(),
): string {
  return path.join(
    resolveProjectPath(config.downloadRoot),
    dateIso,
    "BidAssist",
  );
}

export function parseCliLimit(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--limit="));
  if (!arg) {
    return null;
  }
  const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
