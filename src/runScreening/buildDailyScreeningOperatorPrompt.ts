/**
 * Daily screening operator prompt and screening.md for the shared Siyana chat.
 */
import fs from "node:fs";
import path from "node:path";
import { formatIsoToDdMmYyyy } from "../dateUtils.js";
import type { CompanyPreferenceSnapshot } from "./companyPreferences.js";
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

/** Canonical screening.md body attached to every daily screening run. */
export function buildScreeningMdContent(): string {
  return `# Siyana Tender247 Daily Screening Preferences

## Scope

- Source: Tender247 Excel files only.
- Work: screening and final Excel generation only.
- Do not open Tender247, send email, or upload/upsert data anywhere.

## Input handling

1. Read every attached Tender247 Excel and every relevant sheet, including **Non-GeM Tenders** and **GeM Tenders**.
2. Combine all uploaded Tender247 source files.
3. Detect internal duplicates in this order. Do **not** remove any row:
   1. Tender ID
   2. Valid reference number
   3. Exact Authority + Tender Brief + Deadline
4. Compare against approximately 30 days of available screening history using the same matching order. Do **not** remove already-reviewed tenders.
5. Never use loose or fuzzy title matching for duplicate detection.

## Duplicate and historical-match handling

- Every imported tender must remain in the final workbook and system dataset.
- Do not delete, hide, exclude, or overwrite a duplicate tender.
- When a tender is an internal duplicate or matches a tender already present in the recent history/system, set \`Status\` to \`DUPLICATE\`.
- Do not apply \`NO_BID\`, \`VERIFY\`, or \`MAY_BID\` to a row marked \`DUPLICATE\`.
- A valid reference number is not blank and is not a placeholder such as \`-\`, \`0\`, \`00\`, \`01\`, \`02\`, \`N/A\`, or \`Nil\`.

Use one of these tender-specific decision reasons:

- \`Duplicate Tender247 ID: [Tender ID]. Existing tender record retained for review.\`
- \`Duplicate Reference Number: [Reference Number]. Matches Tender247 ID [Existing Tender ID].\`
- \`Duplicate tender: same Authority, Tender Brief, and Deadline as Tender247 ID [Existing Tender ID].\`
- \`Already reviewed tender: matches existing Tender247 ID [Existing Tender ID] from [Existing Run Date].\`

## Hard filters

Mark \`NO_BID\` when:

- Deadline is today or expired.
- EMD is above INR 15 lakh.
- Estimated tender value is above INR 5 crore.

Missing EMD or estimated value alone must not cause rejection.

## Scope evaluation

Evaluate the actual procurement, not keywords alone.

Potentially relevant software-led opportunities include:

- Website, web portal, mobile application
- ERP, HRMS, payroll, CRM
- Custom software, system integration, CMS, DMS, MIS/dashboard
- AI platform, chatbot, data platform
- Application development, software customisation, digital platform
- Custom website or software AMC/support/maintenance

Use \`VERIFY\` where the tender may be software-led but scope, eligibility, turnover, similar experience, or capability needs RFP review.

Mark \`NO_BID\` for:

- EOI, empanelment, partnership/JV-led, or resource-heavy work
- Manpower/resource outsourcing
- Hardware, CCTV/surveillance, server, firewall, network, telecom, connectivity, OEM supply
- Software licence/subscription/renewal or pre-owned product AMC
- Scanning/digitisation, survey, DPR, consultancy-only, non-IT
- Specialist cyber audit, VAPT, SOC work
- Industrial/plant automation where custom software is not the primary deliverable

Never state that a tender is manpower unless its title or available scope expressly asks for staffing/resources.

## Classification

Each final tender must have:

- One \`Tender Category\`
- One status only: \`DUPLICATE\`, \`NO_BID\`, \`VERIFY\`, or \`MAY_BID\`
- One tender-specific \`Decision Reason\` supported by the tender title/scope

\`MAY_BID\` means detailed RFP qualification is warranted. It is never an automatic \`WILL_BID\` decision.

## Output

- Create one Excel workbook with **one tab only**.
- Filename: \`DD-MM-YY_daily Tenders.xlsx\`.
- Keep the source tender fields and add:
  - Tender Category
  - Status
  - Decision Reason

## Final validation

- Final output row count equals the total imported row count.
- Every detected internal duplicate is retained and marked \`DUPLICATE\` with the matching reason.
- Every tender already found in recent history is retained and marked \`DUPLICATE\` with the matching reason.
- EMD and tender-value thresholds are correctly applied.
- Every status and reason matches the actual tender scope.
`;
}

