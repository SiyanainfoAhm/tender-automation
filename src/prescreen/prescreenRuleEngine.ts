import { parsePortalDate } from "../supabase/tenderMetadataMap.js";
import {
  loadPrescreenConfig,
  type PrescreenConfig,
} from "./prescreenConfig.js";
import {
  assertBidassistDidNotRunItClassifier,
  classifyTender247ItRelevance,
  type ItRelevanceClassifierCallTracker,
} from "./tender247ItRelevanceClassifier.js";
import type {
  PrescreenDecision,
  PrescreenFacts,
  PrescreenInput,
  PrescreenReasonCode,
  PrescreenStatus,
  PrescreenEffectiveStatus,
} from "./prescreenTypes.js";

const UNAVAILABLE_VALUE_MARKERS = [
  "refer documents",
  "refer document",
  "not disclosed",
  "as per rfp",
  "as per tender",
  "unavailable",
  "not available",
  "n/a",
  "na",
  "nil",
  "to be decided",
  "tbd",
];

export function getTodayIsoInTimezone(
  timezone: string,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    return now.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy!, fm! - 1, fd!);
  const to = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((to - from) / 86_400_000);
}

export function isTenderValueTextUnavailable(text: string | null | undefined): boolean {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return UNAVAILABLE_VALUE_MARKERS.some((m) => normalized.includes(m));
}

function decision(
  status: PrescreenStatus,
  effectiveStatus: PrescreenEffectiveStatus,
  chatgptEligible: boolean,
  reasonCode: PrescreenReasonCode,
  reason: string,
  facts: PrescreenFacts,
  rulesVersion: string,
): PrescreenDecision {
  return {
    status,
    effectiveStatus,
    chatgptEligible,
    reasonCode,
    reason,
    facts,
    rulesVersion,
  };
}

function baseFacts(
  input: PrescreenInput,
  config: PrescreenConfig,
  extras: Partial<PrescreenFacts>,
): PrescreenFacts {
  return {
    title: input.title || "",
    category: input.category || "",
    closingDate: extras.closingDate ?? "",
    closingDateUnavailable: extras.closingDateUnavailable ?? false,
    daysUntilClosing: extras.daysUntilClosing ?? null,
    tenderValue: extras.tenderValue ?? input.tenderValue ?? null,
    tenderValueText: extras.tenderValueText ?? input.tenderValueText ?? "",
    tenderValueUnavailable: extras.tenderValueUnavailable ?? false,
    emdAmount: extras.emdAmount ?? input.emdAmount ?? null,
    emdText: extras.emdText ?? input.emdText ?? "",
    emdRuleApplied: extras.emdRuleApplied ?? false,
    itRelevanceRuleApplied: extras.itRelevanceRuleApplied ?? false,
    itRelevance: extras.itRelevance ?? null,
    missingFields: extras.missingFields ?? [],
    thresholds: {
      tenderValueMaxInr: config.tenderValueMaxInr,
      emdMaxInr: config.tender247EmdMaxInr,
      minimumLeadDays: config.minLeadDays,
    },
    ...(extras.categoryGateAssumed
      ? { categoryGateAssumed: extras.categoryGateAssumed }
      : {}),
  };
}

function evaluateClosingDate(options: {
  closingIso: string | null;
  todayIso: string;
  minLeadDays: number;
  allowUnavailable: boolean;
}): {
  ok: boolean;
  reasonCode?: PrescreenReasonCode;
  reason?: string;
  daysUntilClosing: number | null;
  closingDateUnavailable: boolean;
} {
  const { closingIso, todayIso, minLeadDays, allowUnavailable } = options;
  if (!closingIso) {
    if (allowUnavailable) {
      return {
        ok: true,
        daysUntilClosing: null,
        closingDateUnavailable: true,
      };
    }
    return {
      ok: false,
      reasonCode: "MISSING_REQUIRED_SUMMARY",
      reason: "Closing date is missing",
      daysUntilClosing: null,
      closingDateUnavailable: true,
    };
  }

  const daysUntilClosing = calendarDaysBetween(todayIso, closingIso);
  if (daysUntilClosing < 0) {
    return {
      ok: false,
      reasonCode: "CLOSING_DATE_EXPIRED",
      reason: `Closing date ${closingIso} is before today ${todayIso}`,
      daysUntilClosing,
      closingDateUnavailable: false,
    };
  }
  if (daysUntilClosing === 0) {
    return {
      ok: false,
      reasonCode: "CLOSING_DATE_TODAY",
      reason: `Closing date is today (${closingIso})`,
      daysUntilClosing,
      closingDateUnavailable: false,
    };
  }
  if (daysUntilClosing < minLeadDays) {
    return {
      ok: false,
      reasonCode: "INSUFFICIENT_LEAD_TIME",
      reason: `Only ${daysUntilClosing} day(s) until closing; minimum is ${minLeadDays}`,
      daysUntilClosing,
      closingDateUnavailable: false,
    };
  }
  return {
    ok: true,
    daysUntilClosing,
    closingDateUnavailable: false,
  };
}

