import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTender247ItRelevance,
  evaluateTender247ItRelevance,
  tender247StagesAllowedAfterItRelevance,
  type ItRelevanceClassifierCallTracker,
} from "../tender247ItRelevanceClassifier.js";
import { evaluateTender247ItRelevanceFromMetadata } from "../../tender247Batch/tender247ItRelevanceGate.js";
import type { CompleteTenderMetadata } from "../../tender247Batch/extractCompleteMetadata.js";

function meta(partial: {
  title?: string;
  category?: string;
  description?: string;
  overview?: Record<string, string>;
  aiSummary?: Record<string, string>;
}): CompleteTenderMetadata {
  return {
    source: "tender247",
    t247Id: "1",
    detailUrl: "https://example.test",
    normalized: {
      tenderName: partial.title ?? null,
      category: partial.category ?? null,
      description: partial.description ?? null,
    },
    tenderOverview: partial.overview ?? {},
    aiSummary: partial.aiSummary ?? {},
    downloads: {
      aiSummaryDownloaded: false,
      allDocumentsDownloaded: false,
      aiSummaryFile: null,
      allDocumentsFile: null,
    },
    processedAt: new Date().toISOString(),
  };
}

test("website development → IT_RELEVANT", () => {
  const r = evaluateTender247ItRelevance("Website development for municipal portal");
  assert.equal(r.relevance, "IT_RELEVANT");
});

test("web portal → IT_RELEVANT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Development of citizen web portal").relevance,
    "IT_RELEVANT",
  );
});

test("mobile application → IT_RELEVANT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Mobile application for citizen services").relevance,
    "IT_RELEVANT",
  );
});

test("HRMS → IT_RELEVANT", () => {
  assert.equal(evaluateTender247ItRelevance("Implementation of HRMS").relevance, "IT_RELEVANT");
});

test("CRM → IT_RELEVANT", () => {
  assert.equal(evaluateTender247ItRelevance("CRM system rollout").relevance, "IT_RELEVANT");
});

test("CMS → IT_RELEVANT", () => {
  assert.equal(evaluateTender247ItRelevance("CMS for department website").relevance, "IT_RELEVANT");
});

test("ERP → IT_RELEVANT", () => {
  assert.equal(evaluateTender247ItRelevance("ERP implementation project").relevance, "IT_RELEVANT");
});

test("GIS application → IT_RELEVANT", () => {
  assert.equal(
    evaluateTender247ItRelevance("GIS application for land records").relevance,
    "IT_RELEVANT",
  );
});

test("software AMC → IT_RELEVANT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Annual software AMC and support").relevance,
    "IT_RELEVANT",
  );
});

test("hiring agency for IT project on milestone basis → IT_RELEVANT", () => {
  const r = evaluateTender247ItRelevance(
    "Hiring of agency for IT projects – milestone basis",
  );
  assert.equal(r.relevance, "IT_RELEVANT");
});

test("civil construction → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Civil construction of office building").relevance,
    "NON_IT",
  );
});

test("furniture → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Supply of office furniture").relevance,
    "NON_IT",
  );
});

test("printing → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Printing of examination answer sheets").relevance,
    "NON_IT",
  );
});

test("scanning/digitization → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Scanning and digitization of legacy records").relevance,
    "NON_IT",
  );
});

test("internet bandwidth → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Internet bandwidth and leased line connectivity").relevance,
    "NON_IT",
  );
});

test("EOI → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("EOI for empanelment of vendors").relevance,
    "NON_IT",
  );
});

test("empanelment → NON_IT", () => {
  assert.equal(
    evaluateTender247ItRelevance("Empanelment of agencies for general services").relevance,
    "NON_IT",
  );
});

test("vague Digital Services with insufficient context → AMBIGUOUS", () => {
  const r = evaluateTender247ItRelevance("Digital Services");
  assert.equal(r.relevance, "AMBIGUOUS");
  assert.equal(r.reasonCode, "INSUFFICIENT_SCOPE_EVIDENCE");
});

test("mixed unclear scope → AMBIGUOUS rather than NON_IT", () => {
  const r = evaluateTender247ItRelevance(
    "Miscellaneous works and digital initiatives for the campus",
  );
  assert.equal(r.relevance, "AMBIGUOUS");
  assert.notEqual(r.relevance, "NON_IT");
});

