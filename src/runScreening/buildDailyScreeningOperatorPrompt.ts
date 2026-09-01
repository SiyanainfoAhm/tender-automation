/**
 * Daily screening operator prompt — preserve every imported row; duplicates are marked DUPLICATE server-side.
 */
import fs from "node:fs";
import path from "node:path";
import { formatIsoToDdMmYyyy } from "../dateUtils.js";
import {
  toTenderScreeningPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "./companyPreferences.js";
import {
  formatNullableInr,
  PHASE1_SCREENING_POLICY_VERSION,
  SCREENING_POLICY_FIELD_DEFS,
} from "./screeningPolicy.js";
import { ensureDir } from "../fileUtils.js";

/** DD-MM-YY for ChatGPT output filename (e.g. 26-08-26). */
export function formatRunDateDdMmYy(isoDate: string): string {
  const ddmmyyyy = formatIsoToDdMmYyyy(isoDate);
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return `${dd}-${mm}-${String(yyyy).slice(-2)}`;
}

/** Exact ChatGPT output workbook name for a run date (e.g. 27-08-26_daily Tenders.xlsx). */
export function dailyScreeningOutputFilename(runDate: string): string {
  return `${formatRunDateDdMmYy(runDate)}_daily Tenders.xlsx`;
}

const DAILY_TENDERS_FILENAME_RE =
  /^(\d{2})-(\d{2})-(\d{2})_daily\s+tenders\.xlsx$/i;

/**
 * Parse `{DD-MM-YY}_daily Tenders.xlsx` → ISO `YYYY-MM-DD`, or null.
 * Years 00–69 → 2000–2069; 70–99 → 1970–1999.
 */
export function parseDailyScreeningFilenameToIso(filename: string): string | null {
  const base = path.basename(String(filename || "").trim());
  const m = base.match(DAILY_TENDERS_FILENAME_RE);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  if (!dd || !mm || Number.isNaN(yy)) return null;
  const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
  const iso = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

/** True when filename is a daily Excel for a calendar day strictly before runDate (ISO). */
export function isDailyScreeningFilenameBeforeRunDate(
  filename: string,
  runDateIso: string,
): boolean {
  const fileIso = parseDailyScreeningFilenameToIso(filename);
  if (!fileIso) return false;
  return fileIso < String(runDateIso).trim().slice(0, 10);
}

/**
 * Exact daily operator prompt used in the shared Siyana screening chat.
 * Preferences live in the attached screening.md — do not invent limits here.
 */
export function buildDailyScreeningOperatorPrompt(options: {
  runDate: string;
  sourceExcelName: string;
  screenableRowCount?: number;
  totalRowCount?: number;
}): string {
  const outName = dailyScreeningOutputFilename(options.runDate);
  const total = options.totalRowCount;
  const screenable = options.screenableRowCount;
  const rowContract =
    typeof total === "number" && typeof screenable === "number"
      ? `\nRow contract:\n- Total imported rows: ${total}\n- Rows requiring screening decisions: ${screenable}\n- Return exactly ${screenable} screened rows for non-duplicate tenders.\n- Do not remove duplicate or already-reviewed rows from the source file; the system preserves every imported row.\n`
      : "";
  return `Run Siyana Tender247 Daily Screening for the attached Tender247 Excel file(s).

Follow the attached \`screening.md\` preferences exactly.

Scope:
- Analyse Tender247 files only.
- Do not open Tender247, send email, upload data, or use Supabase.

Process:
1. Read all attached Tender247 files and relevant sheets, including Non-GeM Tenders and GeM Tenders.
2. Combine every uploaded row. Never delete, hide, or exclude any imported tender row.
3. Duplicate and historical matches are handled by the system. Screen only tenders that are not already marked DUPLICATE.
4. Apply Siyana’s hard rules and scope rules from \`screening.md\` to non-duplicate tenders only.
5. Assign every screened tender:
   - Tender Category
   - Status: NO_BID, VERIFY, or MAY_BID only
   - Tender-specific Decision Reason
6. Do not assign WILL_BID automatically.
7. Create one Excel workbook with one tab only.
${rowContract}
Filename:
${outName}

Keep the original tender fields and add Tender Category, Status, and Decision Reason.

Before returning the final Excel, validate that every screened row has exactly one of NO_BID, VERIFY, or MAY_BID and a tender-specific Decision Reason.

Input workbook attached: ${options.sourceExcelName}
Run date: ${options.runDate}
Run correlation ID: RUN-${options.runDate}
`;
}

/** Write screening.md from live company bid preferences for ChatGPT attachment. */
export function writeScreeningMdPreferences(options: {
  snapshot: CompanyPreferenceSnapshot;
  outputPath: string;
}): string {
  const screening = toTenderScreeningPreferenceSnapshot(options.snapshot);
  const lines: string[] = [
    `# Siyana Tender Screening Preferences`,
    ``,
    `Policy version: ${PHASE1_SCREENING_POLICY_VERSION}`,
    `Company: ${screening.companyName}`,
    ``,
    `## Financial limits`,
    ``,
    `- Maximum EMD: ${formatNullableInr(screening.financial.maxEmdInr)}`,
    `- Minimum tender value: ${formatNullableInr(screening.financial.minTenderValueInr)}`,
    `- Maximum tender value: ${formatNullableInr(screening.financial.maxTenderValueInr)}`,
    ``,
    `## Preferred scope`,
    ``,
  ];
  if (screening.preferredScopes.length === 0) {
    lines.push(`- (none stored)`);
  } else {
    for (const item of screening.preferredScopes) lines.push(`- ${item}`);
  }
  lines.push(``, `## Excluded scope`, ``);
  if (screening.excludedScopes.length === 0) {
    lines.push(`- (none stored)`);
  } else {
    for (const item of screening.excludedScopes) lines.push(`- ${item}`);
  }
  lines.push(``, `## Hard / named policies`, ``);
  for (const def of SCREENING_POLICY_FIELD_DEFS) {
    const value = screening.policies[def.key];
    lines.push(`- ${def.label}: ${value?.trim() || "(not supplied in database)"}`);
  }
  lines.push(
    ``,
    `## Status vocabulary`,
    ``,
    `- DUPLICATE — duplicate or already-reviewed tender (system-assigned; do not screen)`,
    `- NO_BID — out of scope / hard reject`,
    `- VERIFY — needs human verification`,
    `- MAY_BID — potentially bid-worthy`,
    ``,
    `Do not invent limits that are not listed above.`,
  );

  ensureDir(path.dirname(options.outputPath));
  fs.writeFileSync(options.outputPath, `${lines.join("\n")}\n`, "utf8");
  return options.outputPath;
}