/**
 * Exact daily operator prompt used in the shared Siyana screening chat.
 */
export function buildDailyScreeningOperatorPrompt(options: {
  runDate: string;
  sourceExcelName: string;
  screenableRowCount?: number;
  totalRowCount?: number;
  duplicateRowCount?: number;
}): string {
  const outName = dailyScreeningOutputFilename(options.runDate);
  const total = options.totalRowCount;
  const duplicates = options.duplicateRowCount ?? 0;
  const serverNote =
    typeof total === "number" && duplicates > 0
      ? `
Server attachments:
- \`duplicate-rows-manifest.json\` lists ${duplicates} duplicate/historical row(s) detected before screening.
- The attached workbook already marks those rows with \`Status = DUPLICATE\` — keep them unchanged.
- Final output must contain all ${total} imported rows.
`
      : typeof total === "number"
        ? `
Row integrity:
- Final output must contain all ${total} imported rows.
`
        : "";

  return `Run Siyana Tender247 Daily Screening for the attached Tender247 Excel file(s).

Follow the attached screening.md preferences exactly.

Scope

Analyse Tender247 files only. Do not open Tender247, send email, upload data, or use Supabase.

Process

1. Read all attached Tender247 files and relevant sheets, including Non-GeM Tenders and GeM Tenders.
2. Combine all uploaded Tender247 data. Preserve every imported tender row in the final workbook.
3. Detect internal duplicates in this priority: Tender247 ID; valid reference number; then exact Authority + Tender Brief + Deadline. Do not remove duplicate rows.
4. Compare against approximately 30 days of screening history using the same checks. Do not remove already-reviewed tenders.
5. For every internal duplicate or historical/system match, set Status to DUPLICATE and add the applicable tender-specific Decision Reason below. Do not assign NO_BID, VERIFY, or MAY_BID to a DUPLICATE row.
6. For every non-duplicate tender, apply Siyana hard rules and scope rules from screening.md, then assign Tender Category, Status, and Decision Reason.
7. Create one Excel workbook with one tab only.

Duplicate Decision Reasons

• Duplicate Tender247 ID: [Tender ID]. Existing tender record retained for review.
• Duplicate Reference Number: [Reference Number]. Matches Tender247 ID [Existing Tender ID].
• Duplicate tender: same Authority, Tender Brief, and Deadline as Tender247 ID [Existing Tender ID].
• Already reviewed tender: matches existing Tender247 ID [Existing Tender ID] from [Existing Run Date].

Reference-number rule: ignore blank values and placeholders such as -, 0, 00, 01, 02, N/A, and Nil.

Output

Filename: ${outName}

Keep all original tender fields and add Tender Category, Status, and Decision Reason.

Allowed statuses: DUPLICATE, NO_BID, VERIFY, MAY_BID. Never auto-mark WILL_BID.

Final Validation

The final workbook row count must equal the imported Tender247 row count. Every detected duplicate and historical match must remain visible with Status DUPLICATE and an evidence-based Decision Reason. Every non-duplicate status and reason must match the actual tender scope.
${serverNote}
Input workbook attached: ${options.sourceExcelName}
Run date: ${options.runDate}
Run correlation ID: RUN-${options.runDate}
`;
}

/** Write screening.md for ChatGPT attachment. */
export function writeScreeningMdPreferences(options: {
  snapshot?: CompanyPreferenceSnapshot;
  outputPath: string;
}): string {
  void options.snapshot;
  ensureDir(path.dirname(options.outputPath));
  fs.writeFileSync(options.outputPath, buildScreeningMdContent(), "utf8");
  return options.outputPath;
}