test("multi-field metadata classification uses detail fields", () => {
  const r = evaluateTender247ItRelevanceFromMetadata(
    meta({
      title: "Agency engagement",
      category: "Services",
      description: "Development of a web portal and mobile application",
    }),
  );
  assert.equal(r.relevance, "IT_RELEVANT");
  assert.ok(r.evidenceFields.includes("description"));
});

test("legacy classifyTender247ItRelevance maps IT_RELEVANT → RELEVANT", () => {
  assert.equal(
    classifyTender247ItRelevance("software development portal"),
    "RELEVANT",
  );
});

test("pipeline stages: NON_IT never docs/supabase/chatgpt", () => {
  const stages = tender247StagesAllowedAfterItRelevance("NON_IT");
  assert.equal(stages.downloadDocuments, false);
  assert.equal(stages.supabasePersist, false);
  assert.equal(stages.detailedPrescreen, false);
  assert.equal(stages.chatgptAutomatic, false);
});

test("pipeline stages: AMBIGUOUS never automatic ChatGPT or docs", () => {
  const stages = tender247StagesAllowedAfterItRelevance("AMBIGUOUS");
  assert.equal(stages.downloadDocuments, false);
  assert.equal(stages.supabasePersist, false);
  assert.equal(stages.chatgptAutomatic, false);
});

test("pipeline stages: IT_RELEVANT continues to documents and Supabase", () => {
  const stages = tender247StagesAllowedAfterItRelevance("IT_RELEVANT");
  assert.equal(stages.downloadDocuments, true);
  assert.equal(stages.supabasePersist, true);
  assert.equal(stages.detailedPrescreen, true);
  // ChatGPT still gated by detailed prescreen PASSED later
  assert.equal(stages.chatgptAutomatic, false);
});

test("simulated pipeline: NON_IT never calls downloader/supabase/chatgpt", () => {
  const calls = { download: 0, supabase: 0, chatgpt: 0 };
  const decision = evaluateTender247ItRelevance("Civil construction of road works");
  const stages = tender247StagesAllowedAfterItRelevance(decision.relevance);
  if (stages.downloadDocuments) calls.download += 1;
  if (stages.supabasePersist) calls.supabase += 1;
  if (stages.chatgptAutomatic) calls.chatgpt += 1;
  // detailed prescreen PASSED would be required for ChatGPT even for IT
  const detailedPrescreenPassed = false;
  const chatgptEligible = false;
  if (
    decision.relevance === "IT_RELEVANT" &&
    detailedPrescreenPassed &&
    chatgptEligible
  ) {
    calls.chatgpt += 1;
  }
  assert.equal(decision.relevance, "NON_IT");
  assert.deepEqual(calls, { download: 0, supabase: 0, chatgpt: 0 });
});

test("simulated pipeline: IT_RELEVANT can reach supabase; only PASSED reaches ChatGPT", () => {
  const decision = evaluateTender247ItRelevance("Custom software development");
  assert.equal(decision.relevance, "IT_RELEVANT");
  const stages = tender247StagesAllowedAfterItRelevance(decision.relevance);
  assert.equal(stages.supabasePersist, true);
  assert.equal(stages.downloadDocuments, true);

  const excelFinancialGatePassed = true;
  const itRelevance = decision.relevance;
  let chatgpt = 0;
  for (const [prescreenStatus, chatgptEligible] of [
    ["PASSED", true],
    ["PASSED", false],
    ["REJECTED", true],
    ["MANUAL_REVIEW", true],
  ] as const) {
    const reach =
      excelFinancialGatePassed &&
      itRelevance === "IT_RELEVANT" &&
      prescreenStatus === "PASSED" &&
      chatgptEligible === true;
    if (reach) chatgpt += 1;
  }
  assert.equal(chatgpt, 1);
});

test("BidAssist tracker must not be marked by BidAssist callers", () => {
  const tracker: ItRelevanceClassifierCallTracker = { called: false };
  // Tender247 path may set tracker
  evaluateTender247ItRelevance("ERP", { tracker });
  assert.equal(tracker.called, true);
  assert.equal(tracker.sourcePortal, "TENDER247");
});