function evaluateTender247(
  input: PrescreenInput,
  config: PrescreenConfig,
  todayIso: string,
  tracker: ItRelevanceClassifierCallTracker,
): PrescreenDecision {
  const missingFields: string[] = [];
  if (!input.sourceTenderId?.trim()) missingFields.push("sourceTenderId");
  if (!input.title?.trim()) missingFields.push("title");

  const closingIso = parsePortalDate(input.closingDate);
  if (!closingIso) missingFields.push("closingDate");

  const tenderValue =
    typeof input.tenderValue === "number" && Number.isFinite(input.tenderValue)
      ? input.tenderValue
      : null;
  if (tenderValue == null) missingFields.push("tenderValue");

  const emdAmount =
    typeof input.emdAmount === "number" && Number.isFinite(input.emdAmount)
      ? input.emdAmount
      : null;
  if (emdAmount == null) missingFields.push("emdAmount");

  if (missingFields.length > 0) {
    return decision(
      "MANUAL_REVIEW",
      "VERIFY",
      false,
      "MISSING_REQUIRED_SUMMARY",
      `Missing required Tender247 summary fields: ${missingFields.join(", ")}`,
      baseFacts(input, config, {
        closingDate: closingIso || "",
        closingDateUnavailable: !closingIso,
        tenderValue,
        tenderValueUnavailable: tenderValue == null,
        emdAmount,
        emdRuleApplied: true,
        itRelevanceRuleApplied: config.tender247RequireItRelevance,
        missingFields,
      }),
      config.rulesVersion,
    );
  }

  const closing = evaluateClosingDate({
    closingIso,
    todayIso,
    minLeadDays: config.minLeadDays,
    allowUnavailable: false,
  });
  if (!closing.ok) {
    return decision(
      "REJECTED",
      "NO_GO",
      false,
      closing.reasonCode!,
      closing.reason!,
      baseFacts(input, config, {
        closingDate: closingIso!,
        closingDateUnavailable: false,
        daysUntilClosing: closing.daysUntilClosing,
        tenderValue,
        emdAmount,
        emdRuleApplied: true,
        itRelevanceRuleApplied: config.tender247RequireItRelevance,
      }),
      config.rulesVersion,
    );
  }

  if (emdAmount! > config.tender247EmdMaxInr) {
    return decision(
      "REJECTED",
      "NO_GO",
      false,
      "EMD_ABOVE_LIMIT",
      `EMD ₹${emdAmount} exceeds limit ₹${config.tender247EmdMaxInr}`,
      baseFacts(input, config, {
        closingDate: closingIso!,
        daysUntilClosing: closing.daysUntilClosing,
        tenderValue,
        emdAmount,
        emdRuleApplied: true,
        itRelevanceRuleApplied: config.tender247RequireItRelevance,
      }),
      config.rulesVersion,
    );
  }

  if (tenderValue! > config.tenderValueMaxInr) {
    return decision(
      "REJECTED",
      "NO_GO",
      false,
      "TENDER_VALUE_ABOVE_LIMIT",
      `Tender value ₹${tenderValue} exceeds limit ₹${config.tenderValueMaxInr}`,
      baseFacts(input, config, {
        closingDate: closingIso!,
        daysUntilClosing: closing.daysUntilClosing,
        tenderValue,
        emdAmount,
        emdRuleApplied: true,
        itRelevanceRuleApplied: config.tender247RequireItRelevance,
      }),
      config.rulesVersion,
    );
  }

  let itRelevance = null as PrescreenFacts["itRelevance"];
  if (config.tender247RequireItRelevance) {
    const scopeText = [input.title, input.description, input.category]
      .filter(Boolean)
      .join(" ");
    itRelevance = classifyTender247ItRelevance(scopeText, tracker);
    if (itRelevance === "NON_IT") {
      return decision(
        "REJECTED",
        "NO_GO",
        false,
        "NON_IT_SCOPE",
        "Scope is clearly non-IT",
        baseFacts(input, config, {
          closingDate: closingIso!,
          daysUntilClosing: closing.daysUntilClosing,
          tenderValue,
          emdAmount,
          emdRuleApplied: true,
          itRelevanceRuleApplied: true,
          itRelevance,
        }),
        config.rulesVersion,
      );
    }
    if (itRelevance === "AMBIGUOUS") {
      return decision(
        "MANUAL_REVIEW",
        "VERIFY",
        false,
        "AMBIGUOUS_SCOPE",
        "Scope relevance is ambiguous",
        baseFacts(input, config, {
          closingDate: closingIso!,
          daysUntilClosing: closing.daysUntilClosing,
          tenderValue,
          emdAmount,
          emdRuleApplied: true,
          itRelevanceRuleApplied: true,
          itRelevance,
        }),
        config.rulesVersion,
      );
    }
  }

  return decision(
    "PASSED",
    null,
    true,
    "PASSED_BASIC_SCREENING",
    "Passed Tender247 deterministic pre-screening",
    baseFacts(input, config, {
      closingDate: closingIso!,
      daysUntilClosing: closing.daysUntilClosing,
      tenderValue,
      emdAmount,
      emdRuleApplied: true,
      itRelevanceRuleApplied: config.tender247RequireItRelevance,
      itRelevance,
    }),
    config.rulesVersion,
  );
}

