import assert from "node:assert/strict";
import test from "node:test";
import type { PrescreenConfig } from "../prescreenConfig.js";
import {
  calendarDaysBetween,
  evaluatePrescreen,
  getTodayIsoInTimezone,
} from "../prescreenRuleEngine.js";
import { shouldSkipChatgptForPrescreenDecision } from "../chatgptGate.js";
import {
  assertBidassistDidNotRunItClassifier,
  classifyTender247ItRelevance,
  type ItRelevanceClassifierCallTracker,
} from "../tender247ItRelevanceClassifier.js";
import type { PrescreenInput } from "../prescreenTypes.js";

const config: PrescreenConfig = {
  enabled: true,
  tenderValueMaxInr: 50_000_000,
  tender247EmdMaxInr: 1_500_000,
  minLeadDays: 1,
  tender247RequireItRelevance: true,
  bidassistRequireItRelevance: false,
  rulesVersion: "2026-08-06-v2",
  timezone: "Asia/Kolkata",
};

/** Fixed "today" = 2026-08-06 in IST for deterministic date tests. */
const NOW = new Date("2026-08-06T06:30:00.000Z");

function t247(overrides: Partial<PrescreenInput> = {}): PrescreenInput {
  return {
    sourcePortal: "TENDER247",
    sourceTenderId: "101279958",
    title: "Software development and portal maintenance",
    category: "IT",
    description: "ERP and dashboard implementation",
    closingDate: "2026-08-20",
    tenderValue: 10_000_000,
    tenderValueText: "1 crore",
    emdAmount: 100_000,
    emdText: "1 lakh",
    documentArchiveAvailable: true,
    hasNormalizedMetadata: true,
    ...overrides,
  };
}

function ba(overrides: Partial<PrescreenInput> = {}): PrescreenInput {
  return {
    sourcePortal: "BIDASSIST",
    sourceTenderId: "GEM-2026-B-7876981",
    title: "Software and IT Solutions tender",
    category: "software-and-it-solutions-category",
    description: "Application development",
    closingDate: "2026-08-20",
    tenderValue: 10_000_000,
    tenderValueText: "1 crore",
    emdAmount: 2_000_000,
    emdText: "20 lakh",
    documentArchiveAvailable: true,
    hasNormalizedMetadata: true,
    ...overrides,
  };
}

function evalAt(input: PrescreenInput, tracker?: ItRelevanceClassifierCallTracker) {
  return evaluatePrescreen(input, config, { now: NOW, itTracker: tracker });
}

test("calendar day helpers", () => {
  assert.equal(getTodayIsoInTimezone("Asia/Kolkata", NOW), "2026-08-06");
  assert.equal(calendarDaysBetween("2026-08-06", "2026-08-07"), 1);
  assert.equal(calendarDaysBetween("2026-08-06", "2026-08-06"), 0);
  assert.equal(calendarDaysBetween("2026-08-06", "2026-08-05"), -1);
});

