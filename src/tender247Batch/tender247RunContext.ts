/**
 * Canonical Tender247 run date + download root.
 *
 * CLI `--date` (or a single top-level default to today) becomes requestedDate.
 * After that, every date-scoped filesystem path must use this context —
 * never recalculate via new Date() / getTodayIsoDate().
 */
import fs from "node:fs";
import path from "node:path";
import { AutomationError } from "../browserUtils.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";
import { resolveProjectPath } from "../fileUtils.js";

export type Tender247RunContext = {
  /** YYYY-MM-DD from CLI (or one-time top-level default). */
  requestedDate: string;
  /** Absolute downloads/<requestedDate> root for this run (shared tender folders). */
  downloadRoot: string;
  /** Absolute parent of date folders (…/downloads). */
  downloadsParent: string;
  /** Optional Tender247 account id (for seed excel isolation). */
  accountId?: string | null;
  /** Subdir under downloadRoot for account-specific seed Excel. */
  seedExcelSubdir?: string | null;
};

let activeContext: Tender247RunContext | null = null;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCliDateOrToday(
  raw: string | null | undefined,
): string {
  const trimmed = raw?.trim();
  const date = (
    trimmed && trimmed.length > 0 ? trimmed : getIndiaTodayIsoDate()
  ).trim();
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`Invalid --date=${date}; expected YYYY-MM-DD`);
  }
  return date;
}

export function createTender247RunContext(
  downloadRootConfig: string,
  requestedDate: string,
  options?: {
    accountId?: string | null;
    seedExcelSubdir?: string | null;
  },
): Tender247RunContext {
  if (!ISO_DATE_RE.test(requestedDate)) {
    throw new Error(`Invalid requestedDate=${requestedDate}; expected YYYY-MM-DD`);
  }
  const downloadsParent = resolveProjectPath(downloadRootConfig);
  const downloadRoot = path.join(downloadsParent, requestedDate);
  return {
    requestedDate,
    downloadRoot,
    downloadsParent,
    accountId: options?.accountId ?? null,
    seedExcelSubdir: options?.seedExcelSubdir ?? null,
  };
}

export function setActiveTender247RunContext(
  context: Tender247RunContext | null,
): void {
  activeContext = context;
}

export function getActiveTender247RunContext(): Tender247RunContext | null {
  return activeContext;
}

export function withTender247RunContext<T>(
  context: Tender247RunContext,
  fn: () => T,
): T {
  const previous = activeContext;
  activeContext = context;
  try {
    return fn();
  } finally {
    activeContext = previous;
  }
}

export async function withTender247RunContextAsync<T>(
  context: Tender247RunContext,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = activeContext;
  activeContext = context;
  try {
    return await fn();
  } finally {
    activeContext = previous;
  }
}

/** Read YYYY-MM-DD from …/downloads/YYYY-MM-DD (basename). */
export function requestedDateFromDateFolder(dateFolder: string): string {
  const base = path.basename(path.resolve(dateFolder));
  if (!ISO_DATE_RE.test(base)) {
    throw new AutomationError(
      "TENDER247_DATE_FOLDER_INVALID",
      `dateFolder basename must be YYYY-MM-DD; got ${base} (${dateFolder})`,
    );
  }
  return base;
}

/**
 * If targetPath is under downloads/ and includes a YYYY-MM-DD segment that
 * differs from requestedDate, throw before any mkdir/write.
 */
export function assertDateScopedPath(
  targetPath: string,
  requestedDate: string,
  downloadsParent?: string,
): void {
  if (!ISO_DATE_RE.test(requestedDate)) {
    throw new Error(`Invalid requestedDate=${requestedDate}; expected YYYY-MM-DD`);
  }

  const resolved = path.resolve(targetPath);
  const parent = path.resolve(
    downloadsParent ??
      activeContext?.downloadsParent ??
      resolveProjectPath("downloads"),
  );

  const relative = path.relative(parent, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    // Outside downloads tree — not a date-scoped downloads write.
    return;
  }

  const firstSegment = relative.split(/[/\\]/).find((part) => part.length > 0);
  if (!firstSegment) {
    return;
  }

  if (ISO_DATE_RE.test(firstSegment) && firstSegment !== requestedDate) {
    throw new AutomationError(
      "TENDER247_DATE_SCOPED_PATH_MISMATCH",
      `TENDER247_DATE_SCOPED_PATH_MISMATCH requested=${requestedDate} target=${path.relative(process.cwd(), resolved) || resolved}`,
    );
  }

  // Also catch …/downloads/<wrong-date>/… when nested oddly.
  for (const part of relative.split(/[/\\]/)) {
    if (ISO_DATE_RE.test(part) && part !== requestedDate) {
      throw new AutomationError(
        "TENDER247_DATE_SCOPED_PATH_MISMATCH",
        `TENDER247_DATE_SCOPED_PATH_MISMATCH requested=${requestedDate} target=${path.relative(process.cwd(), resolved) || resolved}`,
      );
    }
  }
}

