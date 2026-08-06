import fs from "node:fs";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import {
  TENDER_DECISION_LABELS,
  TENDER_DECISION_REQUIRED_ACTIONS,
  TENDER_DECISION_STATUSES,
  type QualificationCondition,
  type QualificationResult,
  type TenderDecisionStatus,
} from "./types.js";

export function buildQualificationPrompt(
  sourcePortal: "TENDER247" | "BIDASSIST" | string,
  sourceTenderId: string,
  options?: { aiSummaryAvailable?: boolean },
): string {
  const portal =
    sourcePortal === "BIDASSIST" || sourcePortal === "BidAssist"
      ? "BIDASSIST"
      : "TENDER247";
  const aiSummaryAvailable =
    options?.aiSummaryAvailable ?? portal === "TENDER247";

  const useLines =
    portal === "BIDASSIST"
      ? [
          "Use:",
          "1. Consolidated Siyana credentials in Project Sources.",
          "2. The attached tender metadata.",
          "3. The attached complete BidAssist tender-document archive.",
          "",
          "No AI Summary was available for this tender. Analyse the complete tender",
          "documents directly.",
          "",
          "Do not return VERIFY merely because the AI Summary is absent if the",
          "complete tender documents contain sufficient eligibility information.",
        ]
      : aiSummaryAvailable
        ? [
            "Use:",
            "1. Consolidated Siyana credentials in Project Sources.",
            "2. The attached tender metadata.",
            "3. The attached AI Summary, when provided.",
            "4. The attached complete tender-document archive.",
          ]
        : [
            "Use:",
            "1. Consolidated Siyana credentials in Project Sources.",
            "2. The attached tender metadata.",
            "3. The attached AI Summary, when provided.",
            "4. The attached complete tender-document archive.",
            "",
            "No AI Summary was available for this tender. Analyse the complete",
            "tender documents directly.",
            "",
            "Do not return VERIFY merely because the AI Summary is absent if the",
            "complete tender documents contain sufficient eligibility information.",
          ];

  const t247Id = portal === "TENDER247" ? sourceTenderId : "";
  const bidassistId = portal === "BIDASSIST" ? sourceTenderId : "";

  return [
    "Evaluate this tender for Siyana Info Solutions Pvt. Ltd.",
    "",
    `Source portal: ${portal}`,
    `Source tender ID: ${sourceTenderId}`,
    "Company: Siyana Info Solutions Pvt. Ltd.",
    "",
    ...useLines,
    "",
    "Return exactly one status:",
    "",
    "GO",
    "CONDITIONAL_GO",
    "PARTNER_BID",
    "VERIFY",
    "NO_GO",
    "",
    "Rules:",
    "",
    "GO:",
    "All mandatory gates pass. Scope, price, risk and submission readiness are",
    "acceptable. The company qualifies independently.",
    "",
    "CONDITIONAL_GO:",
    "A specific and resolvable condition remains, but it can be completed",
    "before the bid deadline. Every condition must have a clear action,",
    "responsible owner and due date. Do not use this merely because source",
    "information is missing.",
    "",
    "PARTNER_BID:",
    "The company has a material qualification gap, but the tender expressly",
    "allows a JV, consortium, subcontractor or another eligible participation",
    "arrangement, and a suitable partner can cover the gap.",
    "",
    "VERIFY:",
    "RFP, corrigendum, company evidence or interpretation is missing,",
    "ambiguous or requires manual verification. Hold the final bid decision",
    "until verification is complete.",
    "",
    "NO_GO:",
    "A mandatory condition clearly fails, the scope is unsuitable, time is",
    "insufficient, an eligible partner arrangement is unavailable/not allowed,",
    "or the commercial or contractual risk is unacceptable.",
    "",
    "Do not return CONDITIONAL_GO for an unknown or ambiguous criterion.",
    "Return VERIFY instead.",
    "",
    "Do not return PARTNER_BID unless the tender documents expressly permit",
    "the relevant partner/JV/consortium/participation arrangement.",
    "",
    "Do not assume any company qualification that is not supported by the",
    "Project Source.",
    "",
    "Return only JSON:",
    "",
    "{",
    `  "sourcePortal": "${portal}",`,
    `  "sourceTenderId": "${sourceTenderId}",`,
    `  "t247Id": "${t247Id}",`,
    `  "bidassistId": "${bidassistId}",`,
    '  "company": "Siyana Info Solutions Pvt. Ltd.",',
    '  "status": "GO|CONDITIONAL_GO|PARTNER_BID|VERIFY|NO_GO",',
    '  "decisionLabel": "",',
    '  "verdict": "",',
    '  "reason": "",',
    '  "requiredAction": "",',
    '  "matchedCriteria": [],',
    '  "failedCriteria": [],',
    '  "unclearCriteria": [],',
    '  "missingDocuments": [],',
    '  "conditions": [',
    "    {",
    '      "condition": "",',
    '      "action": "",',
    '      "owner": "",',
    '      "dueDate": ""',
    "    }",
    "  ],",
    '  "partnershipRequiredFor": [],',
    '  "partnershipModeAllowed": [],',
    '  "manualReviewRequired": false,',
    '  "confidence": 0',
    "}",
  ].join("\n");
}