test("1. Tender247 closing yesterday → REJECTED", () => {
  const d = evalAt(t247({ closingDate: "2026-08-05" }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "CLOSING_DATE_EXPIRED");
  assert.equal(d.chatgptEligible, false);
  assert.equal(d.effectiveStatus, "NO_GO");
});

test("2. Tender247 closing today → REJECTED", () => {
  const d = evalAt(t247({ closingDate: "2026-08-06" }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "CLOSING_DATE_TODAY");
});

test("3. Tender247 EMD above ₹15 lakh → REJECTED", () => {
  const d = evalAt(t247({ emdAmount: 1_500_001 }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "EMD_ABOVE_LIMIT");
});

test("4. Tender247 EMD exactly ₹15 lakh → passes EMD rule", () => {
  const d = evalAt(t247({ emdAmount: 1_500_000 }));
  assert.notEqual(d.reasonCode, "EMD_ABOVE_LIMIT");
  assert.equal(d.status, "PASSED");
});

test("5. Tender247 value above ₹5 crore → REJECTED", () => {
  const d = evalAt(t247({ tenderValue: 50_000_001 }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "TENDER_VALUE_ABOVE_LIMIT");
});

test("6. Tender247 missing EMD → MANUAL_REVIEW", () => {
  const d = evalAt(t247({ emdAmount: null }));
  assert.equal(d.status, "MANUAL_REVIEW");
  assert.equal(d.reasonCode, "MISSING_REQUIRED_SUMMARY");
  assert.equal(d.effectiveStatus, "VERIFY");
});

test("7. Tender247 missing tender value → MANUAL_REVIEW", () => {
  const d = evalAt(t247({ tenderValue: null }));
  assert.equal(d.status, "MANUAL_REVIEW");
  assert.equal(d.reasonCode, "MISSING_REQUIRED_SUMMARY");
});

test("8. Tender247 clear non-IT scope → REJECTED", () => {
  const d = evalAt(
    t247({
      title: "Civil construction of roads and building work",
      description: "Housekeeping and catering services",
      category: "Civil",
    }),
  );
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "NON_IT_SCOPE");
});

test("9. Tender247 ambiguous scope → MANUAL_REVIEW", () => {
  const d = evalAt(
    t247({
      title: "General departmental work order",
      description: "Miscellaneous requirements",
      category: "General",
    }),
  );
  assert.equal(d.status, "MANUAL_REVIEW");
  assert.equal(d.reasonCode, "AMBIGUOUS_SCOPE");
});

test("10. Tender247 valid IT tender → PASSED", () => {
  const d = evalAt(t247());
  assert.equal(d.status, "PASSED");
  assert.equal(d.chatgptEligible, true);
  assert.equal(d.reasonCode, "PASSED_BASIC_SCREENING");
  assert.equal(d.effectiveStatus, null);
  assert.equal(d.facts.emdRuleApplied, true);
  assert.equal(d.facts.itRelevanceRuleApplied, true);
});

test("11. BidAssist IT relevance classifier is never called", () => {
  const tracker: ItRelevanceClassifierCallTracker = { called: false };
  evalAt(ba(), tracker);
  assert.equal(tracker.called, false);
  assert.throws(
    () => {
      tracker.called = true;
      assertBidassistDidNotRunItClassifier("BIDASSIST", tracker);
    },
    /BIDASSIST_IT_RELEVANCE_CLASSIFIER_MUST_NOT_RUN/,
  );
});

test("12. BidAssist configured category is treated as already filtered", () => {
  const d = evalAt(ba({ title: "Anything non-IT sounding civil roads" }));
  assert.equal(d.status, "PASSED");
  assert.equal(d.facts.categoryGateAssumed, "Software and IT Solutions");
  assert.equal(d.facts.itRelevance, null);
});

test("13. BidAssist value above ₹5 crore → REJECTED", () => {
  const d = evalAt(ba({ tenderValue: 50_000_001, tenderValueText: "5.1 crore" }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "TENDER_VALUE_ABOVE_LIMIT");
});

test("14. BidAssist value exactly ₹5 crore → passes value rule", () => {
  const d = evalAt(ba({ tenderValue: 50_000_000, tenderValueText: "5 crore" }));
  assert.equal(d.status, "PASSED");
});

test("15. BidAssist Refer Documents → ChatGPT eligible", () => {
  const d = evalAt(
    ba({ tenderValue: null, tenderValueText: "Refer Documents" }),
  );
  assert.equal(d.chatgptEligible, true);
  assert.equal(d.status, "PASSED");
  assert.equal(d.facts.tenderValueUnavailable, true);
});

test("16. BidAssist null value → ChatGPT eligible", () => {
  const d = evalAt(ba({ tenderValue: null, tenderValueText: null }));
  assert.equal(d.chatgptEligible, true);
  assert.equal(d.status, "PASSED");
});

test("17. BidAssist EMD above ₹15 lakh → ignored", () => {
  const d = evalAt(ba({ emdAmount: 5_000_000 }));
  assert.equal(d.status, "PASSED");
  assert.equal(d.chatgptEligible, true);
  assert.notEqual(d.reasonCode, "EMD_ABOVE_LIMIT");
});

test("18. BidAssist missing closing date with valid ZIP → ChatGPT eligible", () => {
  const d = evalAt(ba({ closingDate: null, documentArchiveAvailable: true }));
  assert.equal(d.status, "PASSED");
  assert.equal(d.chatgptEligible, true);
  assert.equal(d.facts.closingDateUnavailable, true);
});

test("19. BidAssist expired closing date → REJECTED", () => {
  const d = evalAt(ba({ closingDate: "2026-08-01" }));
  assert.equal(d.status, "REJECTED");
  assert.equal(d.reasonCode, "CLOSING_DATE_EXPIRED");
});

test("20. BidAssist missing original ZIP → MANUAL_REVIEW", () => {
  const d = evalAt(ba({ documentArchiveAvailable: false }));
  assert.equal(d.status, "MANUAL_REVIEW");
  assert.equal(d.reasonCode, "MISSING_REQUIRED_SUMMARY");
});

test("21. BidAssist facts contain emdRuleApplied=false", () => {
  const d = evalAt(ba());
  assert.equal(d.facts.emdRuleApplied, false);
});

test("22. BidAssist facts contain itRelevanceRuleApplied=false", () => {
  const d = evalAt(ba());
  assert.equal(d.facts.itRelevanceRuleApplied, false);
});

test("23. Rejected tender never opens ChatGPT (gate)", () => {
  assert.equal(
    shouldSkipChatgptForPrescreenDecision({
      enabled: true,
      status: "REJECTED",
      chatgptEligible: false,
    }),
    true,
  );
});

test("24. Manual-review tender never uploads attachments (gate)", () => {
  assert.equal(
    shouldSkipChatgptForPrescreenDecision({
      enabled: true,
      status: "MANUAL_REVIEW",
      chatgptEligible: false,
    }),
    true,
  );
});

test("25. Passed tender follows existing ChatGPT flow (gate)", () => {
  assert.equal(
    shouldSkipChatgptForPrescreenDecision({
      enabled: true,
      status: "PASSED",
      chatgptEligible: true,
    }),
    false,
  );
});

test("26. Prescreen result shape is storeable (facts + status)", () => {
  const d = evalAt(t247());
  assert.ok(d.facts.thresholds.tenderValueMaxInr === 50_000_000);
  assert.ok(typeof d.reason === "string");
  assert.ok(d.rulesVersion);
});

test("27. Existing ChatGPT result remains authoritative over PASSED", () => {
  const d = evalAt(t247());
  assert.equal(d.effectiveStatus, null);
  assert.equal(d.status, "PASSED");
});

test("28. BidAssist missing value does not block ChatGPT", () => {
  const d = evalAt(ba({ tenderValue: null, tenderValueText: "Not Disclosed" }));
  assert.equal(d.chatgptEligible, true);
});

test("29. BidAssist EMD cannot reject a tender", () => {
  const d = evalAt(ba({ emdAmount: 99_000_000 }));
  assert.notEqual(d.reasonCode, "EMD_ABOVE_LIMIT");
  assert.equal(d.chatgptEligible, true);
});

test("30. BidAssist category is not reclassified", () => {
  const tracker: ItRelevanceClassifierCallTracker = { called: false };
  const d = evalAt(ba({ title: "Random title without IT keywords" }), tracker);
  assert.equal(tracker.called, false);
  assert.equal(d.facts.itRelevance, null);
  // Classifier exists for Tender247 only
  assert.equal(
    classifyTender247ItRelevance("software development portal"),
    "RELEVANT",
  );
});

test("closing tomorrow passes with minLeadDays=1", () => {
  const d = evalAt(t247({ closingDate: "2026-08-07" }));
  assert.equal(d.status, "PASSED");
});

test("Tender247 value exactly ₹5 crore passes", () => {
  const d = evalAt(t247({ tenderValue: 50_000_000 }));
  assert.equal(d.status, "PASSED");
});