function evaluateBidassist(
  input: PrescreenInput,
  config: PrescreenConfig,
  todayIso: string,
  tracker: ItRelevanceClassifierCallTracker,
): PrescreenDecision {
  // Defensive: never run IT classifier for BidAssist
  assertBidassistDidNotRunItClassifier("BIDASSIST", tracker);

  const missingFields: string[] = [];
  if (!input.sourceTenderId?.trim()) missingFields.push("sourceTenderId");
  if (!input.title?.trim()) missingFields.push("title");
  if (!input.documentArchiveAvailable) missingFields.push("originalZip");
  if (!input.hasNormalizedMetadata) missingFields.push("normalizedMetadata");

  if (missingFields.length > 0) {
    return decision(
      "MANUAL_REVIEW",
      "VERIFY",
      false,
      "MISSING_REQUIRED_SUMMARY",
      `Missing required BidAssist identity/archive fields: ${missingFields.join(", ")}`,
      baseFacts(input, config, {
        closingDateUnavailable: !parsePortalDate(input.closingDate),
        tenderValueUnavailable:
          input.tenderValue == null ||
          isTenderValueTextUnavailable(input.tenderValueText),
        emdRuleApplied: false,
        itRelevanceRuleApplied: false,
        itRelevance: null,
        missingFields,
        categoryGateAssumed: "Software and IT Solutions",
      }),
      config.rulesVersion,
    );
  }

  const closingIso = parsePortalDate(input.closingDate);
  const closing = evaluateClosingDate({
    closingIso,
    todayIso,
    minLeadDays: config.minLeadDays,
    allowUnavailable: true,
  });
  if (!closing.ok) {
    return decision(
      "REJECTED",
      "NO_GO",
      false,
      closing.reasonCode!,
      closing.reason!,
      baseFacts(input, config, {
        closingDate: closingIso || "",
        closingDateUnavailable: closing.closingDateUnavailable,
        daysUntilClosing: closing.daysUntilClosing,
        emdRuleApplied: false,
        itRelevanceRuleApplied: false,
        itRelevance: null,
        categoryGateAssumed: "Software and IT Solutions",
      }),
      config.rulesVersion,
    );
  }

  const tenderValue =
    typeof input.tenderValue === "number" && Number.isFinite(input.tenderValue)
      ? input.tenderValue
      : null;
  const tenderValueUnavailable =
    tenderValue == null || isTenderValueTextUnavailable(input.tenderValueText);

  if (!tenderValueUnavailable && tenderValue! > config.tenderValueMaxInr) {
    return decision(
      "REJECTED",
      "NO_GO",
      false,
      "TENDER_VALUE_ABOVE_LIMIT",
      `Tender value ₹${tenderValue} exceeds limit ₹${config.tenderValueMaxInr}`,
      baseFacts(input, config, {
        closingDate: closingIso || "",
        closingDateUnavailable: closing.closingDateUnavailable,
        daysUntilClosing: closing.daysUntilClosing,
        tenderValue,
        tenderValueUnavailable: false,
        emdRuleApplied: false,
        itRelevanceRuleApplied: false,
        itRelevance: null,
        categoryGateAssumed: "Software and IT Solutions",
      }),
      config.rulesVersion,
    );
  }

  // EMD is never a rejection gate for BidAssist — recorded as fact only
  assertBidassistDidNotRunItClassifier("BIDASSIST", tracker);
  if (config.bidassistRequireItRelevance) {
    // Config must stay false; if enabled incorrectly, still do not classify.
    assertBidassistDidNotRunItClassifier("BIDASSIST", tracker);
  }

  return decision(
    "PASSED",
    null,
    true,
    "PASSED_BASIC_SCREENING",
    tenderValueUnavailable
      ? "Passed BidAssist pre-screening; tender value unavailable — continue to ChatGPT"
      : "Passed BidAssist deterministic pre-screening",
    baseFacts(input, config, {
      closingDate: closingIso || "",
      closingDateUnavailable: closing.closingDateUnavailable,
      daysUntilClosing: closing.daysUntilClosing,
      tenderValue: tenderValueUnavailable ? null : tenderValue,
      tenderValueText: input.tenderValueText || "",
      tenderValueUnavailable,
      emdAmount: input.emdAmount ?? null,
      emdText: input.emdText || "",
      emdRuleApplied: false,
      itRelevanceRuleApplied: false,
      itRelevance: null,
      categoryGateAssumed: "Software and IT Solutions",
    }),
    config.rulesVersion,
  );
}