export function buildStatusCorrectionPrompt(
  invalidStatus: string,
  sourcePortal: "TENDER247" | "BIDASSIST" | string,
  sourceTenderId: string,
): string {
  return [
    `Your previous status value "${invalidStatus}" is invalid.`,
    `For tender ${sourcePortal}/${sourceTenderId}, reply again with ONE JSON object only.`,
    `status MUST be exactly one of: ${TENDER_DECISION_STATUSES.join(", ")}.`,
    "Keep the same schema including sourcePortal and sourceTenderId. No markdown. No commentary.",
  ].join("\n");
}

/**
 * Normalize any status / verdict string into a canonical TenderDecisionStatus.
 */
export function normalizeTenderDecisionStatus(
  value: unknown,
): TenderDecisionStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) {
    return null;
  }

  const aliases: Record<string, TenderDecisionStatus> = {
    GO: "GO",

    CONDITIONAL_GO: "CONDITIONAL_GO",
    CONDITIONAL: "CONDITIONAL_GO",

    PARTNER_BID: "PARTNER_BID",
    PARTNER: "PARTNER_BID",
    PARTNERSHIP: "PARTNER_BID",

    VERIFY: "VERIFY",
    VERIFICATION_REQUIRED: "VERIFY",

    NO_GO: "NO_GO",
    NOGO: "NO_GO",

    // Backward-compatibility aliases
    WILL_BID: "GO",
    NO_BID: "NO_GO",

    // Old MAY_BID was ambiguous → safe status
    MAY_BID: "VERIFY",
  };

  if (aliases[normalized]) {
    return aliases[normalized]!;
  }

  // Phrase-level fallbacks for free-text verdicts
  const upper = value.trim().toUpperCase().replace(/\s+/g, " ");

  if (
    /\bNO[_\s-]?BID\b/.test(upper) ||
    /\bNOT\s+QUALIFIED\b/.test(upper) ||
    /\bNO[-\s]?GO\b/.test(upper) ||
    /DO\s+NOT\s+BID/.test(upper)
  ) {
    return "NO_GO";
  }

  if (
    /\bPARTNER[_]?BID\b/.test(upper) ||
    /\bPARTNERSHIP\b/.test(upper) ||
    /\bJV\s+REQUIRED\b/.test(upper) ||
    /CONSORTIUM\s+REQUIRED/.test(upper) ||
    /PARTNER\s+REQUIRED/.test(upper)
  ) {
    return "PARTNER_BID";
  }

  if (
    /\bCONDITIONAL[_\s-]?GO\b/.test(upper) ||
    /\bCONDITIONAL\b/.test(upper)
  ) {
    return "CONDITIONAL_GO";
  }

  if (
    /\bMAY[_\s-]?BID\b/.test(upper) ||
    /\bVERIFY\b/.test(upper) ||
    /REVIEW\s+REQUIRED/.test(upper) ||
    /MANUAL\s+REVIEW/.test(upper) ||
    /INSUFFICIENT\s+INFORMATION/.test(upper) ||
    /VERIFICATION\s+REQUIRED/.test(upper)
  ) {
    return "VERIFY";
  }

  if (
    /\bWILL[_\s-]?BID\b/.test(upper) ||
    /(^|[^A-Z])GO([^A-Z]|$)/.test(upper) ||
    /\bQUALIFIED\b/.test(upper) ||
    /RECOMMENDED\s+TO\s+BID/.test(upper)
  ) {
    return "GO";
  }

  return null;
}

