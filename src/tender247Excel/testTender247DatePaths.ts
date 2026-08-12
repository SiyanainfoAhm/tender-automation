/**
 * Focused Tender247 date-path resolution test (no network / downloads / GPT).
 *
 * Usage:
 *   npm run test:tender247:date-paths -- --date=2026-08-11
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import {
  assertDateScopedPath,
  assertPathsStayOnRequestedDate,
  createTender247RunContext,
  parseCliDateOrToday,
  resolveTender247DateScopedPaths,
  withTender247RunContext,
} from "../tender247Batch/tender247RunContext.js";
import { resolveDefaultKeptExcelPath } from "./parseKeptExcelRows.js";
import { resolveUntilGoAuditDir } from "./writeUntilGoAudit.js";
import { createTenderFolder } from "../tenderDetails/tenderFolder.js";
import { playwrightDownloadsDir } from "../tender247Batch/createTenderZip.js";

export function parseDatePathsArgs(argv: string[]): { date: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    } else {
      values.set(body, "true");
    }
  }
  const fromArg = values.get("date")?.trim();
  const fromEnv = process.env.TENDER247_DATE?.trim() || process.env.DATE?.trim();
  return { date: parseCliDateOrToday(fromArg || fromEnv || null) };
}

export function runTender247DatePathsTest(
  argv: string[] = process.argv.slice(2),
): void {
  const args = parseDatePathsArgs(argv);
  const config = loadConfig();
  const context = createTender247RunContext(config.downloadRoot, args.date);
  const paths = resolveTender247DateScopedPaths(context, "TEST");

  // Cross-check existing helpers agree with the run context.
  const keptExcel = resolveDefaultKeptExcelPath(config.downloadRoot, args.date);
  const untilGoAudit = resolveUntilGoAuditDir(context.downloadRoot, "TEST");
  const playwright = playwrightDownloadsDir(context.downloadRoot);

  const relative = (p: string): string =>
    path.relative(process.cwd(), p).replace(/\\/g, "/") || p;

  console.log(`REQUESTED_DATE=${args.date}`);
  console.log(`EXCEL_PATH=${relative(paths.excelPath)}`);
  console.log(`FILTER_PATH=${relative(paths.filterPath)}`);
  console.log(`PLAYWRIGHT_PATH=${relative(paths.playwrightPath)}`);
  console.log(`TENDER_PATH=${relative(paths.tenderPath)}`);
  console.log(`AUDIT_PATH=${relative(paths.auditPath)}`);

  const all = [
    paths.excelPath,
    paths.filterPath,
    paths.playwrightPath,
    paths.tenderPath,
    paths.auditPath,
    keptExcel,
    untilGoAudit,
    playwright,
    context.downloadRoot,
  ];

  assertPathsStayOnRequestedDate(
    all,
    args.date,
    args.date === "2026-08-12" ? undefined : "2026-08-12",
  );

  // Explicit mismatch must throw (guard works).
  let threw = false;
  try {
    assertDateScopedPath(
      path.join(context.downloadsParent, "2026-08-12", "T247-X"),
      args.date,
      context.downloadsParent,
    );
  } catch (error) {
    threw = String(error).includes("TENDER247_DATE_SCOPED_PATH_MISMATCH");
  }
  if (args.date !== "2026-08-12" && !threw) {
    throw new Error("Expected assertDateScopedPath to reject wrong date folder");
  }

  // createTenderFolder path stays under requested date (no mkdir of wrong day).
  withTender247RunContext(context, () => {
    const folder = createTenderFolder(context.downloadRoot, "103227521");
    assertDateScopedPath(folder.root, args.date, context.downloadsParent);
  });

  if (!relative(paths.excelPath).includes(args.date)) {
    throw new Error(`Excel path missing requested date: ${paths.excelPath}`);
  }
  if (args.date !== "2026-08-12" && relative(paths.excelPath).includes("2026-08-12")) {
    throw new Error(`Excel path leaked system today: ${paths.excelPath}`);
  }

  console.log("DATE_PATH_TEST_SUCCESS=true");
}

async function main(): Promise<void> {
  try {
    runTender247DatePathsTest(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nDATE_PATH_TEST_FAILED\n${message}\n`);
    process.exitCode = 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void main();
}