export function requestedDateFromDateFolderSafe(
  dirPath: string,
): string | null {
  try {
    let current = path.resolve(dirPath);
    for (let i = 0; i < 8; i += 1) {
      const base = path.basename(current);
      if (ISO_DATE_RE.test(base)) return base;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // ignore
  }
  return activeContext?.requestedDate ?? null;
}

/**
 * mkdir for a Tender247 date-scoped path with logging + mismatch guard.
 * Does not create the directory if the path is under the wrong date folder.
 */
export function ensureTender247DateScopedDir(
  dirPath: string,
  requestedDate?: string,
): string {
  const date = requestedDate ?? requestedDateFromDateFolderSafe(dirPath);

  if (date) {
    assertDateScopedPath(dirPath, date);
    const rel = path.relative(process.cwd(), path.resolve(dirPath));
    console.log(`TENDER247_MKDIR_REQUESTED_DATE=${date}`);
    console.log(`TENDER247_MKDIR_PATH=${rel || dirPath}`);
  }

  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function resolveExcelPath(context: Tender247RunContext): string {
  const fileName = `Tender247_${context.requestedDate}.xlsx`;
  if (context.seedExcelSubdir) {
    return path.join(context.downloadRoot, context.seedExcelSubdir, fileName);
  }
  return path.join(context.downloadRoot, fileName);
}

/** Directory that holds the account (or shared) seed Excel. */
export function resolveSeedExcelDir(context: Tender247RunContext): string {
  if (context.seedExcelSubdir) {
    return path.join(context.downloadRoot, context.seedExcelSubdir);
  }
  return context.downloadRoot;
}

export function resolveExcelFilterReviewDir(
  context: Tender247RunContext,
): string {
  return path.join(context.downloadRoot, "excel-filter-review");
}

export function resolvePlaywrightDownloadsDir(
  context: Tender247RunContext,
): string {
  return path.join(context.downloadRoot, "playwright-downloads");
}

export function resolveTenderFolder(
  context: Tender247RunContext,
  t247Id: string,
): string {
  const digits = String(t247Id).replace(/\D/g, "") || t247Id;
  return path.join(context.downloadRoot, `T247-${digits}`);
}

export function resolveUntilGoAuditDir(
  context: Tender247RunContext,
  t247Id: string,
): string {
  const digits = String(t247Id).replace(/\D/g, "") || t247Id;
  return path.join(context.downloadRoot, "until-go-audit", `T247-${digits}`);
}

/** Resolve expected path set for date-path smoke/regression tests. */
export function resolveTender247DateScopedPaths(
  context: Tender247RunContext,
  sampleTenderId = "TEST",
): {
  requestedDate: string;
  excelPath: string;
  filterPath: string;
  playwrightPath: string;
  tenderPath: string;
  auditPath: string;
} {
  return {
    requestedDate: context.requestedDate,
    excelPath: resolveExcelPath(context),
    filterPath: resolveExcelFilterReviewDir(context),
    playwrightPath: resolvePlaywrightDownloadsDir(context),
    tenderPath: resolveTenderFolder(context, sampleTenderId),
    auditPath: resolveUntilGoAuditDir(context, sampleTenderId),
  };
}

export function logTender247RunContext(context: Tender247RunContext): void {
  console.log(`TENDER247_RUN_REQUESTED_DATE=${context.requestedDate}`);
  console.log(`TENDER247_RUN_DOWNLOAD_ROOT=${context.downloadRoot}`);
  if (context.accountId) {
    console.log(`TENDER247_RUN_ACCOUNT_ID=${context.accountId}`);
  }
  if (context.seedExcelSubdir) {
    console.log(`TENDER247_RUN_SEED_EXCEL_DIR=${context.seedExcelSubdir}`);
  }
}

export function assertPathsStayOnRequestedDate(
  paths: string[],
  requestedDate: string,
  forbiddenDate?: string,
): void {
  const forbidden = forbiddenDate ?? null;
  for (const p of paths) {
    assertDateScopedPath(p, requestedDate);
    const normalized = p.replace(/\\/g, "/");
    if (forbidden && normalized.includes(`/${forbidden}/`)) {
      throw new AutomationError(
        "TENDER247_DATE_SCOPED_PATH_MISMATCH",
        `TENDER247_DATE_SCOPED_PATH_MISMATCH requested=${requestedDate} target=${p}`,
      );
    }
  }
}