/** @deprecated Prefer normalizeTenderDecisionStatus */
export function normalizeQualificationStatus(
  statusOrVerdict: string | null | undefined,
): TenderDecisionStatus | null {
  return normalizeTenderDecisionStatus(statusOrVerdict);
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("No JSON object found in ChatGPT response");
  }

  const candidates = collectJsonCandidates(trimmed);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const variants = [
      candidate,
      sanitizeJsonControlCharacters(candidate),
      stripTrailingCommas(sanitizeJsonControlCharacters(candidate)),
    ];
    try {
      variants.push(jsonrepair(candidate));
      variants.push(jsonrepair(sanitizeJsonControlCharacters(candidate)));
    } catch {
      // jsonrepair itself may throw on empty input — ignore
    }

    for (const variant of variants) {
      try {
        return JSON.parse(variant);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(
    `Failed to parse ChatGPT JSON (${errors[errors.length - 1] ?? "unknown error"})`,
  );
}

/**
 * Parse + validate a qualification response, with minimal fallback when status
 * is clearly extractable but the full JSON object cannot be validated.
 */
export function parseAndValidateQualificationResponse(
  text: string,
  expectedSourceTenderId: string,
  expectedSourcePortal: "TENDER247" | "BIDASSIST" = "TENDER247",
):
  | { ok: true; result: QualificationResult; fallback: boolean }
  | { ok: false; error: string; status?: string } {
  try {
    const parsed = extractJsonObject(text);
    const validated = validateQualificationResult(
      parsed,
      expectedSourceTenderId,
      expectedSourcePortal,
    );
    if (validated.ok) {
      return { ok: true, result: validated.result, fallback: false };
    }

    const fallback = buildFallbackQualificationResult(
      text,
      expectedSourceTenderId,
      expectedSourcePortal,
    );
    if (fallback) {
      return { ok: true, result: fallback, fallback: true };
    }
    return validated;
  } catch (error) {
    const fallback = buildFallbackQualificationResult(
      text,
      expectedSourceTenderId,
      expectedSourcePortal,
    );
    if (fallback) {
      return { ok: true, result: fallback, fallback: true };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildFallbackQualificationResult(
  text: string,
  expectedSourceTenderId: string,
  expectedSourcePortal: "TENDER247" | "BIDASSIST" = "TENDER247",
): QualificationResult | null {
  const status =
    normalizeTenderDecisionStatus(text) ||
    extractStatusFromLooseText(text);
  if (!status) {
    return null;
  }

  const reasonMatch =
    text.match(/"reason"\s*:\s*"((?:\\.|[^"\\])*)"/i) ||
    text.match(/reason["']?\s*[:=]\s*["']?([^\n]{20,500})/i);
  const verdictMatch =
    text.match(/"verdict"\s*:\s*"((?:\\.|[^"\\])*)"/i) ||
    text.match(/verdict["']?\s*[:=]\s*["']?([^\n]{10,400})/i);

  const reason =
    (reasonMatch?.[1] ? unescapeJsonString(reasonMatch[1]) : "") ||
    (verdictMatch?.[1] ? unescapeJsonString(verdictMatch[1]) : "") ||
    `Recovered status ${status} from ChatGPT response after JSON repair failed.`;

  const verdict = verdictMatch?.[1]
    ? unescapeJsonString(verdictMatch[1])
    : TENDER_DECISION_LABELS[status];

  return finalizeQualificationResult({
    sourcePortal: expectedSourcePortal,
    sourceTenderId: expectedSourceTenderId,
    t247Id: expectedSourcePortal === "TENDER247" ? expectedSourceTenderId : "",
    bidassistId:
      expectedSourcePortal === "BIDASSIST" ? expectedSourceTenderId : "",
    company: "Siyana Info Solutions Pvt. Ltd.",
    status,
    decisionLabel: TENDER_DECISION_LABELS[status],
    verdict,
    reason,
    requiredAction: TENDER_DECISION_REQUIRED_ACTIONS[status],
    confidence: 0,
    matchedCriteria: [],
    failedCriteria: status === "NO_GO" ? ["Recovered from incomplete JSON"] : [],
    unclearCriteria: status === "VERIFY" ? ["Recovered from incomplete JSON"] : [],
    missingDocuments: [],
    conditions: [],
    partnershipRequiredFor: [],
    partnershipModeAllowed: [],
    manualReviewRequired: status === "VERIFY",
    evidenceFiles: [],
  });
}

const STATUS_TOKEN_RE =
  "GO|CONDITIONAL_GO|PARTNER_BID|VERIFY|NO_GO|WILL_BID|NO_BID|PARTNERSHIP|MAY_BID";

function extractStatusFromLooseText(text: string): TenderDecisionStatus | null {
  const quoted = text.match(
    new RegExp(`"status"\\s*:\\s*"(${STATUS_TOKEN_RE})"`, "i"),
  );
  if (quoted?.[1]) {
    return normalizeTenderDecisionStatus(quoted[1]);
  }
  const bare = text.match(
    new RegExp(`\\bstatus\\b\\s*[:=]\\s*(${STATUS_TOKEN_RE})\\b`, "i"),
  );
  if (bare?.[1]) {
    return normalizeTenderDecisionStatus(bare[1]);
  }
  return normalizeTenderDecisionStatus(text);
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function collectJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined): void => {
    if (!value) {
      return;
    }
    const next = value.trim();
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };

  push(text);

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(text)) !== null) {
    push(fenceMatch[1]);
  }

  const openFence = text.match(/```(?:json)?\s*(\{[\s\S]*)$/i);
  if (openFence?.[1]) {
    push(openFence[1]);
  }

  push(extractBalancedJsonObject(text));

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    push(text.slice(start, end + 1));
  }

  return candidates;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function sanitizeJsonControlCharacters(jsonText: string): string {
  let out = "";
  let inString = false;
  let escaping = false;

  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i]!;
    const code = jsonText.charCodeAt(i);

    if (inString) {
      if (escaping) {
        out += ch;
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaping = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      if (code >= 0 && code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
    }
    out += ch;
  }

  return out;
}

function stripTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,\s*([}\]])/g, "$1");
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map((x) => String(x)).filter((s) => s.trim() !== "");
}

function parseConditions(raw: unknown): QualificationCondition[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: QualificationCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const condition = String(obj.condition ?? "").trim();
    const action = String(obj.action ?? "").trim();
    const owner = String(obj.owner ?? "").trim();
    const dueDate = String(obj.dueDate ?? "").trim();
    if (!condition && !action && !owner && !dueDate) {
      continue;
    }
    out.push({ condition, action, owner, dueDate });
  }
  return out;
}

function isCompleteCondition(c: QualificationCondition): boolean {
  return Boolean(
    c.condition.trim() && c.action.trim() && c.owner.trim() && c.dueDate.trim(),
  );
}

/**
 * Apply status-specific rules, defaults, and display labels.
 */
export function finalizeQualificationResult(
  result: QualificationResult,
): QualificationResult {
  let status = result.status;
  let conditions = [...(result.conditions || [])];
  let partnershipRequiredFor = [...(result.partnershipRequiredFor || [])];
  let partnershipModeAllowed = [...(result.partnershipModeAllowed || [])];
  let failedCriteria = [...(result.failedCriteria || [])];
  let unclearCriteria = [...(result.unclearCriteria || [])];
  let missingDocuments = [...(result.missingDocuments || [])];
  let manualReviewRequired = Boolean(result.manualReviewRequired);

  // CONDITIONAL_GO without complete conditions → VERIFY
  if (status === "CONDITIONAL_GO") {
    const complete = conditions.filter(isCompleteCondition);
    if (complete.length === 0) {
      status = "VERIFY";
      conditions = [];
      manualReviewRequired = true;
      if (unclearCriteria.length === 0) {
        unclearCriteria = [
          "CONDITIONAL_GO lacked resolvable conditions with owner/action/dueDate",
        ];
      }
    } else {
      conditions = complete;
    }
  }

  // PARTNER_BID without express partnership mode → NO_GO
  if (status === "PARTNER_BID") {
    if (
      partnershipRequiredFor.length === 0 ||
      partnershipModeAllowed.length === 0
    ) {
      status = "NO_GO";
      if (failedCriteria.length === 0) {
        failedCriteria = [
          partnershipRequiredFor.length === 0
            ? "PARTNER_BID without partnershipRequiredFor — partnership not justified"
            : "Partnership arrangement not expressly permitted in tender documents",
        ];
      }
      partnershipModeAllowed = [];
      manualReviewRequired = false;
    }
  }

  // GO contradictions → safer status
  if (status === "GO") {
    if (failedCriteria.length > 0) {
      status = "NO_GO";
      conditions = [];
      partnershipRequiredFor = [];
      partnershipModeAllowed = [];
      manualReviewRequired = false;
    } else if (
      unclearCriteria.length > 0 ||
      missingDocuments.length > 0
    ) {
      status = "VERIFY";
      manualReviewRequired = true;
      conditions = [];
      partnershipRequiredFor = [];
      partnershipModeAllowed = [];
    } else {
      conditions = [];
      partnershipRequiredFor = [];
      partnershipModeAllowed = [];
      manualReviewRequired = false;
    }
  }

  if (status === "VERIFY") {
    manualReviewRequired = true;
    if (unclearCriteria.length === 0 && missingDocuments.length === 0) {
      unclearCriteria = ["Manual verification required"];
    }
  }

  if (status === "NO_GO") {
    conditions = [];
    if (
      failedCriteria.length === 0 &&
      !/\b(scope|time|risk|unsuitable|insufficient|unacceptable)/i.test(
        result.reason || result.verdict || "",
      )
    ) {
      // Keep as NO_GO if reason already explains; otherwise ensure a failure entry
      if (!(result.reason || "").trim()) {
        failedCriteria = ["Mandatory qualification failure"];
      }
    }
    if (!manualReviewRequired) {
      manualReviewRequired = false;
    }
  }

  const decisionLabel = TENDER_DECISION_LABELS[status];
  const requiredAction =
    (result.requiredAction || "").trim() ||
    TENDER_DECISION_REQUIRED_ACTIONS[status];
  const verdict =
    (result.verdict || "").trim() ||
    decisionLabel;
  const reason =
    (result.reason || "").trim() ||
    verdict;

  return {
    ...result,
    status,
    decisionLabel,
    verdict,
    reason,
    requiredAction,
    failedCriteria,
    unclearCriteria,
    missingDocuments,
    conditions,
    partnershipRequiredFor,
    partnershipModeAllowed,
    manualReviewRequired,
  };
}

/**
 * Status-specific completeness checks after finalizeQualificationResult.
 */
export function passesStatusSpecificValidation(
  result: QualificationResult,
): { ok: true } | { ok: false; error: string } {
  switch (result.status) {
    case "GO":
      if (result.failedCriteria.length > 0) {
        return { ok: false, error: "GO requires empty failedCriteria" };
      }
      if (result.unclearCriteria.length > 0) {
        return { ok: false, error: "GO requires empty unclearCriteria" };
      }
      if (result.partnershipRequiredFor.length > 0) {
        return { ok: false, error: "GO requires empty partnershipRequiredFor" };
      }
      if (result.conditions.length > 0) {
        return { ok: false, error: "GO requires empty conditions" };
      }
      if (result.manualReviewRequired) {
        return { ok: false, error: "GO requires manualReviewRequired=false" };
      }
      break;

    case "CONDITIONAL_GO": {
      const complete = result.conditions.filter(isCompleteCondition);
      if (complete.length === 0) {
        return {
          ok: false,
          error: "CONDITIONAL_GO requires at least one complete condition",
        };
      }
      if (result.failedCriteria.length > 0) {
        return {
          ok: false,
          error: "CONDITIONAL_GO cannot have confirmed mandatory failures",
        };
      }
      break;
    }

    case "PARTNER_BID":
      if (result.partnershipRequiredFor.length === 0) {
        return {
          ok: false,
          error: "PARTNER_BID requires partnershipRequiredFor",
        };
      }
      if (result.partnershipModeAllowed.length === 0) {
        return {
          ok: false,
          error: "PARTNER_BID requires partnershipModeAllowed",
        };
      }
      break;

    case "VERIFY":
      if (
        result.unclearCriteria.length === 0 &&
        result.missingDocuments.length === 0
      ) {
        return {
          ok: false,
          error: "VERIFY requires unclearCriteria or missingDocuments",
        };
      }
      if (!result.manualReviewRequired) {
        return { ok: false, error: "VERIFY requires manualReviewRequired=true" };
      }
      if (!(result.requiredAction || "").trim()) {
        return { ok: false, error: "VERIFY requires requiredAction" };
      }
      break;

    case "NO_GO": {
      const hasFailure = result.failedCriteria.length > 0;
      const hasRiskReason =
        /\b(scope|time|risk|unsuitable|insufficient|unacceptable|not\s+permitted|prohibited)/i.test(
          `${result.reason} ${result.verdict}`,
        );
      if (!hasFailure && !hasRiskReason) {
        return {
          ok: false,
          error:
            "NO_GO requires failedCriteria or a reason identifying unsuitable scope/time/risk",
        };
      }
      break;
    }

    default:
      return { ok: false, error: `Unknown status: ${String(result.status)}` };
  }

  return { ok: true };
}

export function validateQualificationResult(
  raw: unknown,
  expectedSourceTenderId: string,
  expectedSourcePortal: "TENDER247" | "BIDASSIST" = "TENDER247",
):
  | { ok: true; result: QualificationResult }
  | { ok: false; error: string; status?: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Response is not an object" };
  }
  const obj = raw as Record<string, unknown>;

  const verdictText =
    obj.verdict != null
      ? String(obj.verdict)
      : obj.status != null
        ? String(obj.status)
        : "";

  const normalized =
    normalizeTenderDecisionStatus(String(obj.status ?? "")) ||
    normalizeTenderDecisionStatus(verdictText) ||
    normalizeTenderDecisionStatus(
      `${String(obj.status ?? "")} ${String(obj.verdict ?? "")} ${String(obj.reason ?? "")}`,
    );

  if (!normalized) {
    return {
      ok: false,
      error: `Invalid status: ${obj.status ?? obj.verdict}`,
      status: String(obj.status ?? obj.verdict ?? ""),
    };
  }

  const responsePortalRaw = String(obj.sourcePortal ?? "")
    .trim()
    .toUpperCase();
  const responsePortal: "TENDER247" | "BIDASSIST" | null =
    responsePortalRaw === "TENDER247" || responsePortalRaw === "BIDASSIST"
      ? responsePortalRaw
      : null;

  const sourceTenderId = String(
    obj.sourceTenderId ??
      (expectedSourcePortal === "BIDASSIST"
        ? obj.bidassistId
        : obj.t247Id) ??
      "",
  )
    .replace(/^T247-/i, "")
    .replace(/^BA-/i, "")
    .trim();

  const t247Id = String(obj.t247Id ?? "")
    .replace(/^T247-/i, "")
    .trim();
  const bidassistId = String(obj.bidassistId ?? "")
    .replace(/^BA-/i, "")
    .trim();

  // Legacy Tender247-only responses may omit sourcePortal/sourceTenderId
  const effectivePortal = responsePortal || expectedSourcePortal;
  const effectiveId =
    sourceTenderId ||
    (expectedSourcePortal === "BIDASSIST" ? bidassistId : t247Id);

  if (responsePortal && responsePortal !== expectedSourcePortal) {
    return {
      ok: false,
      error: `sourcePortal mismatch: got ${responsePortal}, expected ${expectedSourcePortal}`,
    };
  }
  if (!effectiveId) {
    return { ok: false, error: "Missing sourceTenderId" };
  }
  if (effectiveId !== expectedSourceTenderId.replace(/^BA-/i, "").replace(/^T247-/i, "")) {
    // Also accept exact match including BA- prefix variants
    const expectedNorm = expectedSourceTenderId
      .replace(/^T247-/i, "")
      .replace(/^BA-/i, "");
    if (effectiveId !== expectedNorm && effectiveId !== expectedSourceTenderId) {
      return {
        ok: false,
        error: `sourceTenderId mismatch: got ${effectiveId}, expected ${expectedSourceTenderId}`,
      };
    }
  }

  const confidence = normalizeConfidence(obj.confidence);

  const draft: QualificationResult = {
    sourcePortal: effectivePortal,
    sourceTenderId: expectedSourceTenderId,
    t247Id:
      effectivePortal === "TENDER247"
        ? expectedSourceTenderId.replace(/^T247-/i, "")
        : t247Id,
    bidassistId:
      effectivePortal === "BIDASSIST"
        ? expectedSourceTenderId.replace(/^BA-/i, "")
        : bidassistId,
    company: String(obj.company ?? "Siyana Info Solutions Pvt. Ltd."),
    status: normalized,
    decisionLabel: String(obj.decisionLabel ?? ""),
    verdict: obj.verdict != null ? String(obj.verdict) : "",
    reason: String(obj.reason ?? obj.verdict ?? ""),
    requiredAction: String(obj.requiredAction ?? ""),
    confidence: confidence ?? 0,
    matchedCriteria: asStringArray(obj.matchedCriteria),
    failedCriteria: asStringArray(obj.failedCriteria),
    unclearCriteria: asStringArray(obj.unclearCriteria),
    missingDocuments: asStringArray(obj.missingDocuments),
    conditions: parseConditions(obj.conditions),
    partnershipRequiredFor: asStringArray(obj.partnershipRequiredFor),
    partnershipModeAllowed: asStringArray(obj.partnershipModeAllowed),
    manualReviewRequired: Boolean(obj.manualReviewRequired),
    requiresDetailedTenderReview: Boolean(obj.requiresDetailedTenderReview),
    evidenceFiles: asStringArray(obj.evidenceFiles),
    legacyStatus:
      obj.legacyStatus != null ? String(obj.legacyStatus) : undefined,
  };

  const result = finalizeQualificationResult(draft);

  if (!result.reason.trim()) {
    return { ok: false, error: "reason/verdict is empty" };
  }
  if (!result.verdict.trim()) {
    return { ok: false, error: "verdict is empty" };
  }
  if (!result.decisionLabel.trim()) {
    return { ok: false, error: "decisionLabel is empty" };
  }
  if (!result.requiredAction.trim()) {
    return { ok: false, error: "requiredAction is empty" };
  }

  const confNum = Number(result.confidence);
  if (!Number.isFinite(confNum) || confNum < 0 || confNum > 1) {
    return { ok: false, error: "confidence must be between 0 and 1" };
  }

  const statusCheck = passesStatusSpecificValidation(result);
  if (!statusCheck.ok) {
    return { ok: false, error: statusCheck.error, status: result.status };
  }

  return { ok: true, result };
}

export function normalizeConfidence(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }
  if (numberValue >= 0 && numberValue <= 1) {
    return numberValue;
  }
  if (numberValue > 1 && numberValue <= 100) {
    return numberValue / 100;
  }
  return null;
}

const LEGACY_STATUS_MAP: Record<string, TenderDecisionStatus> = {
  WILL_BID: "GO",
  NO_BID: "NO_GO",
  PARTNERSHIP: "PARTNER_BID",
  MAY_BID: "VERIFY",
};

/**
 * Migrate a saved qualification-result.json from legacy statuses.
 * Creates a `.legacy.bak` backup before overwriting.
 */
export function migrateLegacyQualificationResultFile(
  filePath: string,
): { migrated: boolean; result?: QualificationResult } {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      return { migrated: false };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    const rawStatus = String(raw.status ?? "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");

    if (!(rawStatus in LEGACY_STATUS_MAP)) {
      // Already canonical or unknown — try validate as-is
      return { migrated: false };
    }

    const legacyStatus = rawStatus;
    const newStatus = LEGACY_STATUS_MAP[legacyStatus]!;
    const id = String(raw.t247Id ?? "").replace(/^T247-/i, "");
    if (!id) {
      return { migrated: false };
    }

    const backupPath = `${filePath}.legacy.bak`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    const draft: QualificationResult = {
      t247Id: id,
      company: String(raw.company ?? "Siyana Info Solutions Pvt. Ltd."),
      status: newStatus,
      decisionLabel: TENDER_DECISION_LABELS[newStatus],
      verdict: String(raw.verdict ?? ""),
      reason: String(raw.reason ?? raw.verdict ?? ""),
      requiredAction: String(raw.requiredAction ?? ""),
      confidence: normalizeConfidence(raw.confidence) ?? 0,
      matchedCriteria: asStringArray(raw.matchedCriteria),
      failedCriteria: asStringArray(raw.failedCriteria),
      unclearCriteria: asStringArray(raw.unclearCriteria),
      missingDocuments: asStringArray(raw.missingDocuments),
      conditions: parseConditions(raw.conditions),
      partnershipRequiredFor: asStringArray(raw.partnershipRequiredFor),
      partnershipModeAllowed: asStringArray(raw.partnershipModeAllowed),
      manualReviewRequired:
        newStatus === "VERIFY" ? true : Boolean(raw.manualReviewRequired),
      requiresDetailedTenderReview: Boolean(raw.requiresDetailedTenderReview),
      evidenceFiles: asStringArray(raw.evidenceFiles),
      legacyStatus,
    };

    // Seed fields so status-specific validation can pass after migration
    if (newStatus === "NO_GO" && draft.failedCriteria.length === 0) {
      draft.failedCriteria = [
        draft.reason.trim() || "Migrated from legacy NO_BID",
      ];
    }
    if (newStatus === "VERIFY") {
      draft.manualReviewRequired = true;
      if (
        draft.unclearCriteria.length === 0 &&
        draft.missingDocuments.length === 0
      ) {
        draft.unclearCriteria = ["Migrated from legacy MAY_BID"];
      }
    }
    if (
      newStatus === "PARTNER_BID" &&
      draft.partnershipRequiredFor.length === 0
    ) {
      draft.partnershipRequiredFor = ["Migrated from legacy PARTNERSHIP"];
    }
    if (
      newStatus === "PARTNER_BID" &&
      draft.partnershipModeAllowed.length === 0
    ) {
      draft.partnershipModeAllowed = ["JV/consortium/partner (legacy)"];
    }

    const result = finalizeQualificationResult(draft);
    const validated = validateQualificationResult(result, id);
    if (!validated.ok) {
      // Write best-effort migrated shape anyway so later runs see new enums
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf8");
      return { migrated: true, result };
    }

    fs.writeFileSync(
      filePath,
      JSON.stringify(validated.result, null, 2),
      "utf8",
    );
    return { migrated: true, result: validated.result };
  } catch {
    return { migrated: false };
  }
}

export function migrateLegacyResultsInDateFolder(dateFolder: string): number {
  if (!fs.existsSync(dateFolder)) {
    return 0;
  }
  let count = 0;
  for (const entry of fs.readdirSync(dateFolder, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^T247-\d+$/i.test(entry.name)) {
      continue;
    }
    const resultPath = path.join(
      dateFolder,
      entry.name,
      "qualification-result.json",
    );
    const { migrated } = migrateLegacyQualificationResultFile(resultPath);
    if (migrated) {
      count += 1;
    }
  }
  return count;
}

export function isValidSavedQualificationResult(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      return false;
    }
    // Migrate legacy enums in-place before validating
    migrateLegacyQualificationResultFile(filePath);

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const portalRaw = String(data.sourcePortal ?? "TENDER247")
      .trim()
      .toUpperCase();
    const portal: "TENDER247" | "BIDASSIST" =
      portalRaw === "BIDASSIST" ? "BIDASSIST" : "TENDER247";
    const id = String(
      data.sourceTenderId ??
        (portal === "BIDASSIST" ? data.bidassistId : data.t247Id) ??
        "",
    )
      .replace(/^T247-/i, "")
      .replace(/^BA-/i, "")
      .trim();
    if (!id) {
      return false;
    }

    const tenderFolder = path.dirname(filePath);
    const responsePath = path.join(tenderFolder, "qualification-response.txt");
    if (!fs.existsSync(responsePath) || fs.statSync(responsePath).size <= 0) {
      return false;
    }

    const statePath = path.join(tenderFolder, "chatgpt-state.json");
    let submissionConfirmed = false;
    let chatUrl: string | null = null;
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
          submissionConfirmed?: boolean;
          chatUrl?: string | null;
          status?: string;
        };
        submissionConfirmed = state.submissionConfirmed === true;
        chatUrl = state.chatUrl ?? null;
        // Incomplete / never-submitted tenders must not be skipped as complete
        if (state.status === "not_ready" || state.status === "failed") {
          if (!submissionConfirmed) {
            return false;
          }
        }
      } catch {
        // ignore
      }
    }

    const validated = validateQualificationResult(data, id, portal);
    if (!validated.ok) {
      return false;
    }

    // Prefer confirmed submission; allow legacy completed only with /c/ URL + evidence
    if (!submissionConfirmed) {
      const hasConversation =
        typeof chatUrl === "string" && /\/c\/[^/?#]+/i.test(chatUrl);
      const hasEvidence =
        Array.isArray(data.evidenceFiles) && data.evidenceFiles.length > 0;
      if (!hasConversation || !hasEvidence) {
        return false;
      }
    }

    // VERIFY claiming docs unavailable with empty evidence is never complete
    if (
      validated.result.status === "VERIFY" &&
      (validated.result.evidenceFiles?.length ?? 0) === 0 &&
      /unavailable|not (provided|attached|uploaded)/i.test(
        `${validated.result.reason} ${validated.result.verdict}`,
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * True when the model claims mandatory uploaded files were unavailable.
 */
export function claimsMandatoryUploadsUnavailable(
  result: QualificationResult,
  uploadedEvidenceFiles: string[],
): boolean {
  if (!uploadedEvidenceFiles.length) {
    return false;
  }

  const blob = [
    result.reason,
    result.verdict,
    ...result.missingDocuments,
    ...result.unclearCriteria,
  ].join("\n");

  if (
    /tender documents? (are |were )?(unavailable|missing|not (provided|attached|available|uploaded))/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (
    /no (tender )?documents? (were )?(uploaded|attached|provided|available)/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (
    /attached files? (were )?(not|missing|unavailable)/i.test(blob) ||
    /files? (were )?not attached/i.test(blob)
  ) {
    return true;
  }

  const uploadedLower = uploadedEvidenceFiles.map((f) => f.toLowerCase());
  const hasMeta = uploadedLower.some((f) => f.includes("metadata"));
  const hasZip = uploadedLower.some(
    (f) => f.includes("tender_all_documents") || f.endsWith(".zip"),
  );
  const hasAi = uploadedLower.some((f) => /ai.?summary/i.test(f));

  for (const missing of result.missingDocuments) {
    const m = missing.toLowerCase();
    if (hasMeta && /metadata(\.json)?|tender metadata/i.test(m)) {
      return true;
    }
    if (
      hasZip &&
      /tender.?all.?documents|document archive|complete tender.?document/i.test(
        m,
      )
    ) {
      return true;
    }
    if (hasAi && /ai.?summary/i.test(m)) {
      return true;
    }
  }

  if (
    (result.evidenceFiles?.length ?? 0) === 0 &&
    /unavailable|not attached|not uploaded/i.test(blob)
  ) {
    return true;
  }

  return false;
}

export function withUploadedEvidenceFiles(
  result: QualificationResult,
  uploadedEvidenceFiles: string[],
): QualificationResult {
  if (!uploadedEvidenceFiles.length) {
    return result;
  }
  return {
    ...result,
    evidenceFiles: [...uploadedEvidenceFiles],
  };
}