export function evaluatePrescreen(
  input: PrescreenInput,
  config: PrescreenConfig = loadPrescreenConfig(),
  options?: { now?: Date; itTracker?: ItRelevanceClassifierCallTracker },
): PrescreenDecision {
  const tracker = options?.itTracker ?? { called: false };
  const todayIso = getTodayIsoInTimezone(
    config.timezone,
    options?.now ?? new Date(),
  );

  if (!config.enabled) {
    return decision(
      "PASSED",
      null,
      true,
      "PRESCREEN_DISABLED",
      "Pre-screening disabled; ChatGPT eligibility granted",
      baseFacts(input, config, {
        closingDate: parsePortalDate(input.closingDate) || "",
        closingDateUnavailable: !parsePortalDate(input.closingDate),
        tenderValueUnavailable: input.tenderValue == null,
        emdRuleApplied: input.sourcePortal === "TENDER247",
        itRelevanceRuleApplied: false,
        itRelevance: null,
        categoryGateAssumed:
          input.sourcePortal === "BIDASSIST"
            ? "Software and IT Solutions"
            : undefined,
      }),
      config.rulesVersion,
    );
  }

  try {
    if (input.sourcePortal === "TENDER247") {
      const result = evaluateTender247(input, config, todayIso, tracker);
      assertBidassistDidNotRunItClassifier("TENDER247", {
        called: false,
      });
      return result;
    }

    const result = evaluateBidassist(input, config, todayIso, tracker);
    assertBidassistDidNotRunItClassifier("BIDASSIST", tracker);
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "BIDASSIST_IT_RELEVANCE_CLASSIFIER_MUST_NOT_RUN"
    ) {
      throw error;
    }
    return decision(
      "ERROR",
      "VERIFY",
      false,
      "PRESCREEN_ERROR",
      error instanceof Error ? error.message : "Unknown pre-screen error",
      baseFacts(input, config, {
        emdRuleApplied: input.sourcePortal === "TENDER247",
        itRelevanceRuleApplied: false,
        missingFields: ["evaluationError"],
      }),
      config.rulesVersion,
    );
  }
}
