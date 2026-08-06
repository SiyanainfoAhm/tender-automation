import type { Page } from "playwright";
import type { Logger } from "../logger.js";
import { dismissPageOverlays } from "./collectTenderLinks.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import type { AiSummaryFields, TenderExtractedFields } from "./types.js";

const FIELD_LABELS: Array<{ key: keyof TenderExtractedFields; patterns: RegExp[] }> = [
  {
    key: "t247Id",
    patterns: [/^T247\s*ID$/i, /^Tender247\s*ID$/i],
  },
  {
    key: "referenceNumber",
    patterns: [
      /^Tender\s*(No|Number|ID)$/i,
      /^Reference\s*(No|Number)?$/i,
      /^Application\s*(No|Number)?$/i,
      /^GEM\/?Eprocure\s*ID$/i,
      /^Bid\s*Number$/i,
    ],
  },
  {
    key: "tenderName",
    patterns: [/^Tender\s*Name$/i, /^Title$/i, /^Work\s*Name$/i],
  },
  {
    key: "brief",
    patterns: [/^Brief$/i, /^Tender\s*Brief$/i, /^Summary$/i],
  },
  {
    key: "description",
    patterns: [/^Description$/i, /^Scope$/i, /^Work\s*Description$/i],
  },
  {
    key: "organisation",
    patterns: [/^Organi[sz]ation$/i, /^Authority$/i, /^Purchaser$/i, /^Buyer$/i],
  },
  {
    key: "department",
    patterns: [/^Department$/i, /^Ministry$/i],
  },
  {
    key: "location",
    patterns: [/^Location$/i, /^State$/i, /^City$/i, /^Place$/i],
  },
  {
    key: "submissionDate",
    patterns: [
      /^Submission\s*Date$/i,
      /^Closing\s*Date$/i,
      /^Last\s*Date$/i,
      /^Bid\s*End\s*Date$/i,
      /^Deadline$/i,
    ],
  },
  {
    key: "openingDate",
    patterns: [/^Opening\s*Date$/i, /^Bid\s*Opening/i],
  },
  {
    key: "estimatedCost",
    patterns: [
      /^Estimated\s*(Cost|Value|Bid\s*Value)$/i,
      /^Tender\s*(Amount|Value|Cost)$/i,
      /^Value$/i,
    ],
  },
  {
    key: "emd",
    patterns: [/^EMD$/i, /^Earnest\s*Money/i, /^Bid\s*Security$/i],
  },
  {
    key: "documentFees",
    patterns: [/^Document\s*Fee(s)?$/i, /^Tender\s*Fee(s)?$/i],
  },
  {
    key: "category",
    patterns: [/^Category$/i, /^Similar\s*Category$/i],
  },
  {
    key: "completionPeriod",
    patterns: [/^Completion\s*Period$/i, /^Contract\s*Period$/i, /^Period$/i],
  },
  {
    key: "advisoryBank",
    patterns: [/^Advisory\s*Bank$/i],
  },
  {
    key: "emdInstrumentType",
    patterns: [/^EMD\s*Instrument/i, /^Instrument\s*Type$/i],
  },
  {
    key: "preBidMeeting",
    patterns: [/^Pre[-\s]?Bid/i],
  },
  {
    key: "clarificationDate",
    patterns: [/^Clarification/i],
  },
];

const AI_LABELS: Array<{ key: keyof AiSummaryFields; patterns: RegExp[] }> = [
  {
    key: "documentRequiredFromSeller",
    patterns: [/Document\s*required\s*from\s*seller/i],
  },
  {
    key: "eligibilityCriteria",
    patterns: [/Eligibility\s*Criteria/i],
  },
  {
    key: "minimumTurnover",
    patterns: [/Minimum.*Turnover/i, /Average\s*Annual\s*Turnover/i],
  },
  {
    key: "pastExperience",
    patterns: [/Past\s*Experience/i, /Years\s*of\s*Past\s*Experience/i],
  },
  {
    key: "similarCategory",
    patterns: [/Similar\s*Category/i],
  },
  {
    key: "contractPeriod",
    patterns: [/Contract\s*Period/i],
  },
];

/**
 * Label-based extraction from the tender detail page.
 * Missing values are null — never guessed.
 * Selectors for AI summary blocks still need live verification.
 */
export async function extractTenderMetadata(
  page: Page,
  logger: Logger,
  t247Id: string,
): Promise<{ extracted: TenderExtractedFields; aiSummary: AiSummaryFields; warnings: string[] }> {
  await dismissTender247BlockingOverlays(page, logger);
  await dismissPageOverlays(page, logger);

  const pairs = await collectLabelValuePairs(page);
  logger.info(`Metadata extracted candidate pairs: ${pairs.length}`);

  const extracted = emptyExtracted(t247Id, page.url());
  const warnings: string[] = [];
  const usedLabels = new Set<string>();

  for (const { label, value } of pairs) {
    const mapped = mapKnownField(label, value, extracted);
    if (mapped) {
      usedLabels.add(label.toLowerCase());
    }
  }

  // Title / heading fallback for tender name when label missing
  if (!extracted.tenderName) {
    const heading = page.locator("h1, h2").first();
    if (await heading.isVisible().catch(() => false)) {
      const text = (await heading.innerText().catch(() => "")).trim();
      if (text && !/^tender247$/i.test(text)) {
        extracted.tenderName = text;
      }
    }
  }

  if (!extracted.t247Id) {
    extracted.t247Id = t247Id;
  }

  const aiSummary = await extractAiSummaryFields(page, pairs, logger);

  for (const { label, value } of pairs) {
    if (usedLabels.has(label.toLowerCase())) {
      continue;
    }
    if (isAiLabel(label)) {
      continue;
    }
    if (value && !extracted.extraFields[label]) {
      extracted.extraFields[label] = value;
    }
  }

  if (!extracted.tenderName && !extracted.brief) {
    warnings.push("Tender name/brief not found via labels or headings");
  }

  return { extracted, aiSummary, warnings };
}

