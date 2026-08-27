/**
 * Deterministic Phase-1 decision guard.
 * Hard gates and excluded/dominant-scope classification run in application
 * code so ChatGPT VERIFY cannot override a clear NO_BID.
 */
import { parseAmount } from "../excel/amountParser.js";
import type { CompanyPreferenceSnapshot } from "./companyPreferences.js";
import { toTenderScreeningPreferenceSnapshot } from "./companyPreferences.js";
import {
  hasSelectedScope,
  type ScreeningPolicy,
  type TenderScreeningPreferenceSnapshot,
} from "./screeningPolicy.js";
import {
  normalizePhase1CrawlStatus,
  normalizePhase1ScreeningStatus,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";
import type { RunWorkbookRow } from "./runWorkbook.js";

export type Phase1DominantScope =
  | "PREFERRED_SOFTWARE"
  | "EXCLUDED_HARDWARE"
  | "EXCLUDED_CONNECTIVITY"
  | "EXCLUDED_COTS"
  | "EXCLUDED_SURVEY"
  | "EXCLUDED_MANPOWER"
  | "EXCLUDED_AUDIT"
  | "EXCLUDED_INFRASTRUCTURE"
  | "EXCLUDED_NON_IT"
  | "EXCLUDED_SCANNING"
  | "EXCLUDED_EOI"
  | "AMBIGUOUS";

export type Phase1CrawlStatusLabel = "NO_BID" | "VERIFY" | "MAY_BID" | "WILL_BID";

export type Phase1SemanticDecision = {
  hardGateFailed: boolean;
  hardGateReason?: string;
  preferredScopeHits: string[];
  excludedScopeHits: string[];
  dominantScope: Phase1DominantScope;
  ambiguityRemaining: boolean;
  status: Phase1CrawlStatusLabel;
  reason: string;
  emdAmount: number | null;
  maxEmd: number | null;
};

const WEAK_PREFERRED = [
  { label: "ERP", re: /\berp\b/i },
  { label: "Software", re: /\bsoftware\b/i },
  { label: "Application", re: /\bapplications?\b/i },
  { label: "AI", re: /\bai\b|\bartificial intelligence\b/i },
  { label: "GIS", re: /\bgis\b/i },
  { label: "CMS", re: /\bcms\b/i },
  { label: "System Integration", re: /\bsystem integration\b|\bintegration\b/i },
  { label: "Maintenance", re: /\bmaintenance\b/i },
  { label: "AMC", re: /\bamc\b/i },
  {
    label: "O&M",
    re: /\bo\s*&\s*m\b|\boperation and maintenance\b|\boperations?\s+and\s+maintenance\b/i,
  },
];

const STRONG_PREFERRED = [
  {
    label: "Website / web application",
    re: /\bwebsite\b|\bweb portal\b|\bweb application\b|\bweb app\b/i,
  },
  {
    label: "Custom software development",
    re: /\bcustom software\b|\bsoftware development\b|\bapplication development\b/i,
  },
  { label: "Mobile application", re: /\bmobile (app|application)\b|\bandroid\b|\bios\b/i },
  { label: "CMS website", re: /\bcms[- ]based\b|\bdynamic website\b/i },
];

type FamilyRule = {
  family: Exclude<Phase1DominantScope, "PREFERRED_SOFTWARE" | "AMBIGUOUS">;
  label: string;
  re: RegExp;
  weight: number;
};

const EXCLUDED_FAMILY_RULES: FamilyRule[] = [
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "ICT Infrastructure",
    re: /\bict infrastructure\b|\bict infra\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "ICCC Infrastructure-heavy Work",
    re: /\biccc\b|\bintegrated command and control\b|\bcommand and control centre\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "Smart city infrastructure",
    re: /\bsmart city solutions?\b|\bsmart city\b/i,
    weight: 2,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "OEM / Specialist Infrastructure AMC",
    re: /\boem[- ]backed\b|\bserver infrastructure\b|\bdr server\b|\bdata[- ]centre\b|\bdata center\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "SCADA Hardware / SCADA O&M",
    re: /\bscada\b/i,
    weight: 3,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "CORS / Network Infrastructure AMC",
    re: /\bcors\b|\bcontinuously operating reference station\b|\bnetwork infrastructure\b|\binfrastructure amc\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_INFRASTRUCTURE",
    label: "Turnkey Lab / Coding Lab Hardware",
    re: /\bturnkey\b.{0,60}\b(ai\s+)?coding labs?\b|\b(ai\s+)?coding labs?\b|\bcomputer labs?\b|\bit labs?\b|\blab setup\b|\blab establishment\b|\blab infrastructure\b|\bworkstations?\b.{0,40}\blab\b|\blab\b.{0,40}\bworkstations?\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_HARDWARE",
    label: "Smart Classroom Hardware / AV Equipment",
    re: /\bsmart[- ]?class(room)?s?\b|\binteractive (flat )?panel\b|\bav equipment\b|\baudio[- ]visual\b|\bled (panel|display|tv|screen|monitor|board)\b|\bdigital board\b|\bsmart board\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_HARDWARE",
    label: "CCTV / Surveillance Hardware",
    re: /\bcctv\b|\bsurveillance\b/i,
    weight: 3,
  },
  {
    family: "EXCLUDED_HARDWARE",
    label: "Hardware Supply / Procurement",
    re: /\bhardware (only|supply|procurement|amc|maintenance)\b|\b(supply|procurement)\b.{0,40}\bhardware\b/i,
    weight: 3,
  },
  {
    family: "EXCLUDED_HARDWARE",
    label: "Hardware / LAN / Network Equipment AMC",
    re: /\bhardware\b.{0,60}\bamc\b|\bamc\b.{0,60}\bhardware\b|\blan\b.{0,40}\bamc\b|\bamc\b.{0,40}\blan\b|\bnetwork(ing)?\b.{0,40}\bamc\b|\bamc\b.{0,40}\bnetwork(ing)?\b|\bswitch(es)?\b.{0,30}\bamc\b|\brouter(s)?\b.{0,30}\bamc\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_HARDWARE",
    label: "VR / Simulator / Aircraft Training Hardware",
    re: /\bfighter[- ]aircraft\b|\bflight simulat|\bvr\b.{0,40}\btraining\b|\btraining (system|simulator)\b.{0,40}\b(vr|aircraft|fighter)\b|\bsimulator\b.{0,40}\b(aircraft|fighter|vr)\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_CONNECTIVITY",
    label: "Internet / Leased Line / MPLS",
    re: /\bleased line\b|\bmpls\b|\bbandwidth\b|\bdark fibre\b|\bdark fiber\b|\binternet service\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_CONNECTIVITY",
    label: "SMS / Messaging Gateway Service",
    re: /\bsms gateway\b|\bsms (service|portal|platform|operation)\b|\bmessaging gateway\b|\bsms[- ]based\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_COTS",
    label: "COTS Software / Packaged Software Procurement",
    re: /\betabs\b|\bpscad\b|\bautocad\b|\barcgis\b|\blicen[cs]e\b|\bsubscription\b|\bacademic bundle\b|\bcots\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_SURVEY",
    label: "Field Survey / GIS survey",
    re: /\bdgps\b|\bfield survey\b|\bdrone survey\b|\bproperty survey\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_MANPOWER",
    label: "Pure Manpower Outsourcing",
    re: /\bmanpower (supply|outsourcing)\b|\bdata[- ]entry\b|\bcomputer operator\b|\boperator supply\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_AUDIT",
    label: "IT Audit / Cyber Security Audit",
    re: /\bcyber ?security audit\b|\bit audit\b|\bvapt\b|\biso\s*27001\b|\bcompliance audit\b|\bsecurity audit\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_SCANNING",
    label: "Scanning / Digitization",
    re: /\bdocument scanning\b|\brecord scanning\b|\bdigitization\b|\bdigitisation\b|\barchival scanning\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_EOI",
    label: "EOI / Empanelment",
    re: /\bexpression of interest\b|\bempanelment\b/i,
    weight: 4,
  },
  {
    family: "EXCLUDED_NON_IT",
    label: "Non-IT",
    re: /\bcivil work\b|\bconstruction\b|\broad work\b|\bhousekeeping\b/i,
    weight: 4,
  },
];

