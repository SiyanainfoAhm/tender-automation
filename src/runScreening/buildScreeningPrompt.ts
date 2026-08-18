import type { CompanyPreferenceSnapshot } from "./companyPreferences.js";

export const PHASE1_SCREENING_PROMPT_VERSION = "phase1-run-excel-v2";

function formatInr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "(not specified in database)";
  return `INR ${value.toLocaleString("en-IN")}`;
}

function listOrNone(items: string[]): string {
  if (!items.length) return "(none stored)";
  return items.map((item) => `- ${item}`).join("\n");
}

function extrasBlock(extras: Record<string, unknown>): string {
  const keys = Object.keys(extras).filter((key) => extras[key] != null && extras[key] !== "");
  if (keys.length === 0) return "";
  return `

OTHER STORED PREFERENCE EXTRAS
${keys.map((key) => `- ${key}: ${JSON.stringify(extras[key])}`).join("\n")}`;
}

export function buildTenderScreeningPrompt(options: {
  companySnapshot: CompanyPreferenceSnapshot;
  runDate: string;
  sourceExcelName: string;
  inputRowCount: number;
}): string {
  const { company, preferences } = options.companySnapshot;
  return `Evaluate the attached tender Excel for Phase-1 screening.

Company:
${company.name}

Use the following CURRENT company bid preferences as the
authoritative Phase-1 tender screening rules.

These values were loaded from the application database at screening time.
Do not substitute other company rules.

Run correlation ID: RUN-${options.runDate}
Attached workbook: ${options.sourceExcelName}
Expected unique tender rows: ${options.inputRowCount}

FINANCIAL PREFERENCES
Maximum EMD: ${formatInr(preferences.maxEmdInr)}
Minimum Tender Value: ${formatInr(preferences.minTenderValueInr)}
Maximum Tender Value: ${formatInr(preferences.maxTenderValueInr)}

PREFERRED SERVICE SCOPE
${listOrNone(preferences.serviceScope)}

EXCLUDED SCOPE
${listOrNone(preferences.excludedScope)}${extrasBlock(preferences.extras)}

Evaluate every tender in the attached workbook.

For every row assign one of:
NO_BID
VERIFY
MAY_BID
WILL_BID

Rules:
- Use NO_BID when the tender clearly violates the supplied company
  preferences.
- Use VERIFY when the scope appears relevant but the Excel does not
  contain enough information to determine qualification.
- Do not invent missing eligibility information.
- Keep every input tender row.
- Add/update Screening Status and Screening Reason.
- Return the completed XLSX workbook.

Do not return a prose-only answer or a shortlist-only sheet.
Preserve all existing input columns.
`;
}
