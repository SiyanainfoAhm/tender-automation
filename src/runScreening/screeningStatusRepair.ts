/**
 * Local Phase-1 repair for GPT rows that lack Screening Status / Reason.
 * Never overwrites a non-empty GPT status.
 */
import fs from "node:fs";
import path from "node:path";
import type { CompanyPreferenceSnapshot } from "./companyPreferences.js";
import { toTenderScreeningPreferenceSnapshot } from "./companyPreferences.js";
import {
  decidePhase1Row,
  type Phase1CrawlStatusLabel,
} from "./phase1DecisionGuard.js";
import {
  normalizePhase1ScreeningStatus,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";
import type { Phase1RowClassification, RunWorkbookRow } from "./runWorkbook.js";

export type ScreeningRepairEntry = {
  tenderId: string;
  oldStatus: null;
  newStatus: Phase1CrawlStatusLabel;
  reason: string;
  source: "LOCAL_RULE_REPAIR";
};

export type ScreeningRepairLog = {
  runId: string;
  repairedRows: ScreeningRepairEntry[];
  gptRows: number;
  screenedRows: number;
  validStatusRows: number;
  updatedAt: string;
};

const EXCLUSION_FLAG_REASONS: Array<{ key: string; label: string }> = [
  { key: "Hard Gate Failed", label: "a Phase-1 hard gate failed" },
  { key: "EOI", label: "EOI" },
  { key: "Empanelment", label: "empanelment" },
  { key: "Scanning / Digitization", label: "scanning/digitization" },
  { key: "Data Entry", label: "data entry" },
  { key: "Dedicated Manpower", label: "dedicated manpower" },
  { key: "Resource Augmentation", label: "resource augmentation" },
  { key: "COTS / Product / Licence", label: "COTS/product/licence procurement" },
  { key: "Product-specific AMC", label: "product-specific AMC" },
  { key: "API / SaaS Subscription", label: "API/SaaS subscription" },
  { key: "Hardware Dominant", label: "hardware-dominant delivery" },
  { key: "Network / Connectivity", label: "network/connectivity" },
  { key: "GIS Field Survey", label: "GIS field survey" },
  { key: "Cybersecurity Only", label: "cybersecurity-only work" },
  {
    key: "Industrial Automation / SCADA",
    label: "industrial automation/SCADA",
  },
  { key: "OEM Dependency", label: "OEM dependency" },
  { key: "Partner / JV Dependency", label: "partner/JV dependency" },
  { key: "Non-IT Dominant", label: "non-IT dominant work" },
];

function flagYes(
  classification: Phase1RowClassification | undefined,
  key: string,
): boolean {
  return Boolean(classification?.flags[key]);
}

function buildFlagReason(
  row: RunWorkbookRow,
  classification: Phase1RowClassification | undefined,
): string | null {
  if (!classification) return null;
  const hits = EXCLUSION_FLAG_REASONS.filter((item) =>
    flagYes(classification, item.key),
  ).map((item) => item.label);
  if (!hits.length) return null;

  const tenderType = classification.tenderType
    ? `${classification.tenderType}-based `
    : "";
  const procurement = classification.procurementModel
    ? ` (${classification.procurementModel})`
    : "";
  const titleHint = row.tenderName
    ? ` for ${row.tenderName.slice(0, 120).trim()}`
    : "";

  if (
    flagYes(classification, "EOI") ||
    flagYes(classification, "Hardware Dominant") ||
    flagYes(classification, "COTS / Product / Licence") ||
    flagYes(classification, "OEM Dependency") ||
    flagYes(classification, "Partner / JV Dependency")
  ) {
    return (
      `${tenderType}partner/product selection${titleHint}${procurement} is ` +
      `${hits.join(", ")} and does not align with the preferred software development scope.`
    );
  }

  return `Local repair: ${hits.join("; ")} established from GPT classification flags; Phase-1 status set to NO_BID.`;
}

function repairDecisionForRow(options: {
  row: RunWorkbookRow;
  input: RunWorkbookRow | undefined;
  snapshot: CompanyPreferenceSnapshot;
  runDate: string;
}): { status: Phase1CrawlStatusLabel; reason: string } {
  const { row, input, snapshot, runDate } = options;
  const classification = row.classification;
  const screening = toTenderScreeningPreferenceSnapshot(snapshot);

  const flagReason = buildFlagReason(row, classification);
  const hardGate =
    flagYes(classification, "Hard Gate Failed") ||
    Boolean(classification && classification.hardGateFailed);
  const exclusionHit = EXCLUSION_FLAG_REASONS.some((item) =>
    flagYes(classification, item.key),
  );

  if (hardGate || exclusionHit) {
    return {
      status: "NO_BID",
      reason:
        flagReason ||
        "Local repair: GPT classification flags establish an excluded or hard-gate failure; status set to NO_BID.",
    };
  }

  const preferred = (classification?.preferredScopeMatch || "").toUpperCase();
  if (preferred === "YES") {
    return {
      status: "MAY_BID",
      reason:
        "Local repair: GPT Preferred Scope Match=YES with no exclusion flags; status set to MAY_BID.",
    };
  }

  const title = [row.tenderName, input?.tenderName].filter(Boolean).join(" ");
  const semantic = decidePhase1Row({
    tenderId: row.tender247Id || row.canonicalId,
    title,
    deadline: input?.deadline || row.deadline,
    emdAmount: input?.emdAmount || row.emdAmount,
    estimatedCost: input?.estimatedCost || row.estimatedCost,
    runDate,
    snapshot: screening,
    llmStatus: null,
  });
  return { status: semantic.status, reason: semantic.reason };
}

export function repairMissingScreeningStatuses(options: {
  inputRows: RunWorkbookRow[];
  outputRows: RunWorkbookRow[];
  snapshot: CompanyPreferenceSnapshot;
  runDate: string;
  log?: (message: string) => void;
}): {
  rows: RunWorkbookRow[];
  repaired: ScreeningRepairEntry[];
} {
  const log = options.log ?? (() => undefined);
  const inputById = new Map(options.inputRows.map((row) => [row.canonicalId, row]));
  const missing = options.outputRows.filter((row) => !row.screeningStatus);
  log(`SCREENING_MISSING_STATUS_COUNT=${missing.length}`);

  const repaired: ScreeningRepairEntry[] = [];
  const rows = options.outputRows.map((row) => {
    if (row.screeningStatus) return row;
    const decision = repairDecisionForRow({
      row,
      input: inputById.get(row.canonicalId),
      snapshot: options.snapshot,
      runDate: options.runDate,
    });
    const stored = (normalizePhase1ScreeningStatus(decision.status) ??
      "VERIFY") as Phase1ScreeningStatus;
    const tenderId = row.canonicalId;
    log("SCREENING_STATUS_REPAIR");
    log(`TENDER_ID=${tenderId}`);
    log("OLD_STATUS=NULL");
    log(`NEW_STATUS=${decision.status}`);
    log("SOURCE=LOCAL_RULE_REPAIR");
    repaired.push({
      tenderId,
      oldStatus: null,
      newStatus: decision.status,
      reason: decision.reason,
      source: "LOCAL_RULE_REPAIR",
    });
    return {
      ...row,
      screeningStatus: stored,
      screeningReason: decision.reason,
    };
  });

  return { rows, repaired };
}

export function saveScreeningRepairLog(
  dateFolder: string,
  logPayload: ScreeningRepairLog,
): string {
  const dir = path.join(dateFolder, "screening");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "screening-repair-log.json");
  fs.writeFileSync(filePath, JSON.stringify(logPayload, null, 2), "utf8");
  return filePath;
}