function emptyExtracted(t247Id: string, detailUrl: string): TenderExtractedFields {
  return {
    t247Id,
    referenceNumber: null,
    tenderName: null,
    brief: null,
    description: null,
    organisation: null,
    department: null,
    location: null,
    submissionDate: null,
    openingDate: null,
    estimatedCost: null,
    emd: null,
    documentFees: null,
    category: null,
    completionPeriod: null,
    advisoryBank: null,
    emdInstrumentType: null,
    preBidMeeting: null,
    clarificationDate: null,
    detailUrl,
    extraFields: {},
  };
}

function mapKnownField(
  label: string,
  value: string,
  target: TenderExtractedFields,
): boolean {
  for (const field of FIELD_LABELS) {
    if (field.key === "extraFields") {
      continue;
    }
    if (field.patterns.some((re) => re.test(label.trim()))) {
      const key = field.key;
      if (target[key] === null || target[key] === "") {
        target[key] = value || null;
      }
      return true;
    }
  }
  return false;
}

function isAiLabel(label: string): boolean {
  return AI_LABELS.some((f) => f.patterns.some((re) => re.test(label)));
}

async function extractAiSummaryFields(
  page: Page,
  pairs: Array<{ label: string; value: string }>,
  logger: Logger,
): Promise<AiSummaryFields> {
  const ai: AiSummaryFields = {
    documentRequiredFromSeller: null,
    eligibilityCriteria: null,
    minimumTurnover: null,
    pastExperience: null,
    similarCategory: null,
    contractPeriod: null,
    extraFields: {},
    available: false,
  };

  const section = page
    .getByText(/AI\s*(Generated\s*)?Tender\s*Summary/i)
    .or(page.getByText(/AI\s*Summary/i))
    .first();
  const sectionVisible = await section.isVisible().catch(() => false);
  ai.available = sectionVisible;

  for (const { label, value } of pairs) {
    let matched = false;
    for (const field of AI_LABELS) {
      if (field.key === "extraFields" || field.key === "available") {
        continue;
      }
      if (field.patterns.some((re) => re.test(label))) {
        if (ai[field.key] === null) {
          ai[field.key] = value || null;
        }
        matched = true;
        ai.available = true;
      }
    }
    if (!matched && /turnover|experience|eligibility|seller|contract|category/i.test(label)) {
      ai.extraFields[label] = value;
      ai.available = true;
    }
  }

  if (ai.available) {
    logger.info("AI summary fields detected on detail page");
  }

  return ai;
}

/**
 * Collect label/value pairs from common detail-page structures.
 * NEEDS LIVE VERIFICATION against real Tender247 detail DOM.
 */
async function collectLabelValuePairs(
  page: Page,
): Promise<Array<{ label: string; value: string }>> {
  return page.evaluate(() => {
    const pairs: Array<{ label: string; value: string }> = [];

    // Definition lists
    for (const dl of Array.from(document.querySelectorAll("dl"))) {
      const dts = Array.from(dl.querySelectorAll("dt"));
      for (const dt of dts) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName.toLowerCase() === "dd") {
          const l = (dt.textContent ?? "")
            .replace(/\s+/g, " ")
            .replace(/[:：]\s*$/, "")
            .trim();
          const v = (dd.textContent ?? "").replace(/\s+/g, " ").trim();
          if (l && l.length <= 120) {
            if (!v || v === "-" || v.toLowerCase() === "n/a") {
              pairs.push({ label: l, value: "" });
            } else {
              pairs.push({ label: l, value: v });
            }
          }
        }
      }
    }

    // Table rows with 2+ cells
    for (const row of Array.from(document.querySelectorAll("tr"))) {
      const cells = Array.from(row.querySelectorAll("th,td"));
      if (cells.length >= 2) {
        const l = (cells[0]?.textContent ?? "")
          .replace(/\s+/g, " ")
          .replace(/[:：]\s*$/, "")
          .trim();
        const v = (cells[1]?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (l && l.length <= 120) {
          if (!v || v === "-" || v.toLowerCase() === "n/a") {
            pairs.push({ label: l, value: "" });
          } else {
            pairs.push({ label: l, value: v });
          }
        }
      }
    }

    // Label / adjacent sibling patterns
    for (const labelEl of Array.from(
      document.querySelectorAll("label, .label, [class*='label' i], strong, b, span"),
    )) {
      const text = (labelEl.textContent ?? "").trim();
      if (!text || text.length > 80 || !/[:：]|ID|Date|Fee|EMD|Cost|Location|Organisation|Organization/i.test(text)) {
        continue;
      }
      const parent = labelEl.parentElement;
      if (!parent) {
        continue;
      }
      let valueText = "";
      if (labelEl.nextElementSibling) {
        valueText = labelEl.nextElementSibling.textContent ?? "";
      } else {
        const cloned = parent.cloneNode(true) as HTMLElement;
        const first = cloned.querySelector("label, .label, strong, b");
        first?.remove();
        valueText = cloned.textContent ?? "";
      }
      const labelOnly = text.replace(/[:：]\s*$/, "");
      const l = labelOnly.replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim();
      const v = valueText.replace(text, "").replace(/\s+/g, " ").trim();
      if (l && l.length <= 120) {
        if (!v || v === "-" || v.toLowerCase() === "n/a") {
          pairs.push({ label: l, value: "" });
        } else {
          pairs.push({ label: l, value: v });
        }
      }
    }

    return pairs;
  });
}
