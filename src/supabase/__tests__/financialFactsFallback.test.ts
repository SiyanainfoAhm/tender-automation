import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinancialFactsEnrichment,
  readFinancialFacts,
} from "../financialFactsFallback.js";

test("financialFacts enrichment is null-only and high-confidence", () => {
  const facts = readFinancialFacts({
    financialFacts: {
      tenderValue: {
        amountInr: 2_500_000,
        sourceText: "₹25 Lac",
        evidenceFile: "ba-Tender_Detail.html",
        confidence: "high",
      },
      emd: {
        amountInr: 500_000,
        sourceText: "₹5 Lac",
        evidenceFile: "ba-Tender_Detail.html",
        confidence: "medium",
      },
    },
  });

  const patch = buildFinancialFactsEnrichment({
    existingTenderValue: null,
    existingEmdAmount: null,
    financialFacts: facts,
  });

  assert.equal(patch.tender_value, 2_500_000);
  assert.equal(patch.tender_value_text, "₹25 Lac");
  assert.equal(patch.emd_amount, undefined);

  const noOverwrite = buildFinancialFactsEnrichment({
    existingTenderValue: 1_000_000,
    existingEmdAmount: null,
    financialFacts: facts,
  });
  assert.equal(noOverwrite.tender_value, undefined);
});

test("financialFacts ignores free-text-only payloads", () => {
  const facts = readFinancialFacts({
    reason: "EMD is ₹6 lac something",
    financialFacts: {
      tenderValue: {
        amountInr: 100,
        sourceText: "guess",
        confidence: "high",
      },
    },
  });
  const patch = buildFinancialFactsEnrichment({
    existingTenderValue: null,
    existingEmdAmount: null,
    financialFacts: facts,
  });
  assert.deepEqual(patch, {});
});