const GENERIC_TITLE =
  /\bhiring of agency for it projects\b|\bmilestone basis\b|\bselection of msp\b|\bmanaged service provider\b/i;

function asNumber(value: number | ""): number | null {
  return value === "" || !Number.isFinite(value) ? null : value;
}

export function parsePhase1Amount(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const text = String(raw).trim();
  if (/refer\s*(to\s*)?(docs?|documents?)|not disclosed|n\/?a/i.test(text)) {
    return null;
  }
  return asNumber(parseAmount(text));
}

export function parsePhase1Date(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  const d = new Date(parsed);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function policyNoBid(policy: ScreeningPolicy | undefined, fallback: boolean): boolean {
  if (policy === "ALLOW") return false;
  if (policy === "VERIFY") return false;
  if (policy === "NO_BID") return true;
  return fallback;
}

function familyEnabled(
  family: Phase1DominantScope,
  snapshot: TenderScreeningPreferenceSnapshot,
): boolean {
  const excluded = snapshot.excludedScopes;
  const policies = snapshot.policies;
  switch (family) {
    case "EXCLUDED_HARDWARE":
    case "EXCLUDED_INFRASTRUCTURE":
      return (
        hasSelectedScope(excluded, /hardware/i) ||
        policyNoBid(policies.hardwareOnly, true) ||
        policyNoBid(policies.hardwareDominant, true)
      );
    case "EXCLUDED_CONNECTIVITY":
      return hasSelectedScope(
        excluded,
        /internet|connectivity|bandwidth|network|telecom|sms|lan|cors/i,
      );
    case "EXCLUDED_COTS":
      return policyNoBid(policies.cotsLicence, true) || policyNoBid(policies.softwareRenewal, true);
    case "EXCLUDED_SURVEY":
      return (
        hasSelectedScope(excluded, /survey|gis|non-?it/i) ||
        policyNoBid(policies.gisFieldSurvey, true)
      );
    case "EXCLUDED_MANPOWER":
      return (
        hasSelectedScope(excluded, /manpower|staffing/i) ||
        policyNoBid(policies.manpowerOnly, true)
      );
    case "EXCLUDED_AUDIT":
      return policyNoBid(policies.cybersecurityOnly, true);
    case "EXCLUDED_SCANNING":
      return hasSelectedScope(excluded, /scanning|digitization|digitisation/i);
    case "EXCLUDED_EOI":
      return (
        hasSelectedScope(excluded, /eoi|empanelment/i) ||
        policyNoBid(policies.eoi, false) ||
        policyNoBid(policies.empanelment, false)
      );
    case "EXCLUDED_NON_IT":
      return hasSelectedScope(excluded, /non-?it/i) || policyNoBid(policies.nonIt, true);
    default:
      return true;
  }
}

export function evaluateHardGates(options: {
  deadline: string;
  emdAmount: string;
  estimatedCost: string;
  runDate: string;
  snapshot: TenderScreeningPreferenceSnapshot;
}): { failed: boolean; reason?: string; code?: string; emdAmount: number | null } {
  const { snapshot } = options;
  const emd = parsePhase1Amount(options.emdAmount);
  const value = parsePhase1Amount(options.estimatedCost);
  const maxEmd = snapshot.financial.maxEmdInr;
  const maxValue = snapshot.financial.maxTenderValueInr;
  const minValue = snapshot.financial.minTenderValueInr;
  const deadline = parsePhase1Date(options.deadline);
  const runDate = parsePhase1Date(options.runDate);

  const expiredPolicy = snapshot.policies.expiredTender;
  const sameDayPolicy = snapshot.policies.sameDayDeadline;
  if (deadline && runDate) {
    const d = startOfDay(deadline);
    const r = startOfDay(runDate);
    if (d.getTime() < r.getTime() && policyNoBid(expiredPolicy, true)) {
      return {
        failed: true,
        code: "DEADLINE_EXPIRED",
        reason: "Closing date is same day/expired; insufficient bid-preparation time",
        emdAmount: emd,
      };
    }
    if (d.getTime() === r.getTime() && policyNoBid(sameDayPolicy, true)) {
      return {
        failed: true,
        code: "DEADLINE_SAME_DAY",
        reason: "Closing date is same day/expired; insufficient bid-preparation time",
        emdAmount: emd,
      };
    }
  }

  if (emd != null && maxEmd != null && emd > maxEmd) {
    return {
      failed: true,
      code: "EMD_LIMIT_EXCEEDED",
      reason: `EMD INR ${emd.toLocaleString("en-IN")} exceeds company maximum EMD INR ${maxEmd.toLocaleString("en-IN")}`,
      emdAmount: emd,
    };
  }

  if (value != null && maxValue != null && value > maxValue) {
    return {
      failed: true,
      code: "TENDER_VALUE_CEILING",
      reason: `Estimated tender value INR ${value.toLocaleString("en-IN")} exceeds company maximum tender value INR ${maxValue.toLocaleString("en-IN")}`,
      emdAmount: emd,
    };
  }

  if (value != null && minValue != null && minValue > 0 && value < minValue) {
    return {
      failed: true,
      code: "TENDER_VALUE_FLOOR",
      reason: `Estimated tender value INR ${value.toLocaleString("en-IN")} is below company minimum tender value INR ${minValue.toLocaleString("en-IN")}`,
      emdAmount: emd,
    };
  }

  return { failed: false, emdAmount: emd };
}

function classifyScope(
  text: string,
  snapshot: TenderScreeningPreferenceSnapshot,
): {
  preferredScopeHits: string[];
  excludedScopeHits: string[];
  dominantScope: Phase1DominantScope;
  ambiguityRemaining: boolean;
} {
  const preferredScopeHits: string[] = [];
  let preferredScore = 0;
  for (const hit of STRONG_PREFERRED) {
    if (hit.re.test(text)) {
      preferredScopeHits.push(hit.label);
      preferredScore += 3;
    }
  }
  for (const hit of WEAK_PREFERRED) {
    if (hit.re.test(text) && !preferredScopeHits.includes(hit.label)) {
      preferredScopeHits.push(hit.label);
      preferredScore += 1;
    }
  }

  const familyScores = new Map<Phase1DominantScope, { score: number; labels: string[] }>();
  for (const rule of EXCLUDED_FAMILY_RULES) {
    if (!familyEnabled(rule.family, snapshot)) continue;
    if (!rule.re.test(text)) continue;
    const current = familyScores.get(rule.family) ?? { score: 0, labels: [] };
    current.score += rule.weight;
    if (!current.labels.includes(rule.label)) current.labels.push(rule.label);
    familyScores.set(rule.family, current);
  }

  const excludedScopeHits = [...familyScores.values()].flatMap((item) => item.labels);
  let topFamily: Phase1DominantScope = "AMBIGUOUS";
  let topScore = 0;
  for (const [family, item] of familyScores) {
    if (item.score > topScore) {
      topScore = item.score;
      topFamily = family;
    }
  }

  const generic = GENERIC_TITLE.test(text) && preferredScore < 3 && topScore < 3;
  // Clear excluded / non-target delivery always beats preferred IT/AI keywords.
  if (topScore >= 3) {
    return {
      preferredScopeHits,
      excludedScopeHits,
      dominantScope: topFamily,
      ambiguityRemaining: false,
    };
  }
  if (preferredScore >= 3 && topScore < 3) {
    return {
      preferredScopeHits,
      excludedScopeHits,
      dominantScope: "PREFERRED_SOFTWARE",
      ambiguityRemaining: false,
    };
  }
  if (generic || (preferredScore === 0 && topScore === 0)) {
    return {
      preferredScopeHits,
      excludedScopeHits,
      dominantScope: "AMBIGUOUS",
      ambiguityRemaining: true,
    };
  }
  if (topScore > preferredScore) {
    return {
      preferredScopeHits,
      excludedScopeHits,
      dominantScope: topFamily,
      ambiguityRemaining: false,
    };
  }
  return {
    preferredScopeHits,
    excludedScopeHits,
    dominantScope: "AMBIGUOUS",
    ambiguityRemaining: true,
  };
}

export function decidePhase1Row(options: {
  tenderId: string;
  title: string;
  deadline: string;
  emdAmount: string;
  estimatedCost: string;
  runDate: string;
  snapshot: TenderScreeningPreferenceSnapshot;
  llmStatus?: string | null;
}): Phase1SemanticDecision {
  const hard = evaluateHardGates(options);
  const scope = classifyScope(options.title, options.snapshot);
  const maxEmd = options.snapshot.financial.maxEmdInr;
  const llm = normalizePhase1CrawlStatus(options.llmStatus);

  if (hard.failed) {
    return {
      hardGateFailed: true,
      hardGateReason: hard.code,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: false,
      status: "NO_BID",
      reason: hard.reason || "Hard gate failed",
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  const excludedDominant =
    scope.dominantScope.startsWith("EXCLUDED_") && !scope.ambiguityRemaining;

  if (excludedDominant) {
    const icccHeavy = scope.excludedScopeHits.some((hit) =>
      /ICCC|ICT Infrastructure/i.test(hit),
    );
    const reason =
      scope.dominantScope === "EXCLUDED_INFRASTRUCTURE" && icccHeavy
        ? "ICT infrastructure / ICCC infrastructure-heavy and specialist long-term O&M delivery dominates despite ERP/software terminology."
        : `Excluded dominant scope (${scope.excludedScopeHits.join(", ") || scope.dominantScope}) overrides preferred-scope keywords.`;
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: false,
      status: "NO_BID",
      reason,
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  // ChatGPT Status=NO_BID wins over title keyword "preferred" hits (e.g. "mobile"
  // in hardware supply). Never upgrade NO_BID → MAY_BID from local scope alone.
  if (llm === "NO_BID") {
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: scope.ambiguityRemaining,
      status: "NO_BID",
      reason: options.llmStatus ? "LLM NO_BID retained." : "NO_BID",
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  if (scope.dominantScope === "PREFERRED_SOFTWARE") {
    const status: Phase1CrawlStatusLabel = llm === "WILL_BID" ? "WILL_BID" : "MAY_BID";
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: false,
      status,
      reason:
        "Visible scope positively matches preferred software/application work and no exclusion dominates.",
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  // Never retain MAY_BID/WILL_BID when any excluded-family signal already fired.
  if (
    (llm === "MAY_BID" || llm === "WILL_BID") &&
    scope.excludedScopeHits.length > 0
  ) {
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope.startsWith("EXCLUDED_")
        ? scope.dominantScope
        : "AMBIGUOUS",
      ambiguityRemaining: false,
      status: "NO_BID",
      reason: `Excluded scope signals (${scope.excludedScopeHits.join(", ")}) override LLM ${llm}.`,
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  if (llm === "MAY_BID" || llm === "WILL_BID") {
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: scope.ambiguityRemaining,
      status: llm,
      reason: "LLM shortlist retained; no hard gate or excluded dominant scope.",
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  const canReturnVerify =
    !hard.failed &&
    scope.excludedScopeHits.length === 0 &&
    scope.dominantScope === "AMBIGUOUS" &&
    scope.ambiguityRemaining === true;

  if (!canReturnVerify) {
    return {
      hardGateFailed: false,
      preferredScopeHits: scope.preferredScopeHits,
      excludedScopeHits: scope.excludedScopeHits,
      dominantScope: scope.dominantScope,
      ambiguityRemaining: false,
      status: "NO_BID",
      reason: "VERIFY is prohibited because an excluded or non-ambiguous scope already applies.",
      emdAmount: hard.emdAmount,
      maxEmd,
    };
  }

  return {
    hardGateFailed: false,
    preferredScopeHits: scope.preferredScopeHits,
    excludedScopeHits: scope.excludedScopeHits,
    dominantScope: "AMBIGUOUS",
    ambiguityRemaining: true,
    status: "VERIFY",
    reason:
      "Title/brief is generic or ambiguous; no hard gate or excluded dominant scope; documents required for Phase-1 fit.",
    emdAmount: hard.emdAmount,
    maxEmd,
  };
}

export function logPhase1Decision(
  tenderId: string,
  decision: Phase1SemanticDecision,
  log: (message: string) => void,
): void {
  log(`PHASE1_TENDER_ID=${tenderId}`);
  log(`PHASE1_HARD_GATE_FAILED=${decision.hardGateFailed}`);
  if (decision.hardGateReason) log(`PHASE1_HARD_GATE_REASON=${decision.hardGateReason}`);
  if (decision.emdAmount != null) log(`PHASE1_EMD=${decision.emdAmount}`);
  if (decision.maxEmd != null) log(`PHASE1_MAX_EMD=${decision.maxEmd}`);
  log(`PHASE1_PREFERRED_SCOPE_HITS=${JSON.stringify(decision.preferredScopeHits)}`);
  log(`PHASE1_EXCLUDED_SCOPE_HITS=${JSON.stringify(decision.excludedScopeHits)}`);
  log(`PHASE1_DOMINANT_SCOPE=${decision.dominantScope}`);
  log(`PHASE1_AMBIGUITY_REMAINING=${decision.ambiguityRemaining}`);
  log(`PHASE1_STATUS=${decision.status}`);
}

function firstAmount(...values: string[]): string {
  for (const value of values) {
    if (parsePhase1Amount(value) != null) return value;
  }
  return values.find((value) => String(value || "").trim()) || "";
}

export function enforcePhase1ScreeningDecisions(options: {
  inputRows: RunWorkbookRow[];
  outputRows: RunWorkbookRow[];
  snapshot: CompanyPreferenceSnapshot;
  runDate: string;
  log?: (message: string) => void;
}): { rows: RunWorkbookRow[]; corrected: number } {
  const screening = toTenderScreeningPreferenceSnapshot(options.snapshot);
  const inputById = new Map(options.inputRows.map((row) => [row.canonicalId, row]));
  let corrected = 0;
  const rows = options.outputRows.map((output) => {
    const input = inputById.get(output.canonicalId);
    const title = [output.tenderName, input?.tenderName].filter(Boolean).join(" ");
    const decision = decidePhase1Row({
      tenderId: output.tender247Id || output.canonicalId,
      title,
      deadline: input?.deadline || output.deadline,
      emdAmount: firstAmount(input?.emdAmount || "", output.emdAmount),
      estimatedCost: firstAmount(input?.estimatedCost || "", output.estimatedCost),
      runDate: options.runDate,
      snapshot: screening,
      llmStatus: output.screeningStatus,
    });
    const tenderId = output.tender247Id || output.canonicalId;
    logPhase1Decision(tenderId, decision, options.log ?? (() => undefined));

    const stored = (normalizePhase1ScreeningStatus(decision.status) ??
      "VERIFY") as Phase1ScreeningStatus;
    if (
      stored === "NO_GO" &&
      output.screeningStatus &&
      output.screeningStatus !== "NO_GO"
    ) {
      corrected += 1;
    }
    const overwriteReason =
      decision.hardGateFailed || decision.dominantScope.startsWith("EXCLUDED_");
    return {
      ...output,
      // Always apply deterministic decision (crawl labels coerced to canonical).
      screeningStatus: stored,
      screeningReason: overwriteReason
        ? decision.reason
        : output.screeningReason || decision.reason,
    };
  });
  return { rows, corrected };
}
