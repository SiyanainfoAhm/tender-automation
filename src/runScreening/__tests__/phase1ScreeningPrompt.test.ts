import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SIYANA_COMPANY_ID } from "../../company/siyanaCompany.js";
import { buildTenderScreeningPrompt } from "../buildScreeningPrompt.js";
import {
  hashPreferenceSnapshot,
  toTenderScreeningPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "../companyPreferences.js";
import {
  logActiveScreeningRules,
  PHASE1_SCREENING_POLICY_VERSION,
} from "../screeningPolicy.js";
import {
  runPhase1ExcelScreening,
} from "../runPhase1ExcelScreening.js";
import {
  readRunWorkbook,
  RUN_NORMALIZED_FILE,
  RUN_SCREENED_FILE,
  writeRunWorkbook,
} from "../runWorkbook.js";
import { loadScreeningManifest } from "../screeningManifest.js";
import { normalizePhase1ScreeningStatus } from "../phase1Statuses.js";
import XLSX from "xlsx";

function snapshot(
  overrides?: Partial<CompanyPreferenceSnapshot["preferences"]>,
): CompanyPreferenceSnapshot {
  return {
    company: {
      id: SIYANA_COMPANY_ID,
      name: "Siyana Info Solutions Pvt. Ltd.",
      industryType: "IT / Software",
      businessLocation: "Chennai",
      website: null,
      yearEstablished: 2014,
      description: "Software services",
      slug: "siyana",
    },
    preferences: {
      companyId: SIYANA_COMPANY_ID,
      maxEmdInr: 1_500_000,
      minTenderValueInr: 0,
      maxTenderValueInr: 50_000_000,
      serviceScope: [
        "Information Technology",
        "Software Development",
        "System Integration",
        "Mobile",
      ],
      excludedScope: [
        "NON-IT",
        "Scanning / Digitization",
        "Hardware Only",
        "Internet / Connectivity Service",
      ],
      extras: {},
      updatedAt: "2026-08-18T00:00:00.000Z",
      ...overrides,
    },
    loadedAt: "2026-08-18T00:00:00.000Z",
  };
}

function promptFor(
  prefs?: Partial<CompanyPreferenceSnapshot["preferences"]>,
  inputRowCount = 67,
): string {
  return buildTenderScreeningPrompt({
    companySnapshot: snapshot(prefs),
    runDate: "2026-08-17",
    sourceExcelName: RUN_NORMALIZED_FILE,
    inputRowCount,
  });
}

function preferredSection(prompt: string): string {
  const start = prompt.indexOf("PREFERRED SERVICE SCOPE");
  const end = prompt.indexOf("EXCLUDED SCOPE");
  return prompt.slice(start, end);
}

test("numeric EMD and tender-value lines come from the live snapshot, not hardcoded Siyana constants", () => {
  const a = promptFor({ maxEmdInr: 1_500_000 });
  const b = promptFor({ maxEmdInr: 2_000_000, maxTenderValueInr: 100_000_000 });
  assert.match(a, /Maximum EMD:\nINR 15,00,000/);
  assert.doesNotMatch(a, /INR 20,00,000/);
  assert.match(b, /Maximum EMD:\nINR 20,00,000/);
  assert.match(b, /Maximum Tender Value:\nINR 10,00,00,000/);
  assert.doesNotMatch(b, /Maximum EMD:\nINR 15,00,000/);
  assert.equal(a.includes("const maxEmd"), false);
});

test("EOI and other extras policies render dynamically from the database extras JSON", () => {
  const a = promptFor({ extras: { eoiPolicy: "NO_BID" } });
  const b = promptFor({ extras: { screeningPolicies: { eoi: "VERIFY" } } });
  assert.match(a, /EOI: NO_BID/);
  assert.match(b, /EOI: VERIFY/);
  assert.doesNotMatch(b, /EOI: NO_BID/);
  const screening = toTenderScreeningPreferenceSnapshot(
    snapshot({ extras: { eoiPolicy: "ALLOW" } }),
  );
  assert.equal(screening.policies.eoi, "ALLOW");
});

test("unselected UI service-scope chips are not injected as preferred company scopes", () => {
  const text = promptFor();
  const preferred = preferredSection(text);
  assert.match(preferred, /- Information Technology/);
  assert.match(preferred, /- Software Development/);
  assert.match(preferred, /- System Integration/);
  assert.match(preferred, /- Mobile/);
  assert.doesNotMatch(preferred, /Networking/);
  assert.doesNotMatch(preferred, /Cloud Services/);
  assert.doesNotMatch(preferred, /Cybersecurity/);
});

test("VERIFY vs MAY_BID contract is encoded in the generated prompt", () => {
  const text = promptFor();
  assert.match(text, /PHASE-1 STATUS PRIORITY/);
  assert.match(text, /Same-day \/ expired deadline → NO_BID/);
  assert.match(
    text,
    /DO NOT return VERIFY simply because the RFP\/ATC has not been reviewed/,
  );
  assert.match(
    text,
    /Even if an IT\/software word appears, classify NO_BID when the dominant/,
  );
  assert.match(text, /HARD_GATE_FAILED => NO_BID/);
  assert.match(
    text,
    /Do not use VERIFY merely because detailed PQ\/TQ eligibility information is\nabsent from a Phase-1 Excel/,
  );
  assert.match(
    text,
    /If the tender clearly matches preferred scope and all available Phase-1\nfinancial\/exclusion gates pass, use MAY_BID/,
  );
  assert.match(
    text,
    /Hiring of Agency for IT Projects - Milestone Basis/,
  );
  assert.match(
    text,
    /If the title is generic and actual scope is unavailable from the Excel/,
  );
  assert.doesNotMatch(
    text,
    /Use VERIFY when the scope appears relevant but the Excel does not/,
  );
});

test("hardware, COTS, and GIS interpretation follow current DB policies", () => {
  const text = promptFor({
    extras: {
      screeningPolicies: {
        hardwareDominant: "NO_BID",
        hardwareOnly: "NO_BID",
        cotsLicence: "NO_BID",
        gisSoftware: "ALLOW",
        gisFieldSurvey: "NO_BID",
      },
    },
  });
  assert.match(text, /Configured hardware-dominant policy: NO_BID/);
  assert.match(text, /Do not reject merely because incidental hardware is mentioned/);
  assert.match(text, /Configured COTS\/licence policy: NO_BID/);
  assert.match(text, /Do NOT automatically treat "software" as custom development/);
  assert.match(text, /Configured GIS software\/application policy: ALLOW/);
  assert.match(text, /Configured GIS field-survey policy: NO_BID/);
  assert.match(text, /GIS must NOT automatically be accepted or rejected/);
  assert.match(text, /ETABS/);
  assert.match(text, /DGPS survey/);
});

test("deadline status-priority defaults to NO_BID unless a contrary DB policy is stored", () => {
  const unset = promptFor();
  assert.match(unset, /If the tender has already expired, use NO_BID/);
  assert.match(unset, /If closing date is the screening date, use NO_BID/);
  const override = promptFor({
    extras: { screeningPolicies: { sameDayDeadline: "VERIFY", expiredTender: "ALLOW" } },
  });
  assert.match(override, /configured same-day rule: VERIFY/);
  assert.match(override, /configured expired-tender rule: ALLOW/);
  assert.doesNotMatch(override, /If closing date is the screening date, use NO_BID/);
});

test("workbook already normalized: prompt forbids a second dedupe pass and requires exact row count", () => {
  const text = promptFor(undefined, 67);
  assert.match(text, /already been normalized and deduplicated/);
  assert.match(text, /Do not perform another deduplication pass/);
  assert.match(text, /exactly 67 tender rows/);
  assert.match(text, /Do not delete NO_BID rows/);
  assert.match(text, /Evaluate exactly all 67 rows/);
});

test("policy version and preference snapshot hash change when extras policies change", () => {
  const a = snapshot({ extras: { eoiPolicy: "NO_BID" } });
  const b = snapshot({ extras: { eoiPolicy: "VERIFY" } });
  assert.notEqual(hashPreferenceSnapshot(a), hashPreferenceSnapshot(b));
  const prompt = promptFor({ extras: { eoiPolicy: "NO_BID" } });
  assert.match(prompt, new RegExp(`Phase-1 screening policy version: ${PHASE1_SCREENING_POLICY_VERSION}`));
});

test("active-rule logging prints only configured policy fields", () => {
  const lines: string[] = [];
  logActiveScreeningRules(
    toTenderScreeningPreferenceSnapshot(
      snapshot({
        extras: {
          eoiPolicy: "VERIFY",
          hardwareDominantPolicy: "NO_BID",
        },
      }),
    ),
    (message) => lines.push(message),
  );
  assert.ok(lines.some((line) => line === `[AI SCREENING] POLICY_VERSION=${PHASE1_SCREENING_POLICY_VERSION}`));
  assert.ok(lines.some((line) => line === "[AI SCREENING] MAX_EMD=1500000"));
  assert.ok(lines.some((line) => line === "[AI SCREENING] EOI_POLICY=VERIFY"));
  assert.ok(lines.some((line) => line.startsWith("[AI SCREENING] HARDWARE_POLICY=")));
  assert.equal(lines.some((line) => line.startsWith("[AI SCREENING] COTS_POLICY=")), false);
});

test("67 normalized rows remain 67 unique rows including NO_BID", async () => {
  const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "phase1-prompt-67-"));
  const t247Path = path.join(dateFolder, "Tender247_2026-08-17.xlsx");
  const rows = Array.from({ length: 67 }, (_, i) => [
    String(3001 + i),
    i === 0
      ? "Development of CMS-based dynamic website"
      : i === 1
        ? "Hiring of Agency for IT Projects - Milestone Basis"
        : `Tender ${3001 + i}`,
    "Dept",
    "0",
    "0",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["T247 ID", "TENDER BRIEF", "Organization", "ESTIMATED COST", "EMD"],
    ...rows,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tenders");
  XLSX.writeFile(workbook, t247Path);

  const result = await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-17",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: path.join(dateFolder, "missing-bidassist.xlsx"),
    companySnapshot: snapshot(),
    persistResults: false,
    chatgptClient: {
      async screenWorkbook({ inputWorkbookPath, outputPath }) {
        const input = readRunWorkbook(inputWorkbookPath);
        writeRunWorkbook(
          input.map((row, index) => ({
            ...row,
            screeningStatus: normalizePhase1ScreeningStatus(
              index === 0 ? "MAY_BID" : index === 1 ? "VERIFY" : index % 5 === 0 ? "NO_BID" : "MAY_BID",
            ) ?? "VERIFY",
            screeningReason:
              index === 0
                ? "CMS website matches preferred software scope; Phase-1 gates pass."
                : index === 1
                  ? "Generic IT title with no Excel scope; VERIFY before Phase-1 fit."
                  : `Tender-specific reason ${row.canonicalId}`,
          })),
          outputPath,
        );
        return outputPath;
      },
    },
  });

  assert.equal(result.inputRows, 67);
  assert.equal(result.outputRows, 67);
  const screened = readRunWorkbook(path.join(dateFolder, "screening", RUN_SCREENED_FILE));
  assert.equal(screened.length, 67);
  const ids = new Set(screened.map((row) => row.canonicalId));
  assert.equal(ids.size, 67);
  assert.ok(screened.some((row) => row.screeningStatus === "NO_GO"));
  assert.equal(
    screened.filter((row) => row.screeningStatus === "NO_GO").length,
    result.counts.NO_GO,
  );

  const promptPath = path.join(dateFolder, "screening", "chatgpt-screening-prompt.txt");
  const prefsPath = path.join(dateFolder, "screening", "company-preferences-snapshot.json");
  const savedPrompt = fs.readFileSync(promptPath, "utf8");
  assert.match(savedPrompt, /exactly 67 tender rows/);
  assert.match(savedPrompt, /SIYANA_PHASE1_V4/);
  const saved = JSON.parse(fs.readFileSync(prefsPath, "utf8")) as {
    screening: { preferredScopes: string[]; financial: { maxEmdInr: number } };
    screeningPolicyVersion: string;
  };
  assert.deepEqual(saved.screening.preferredScopes, [
    "Information Technology",
    "Software Development",
    "System Integration",
    "Mobile",
  ]);
  assert.equal(saved.screening.financial.maxEmdInr, 1_500_000);
  assert.equal(saved.screeningPolicyVersion, "SIYANA_PHASE1_V4");

  const manifest = loadScreeningManifest(dateFolder);
  assert.equal(manifest?.inputRows, 67);
  assert.equal(manifest?.outputRows, 67);
  assert.equal(manifest?.screeningPolicyVersion, "SIYANA_PHASE1_V4");
  assert.ok(manifest?.inputWorkbookHash);
  assert.ok(manifest?.companyPreferenceSnapshotHash);
  assert.ok(manifest?.screeningPromptHash);
  assert.ok(manifest?.screenedWorkbookHash);
});
