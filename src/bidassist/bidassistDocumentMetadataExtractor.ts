/**
 * Extract BidAssist tender financial/detail fields from ZIP-extracted HTML/PDF.
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";
import {
  isMeaninglessCurrencyText,
  parseIndianCurrencyAmount,
} from "./parseIndianCurrencyAmount.js";
import { parseBidAssistDate } from "./parseBidAssistDate.js";

export type BidAssistExtractionSource = {
  fileName: string;
  fileType: "HTML" | "PDF" | "LISTING_CARD";
  extractedFields: string[];
};

export type BidAssistExtractedMetadata = {
  tenderId: string | null;
  title: string | null;
  organization: string | null;
  department: string | null;
  authority: string | null;
  description: string | null;

  category: string | null;
  city: string | null;
  state: string | null;
  locationText: string | null;

  publishedDate: string | null;
  openingDate: string | null;
  closingDate: string | null;
  bidSubmissionDate: string | null;

  tenderValue: number | null;
  tenderValueText: string | null;

  emdAmount: number | null;
  emdText: string | null;

  sourceTenderPortal: string | null;
  sourceUrl: string | null;

  extractionSources: BidAssistExtractionSource[];
  rawExtractedFields: Record<string, unknown>;
  warnings: string[];
};

type FieldKey = keyof Omit<
  BidAssistExtractedMetadata,
  "extractionSources" | "rawExtractedFields" | "warnings"
>;

type Candidate = {
  field: FieldKey;
  value: unknown;
  sourceFile: string;
  sourceType: "HTML" | "PDF" | "LISTING_CARD";
  priority: 1 | 2 | 3;
};

const TENDER_VALUE_LABELS = [
  "tender value",
  "estimated tender value",
  "estimated cost",
  "tender amount",
  "contract value",
  "estimated value",
  "total value",
  "tender estimated cost",
];

const EMD_LABELS = [
  "emd",
  "earnest money deposit",
  "emd amount",
  "bid security",
  "bid security/emd",
  "bid security/emd/proposal security",
  "proposal security",
];

const EMD_EXCLUDE_LABELS = [
  "performance security",
  "performance bank guarantee",
  "performance guarantee",
  "contract security",
  "processing fee",
  "tender fee",
  "bidding processing fee",
  "epbg",
  "e-pbg",
];

const DATE_FIELD_LABELS: Array<{ field: FieldKey; labels: string[] }> = [
  {
    field: "publishedDate",
    labels: ["published date", "publication date", "dated"],
  },
  {
    field: "openingDate",
    labels: [
      "opening date",
      "bid opening date",
      "bid opening date/time",
      "start date",
    ],
  },
  {
    field: "closingDate",
    labels: [
      "closing date",
      "end date",
      "bid end date",
      "bid end date/time",
      "submission end date",
      "bid submission closing date",
    ],
  },
  {
    field: "bidSubmissionDate",
    labels: [
      "bid submission date",
      "submission end date",
      "bid submission closing date",
      "bid end date",
      "bid end date/time",
      "end date",
    ],
  },
];

const TEXT_FIELD_LABELS: Array<{ field: FieldKey; labels: string[] }> = [
  {
    field: "tenderId",
    labels: [
      "tender id",
      "tender reference number",
      "bid number",
      "bid no",
      "bid no.",
      "gem bid number",
      "bid number:",
    ],
  },
  {
    field: "title",
    labels: ["tender name", "title", "items", "item category", "item details"],
  },
  {
    field: "organization",
    labels: [
      "organisation",
      "organization",
      "organisation name",
      "organization name",
      "procuring entity",
      "buyer",
    ],
  },
  {
    field: "department",
    labels: [
      "department",
      "department name",
      "department name and address",
    ],
  },
  {
    field: "authority",
    labels: [
      "authority",
      "ministry",
      "ministry/state name",
      "bid opening authority",
    ],
  },
  {
    field: "description",
    labels: [
      "description",
      "work description",
      "tender description",
      "scope of work",
      "item details",
    ],
  },
  {
    field: "category",
    labels: ["category", "item category", "items"],
  },
  {
    field: "city",
    labels: ["city"],
  },
  {
    field: "state",
    labels: ["state"],
  },
  {
    field: "locationText",
    labels: ["location", "site location", "office name"],
  },
];

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[:：]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labelMatches(label: string, candidates: string[]): boolean {
  const n = normalizeLabel(label);
  return candidates.some((c) => {
    const cn = normalizeLabel(c);
    return n === cn || n.startsWith(cn) || n.includes(cn);
  });
}

function isExcludedEmdLabel(label: string): boolean {
  const n = normalizeLabel(label);
  return EMD_EXCLUDE_LABELS.some((ex) => n.includes(ex));
}

function isPlaceholderText(value: string): boolean {
  return /^(refer\s+documents?|refer\s+docs?|as\s+per\s+(?:rfp|tender)|not\s+(?:available|disclosed)|n\.?\s*a\.?|na|--|—|–)$/i.test(
    value.trim(),
  );
}

function cleanValueText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–—]\s*/, "")
    .trim();
}

function emptyResult(): BidAssistExtractedMetadata {
  return {
    tenderId: null,
    title: null,
    organization: null,
    department: null,
    authority: null,
    description: null,
    category: null,
    city: null,
    state: null,
    locationText: null,
    publishedDate: null,
    openingDate: null,
    closingDate: null,
    bidSubmissionDate: null,
    tenderValue: null,
    tenderValueText: null,
    emdAmount: null,
    emdText: null,
    sourceTenderPortal: null,
    sourceUrl: null,
    extractionSources: [],
    rawExtractedFields: { html: {}, pdf: {} },
    warnings: [],
  };
}

function collectHtmlPairs(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const pairs: Record<string, string> = {};

  // <strong>Label:</strong> value
  $("div, p, li, span").each((_, el) => {
    const strong = $(el).find("strong, b").first();
    if (strong.length === 0) return;
    const label = cleanValueText(strong.text());
    if (!label || label.length > 120) return;
    let value = cleanValueText($(el).text().replace(strong.text(), ""));
    if (!value) {
      value = cleanValueText(strong.parent().contents().not(strong).text());
    }
    if (label && value) {
      pairs[label.replace(/:$/, "")] = value;
    }
  });

  // table rows: td/th label | value
  $("tr").each((_, tr) => {
    const cells = $(tr).children("th,td");
    if (cells.length < 2) return;
    const label = cleanValueText($(cells[0]!).text());
    const value = cleanValueText($(cells[1]!).text());
    if (label && value) {
      pairs[label] = value;
    }
  });

  // dl dt/dd
  $("dt").each((_, dt) => {
    const label = cleanValueText($(dt).text());
    const value = cleanValueText($(dt).next("dd").text());
    if (label && value) {
      pairs[label] = value;
    }
  });

  // Embedded JS assignments: var emdfee='10000';
  const scriptText = $("script")
    .map((_, s) => $(s).html() || "")
    .get()
    .join("\n");
  for (const match of scriptText.matchAll(
    /(?:var|let|const)\s+(emdfee\d*|tenderfee\d*|tenderValue|estimatedCost)\s*=\s*['"]?([\d,]+)['"]?/gi,
  )) {
    pairs[`js:${match[1]}`] = match[2]!;
  }

  return pairs;
}

function pairsToCandidates(
  pairs: Record<string, string>,
  sourceFile: string,
  sourceType: "HTML" | "PDF",
  priority: 1 | 2,
): Candidate[] {
  const out: Candidate[] = [];

  for (const [label, rawValue] of Object.entries(pairs)) {
    const value = cleanValueText(rawValue);
    if (!value) continue;

    for (const { field, labels } of TEXT_FIELD_LABELS) {
      if (labelMatches(label, labels)) {
        out.push({ field, value, sourceFile, sourceType, priority });
      }
    }

    for (const { field, labels } of DATE_FIELD_LABELS) {
      if (labelMatches(label, labels)) {
        out.push({ field, value, sourceFile, sourceType, priority });
      }
    }

    if (labelMatches(label, TENDER_VALUE_LABELS)) {
      out.push({
        field: "tenderValueText",
        value,
        sourceFile,
        sourceType,
        priority,
      });
    }

    if (
      labelMatches(label, EMD_LABELS) &&
      !isExcludedEmdLabel(label) &&
      !/payable\s+(to|at)/i.test(label) &&
      !/exempted/i.test(label)
    ) {
      out.push({
        field: "emdText",
        value,
        sourceFile,
        sourceType,
        priority,
      });
    }

    // Script-assigned emdfee → EMD
    if (/^js:emdfee/i.test(label) && !isExcludedEmdLabel(label)) {
      out.push({
        field: "emdText",
        value,
        sourceFile,
        sourceType,
        priority,
      });
    }
  }

  return out;
}

function extractFromPdfText(
  text: string,
  sourceFile: string,
): { pairs: Record<string, string>; candidates: Candidate[] } {
  const pairs: Record<string, string> = {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => cleanValueText(l))
    .filter(Boolean);

  const labelValueLine =
    /^(.{2,80}?)\s*[:=|/]\s*(.+)$|^(.{2,80}?)\s{2,}(.+)$/;

  for (const line of lines) {
    // Bid Number: GEM/...
    const bidNo = line.match(
      /Bid\s*(?:Number|No\.?)\s*[:.]?\s*(GEM\/\d{4}\/B\/\d+|\S+)/i,
    );
    if (bidNo) {
      pairs["Bid Number"] = bidNo[1]!;
    }

    const emdBlock = line.match(
      /(?:EMD(?:\s+Amount|\s+Detail)?|Earnest\s+Money(?:\s+Deposit)?|Bid\s+Security)\s*[:.]?\s*(.+)$/i,
    );
    if (emdBlock && !/performance|epbg|processing\s+fee/i.test(line)) {
      pairs["EMD Amount"] = emdBlock[1]!;
    }

    const valueBlock = line.match(
      /(?:Tender\s+Value|Estimated\s+(?:Tender\s+)?(?:Cost|Value)|Tender\s+Amount|Contract\s+Value)\s*[:.]?\s*(.+)$/i,
    );
    if (valueBlock) {
      pairs["Tender Value"] = valueBlock[1]!;
    }

    const endDate = line.match(
      /Bid\s+End\s+Date(?:\/Time)?\s*(.+)$/i,
    );
    if (endDate) {
      pairs["Bid End Date/Time"] = endDate[1]!;
    }
    const openDate = line.match(
      /Bid\s+Opening\s+Date(?:\/Time)?\s*(.+)$/i,
    );
    if (openDate) {
      pairs["Bid Opening Date/Time"] = openDate[1]!;
    }

    const org = line.match(/Organisation\s+Name\s*(.+)$/i);
    if (org) pairs["Organisation Name"] = org[1]!;
    const dept = line.match(/Department\s+Name\s*(.+)$/i);
    if (dept) pairs["Department Name"] = dept[1]!;
    const ministry = line.match(/Ministry\/State\s+Name\s*(.+)$/i);
    if (ministry) pairs["Ministry/State Name"] = ministry[1]!;

    const m = line.match(labelValueLine);
    if (m) {
      const label = cleanValueText(m[1] || m[3] || "");
      const value = cleanValueText(m[2] || m[4] || "");
      if (label && value && label.length < 80) {
        pairs[label] = value;
      }
    }
  }

  // Multi-line: "EMD Detail" then next line "Required No" or amount
  for (let i = 0; i < lines.length - 1; i += 1) {
    const cur = lines[i]!;
    const next = lines[i + 1]!;
    if (/EMD\s+Detail/i.test(cur) && !/performance|epbg/i.test(cur)) {
      if (/Required\s+No/i.test(next)) {
        pairs["EMD Amount"] = "Not Required";
      } else if (/\d/.test(next)) {
        pairs["EMD Amount"] = next;
      }
    }
  }

  return {
    pairs,
    candidates: pairsToCandidates(pairs, sourceFile, "PDF", 2),
  };
}

async function extractPdfText(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result.text || "");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function listingCandidates(
  listingMetadata: Record<string, unknown>,
): Candidate[] {
  const out: Candidate[] = [];
  const map: Array<[FieldKey, string]> = [
    ["title", "title"],
    ["authority", "authority"],
    ["description", "description"],
    ["category", "category"],
    ["city", "city"],
    ["state", "state"],
    ["closingDate", "closingDate"],
    ["openingDate", "openingDateFilterFrom"],
    ["tenderValueText", "tenderAmountText"],
    ["sourceUrl", "tenderDetailUrl"],
    ["sourceTenderPortal", "sourceTenderPortal"],
    ["tenderId", "bidassistId"],
  ];
  for (const [field, key] of map) {
    const value = listingMetadata[key];
    if (value === null || value === undefined || value === "") continue;
    out.push({
      field,
      value,
      sourceFile: "listing-card",
      sourceType: "LISTING_CARD",
      priority: 3,
    });
  }
  return out;
}

function selectBest(
  candidates: Candidate[],
  warnings: string[],
): Partial<Record<FieldKey, { value: unknown; source: Candidate }>> {
  const byField = new Map<FieldKey, Candidate[]>();
  for (const c of candidates) {
    const list = byField.get(c.field) || [];
    list.push(c);
    byField.set(c.field, list);
  }

  const selected: Partial<
    Record<FieldKey, { value: unknown; source: Candidate }>
  > = {};

  for (const [field, list] of byField) {
    list.sort((a, b) => a.priority - b.priority);
    for (const candidate of list) {
      const text =
        candidate.value === null || candidate.value === undefined
          ? ""
          : String(candidate.value).trim();
      if (!text) continue;

      if (field === "tenderValueText" || field === "emdText") {
        if (isMeaninglessCurrencyText(text)) {
          continue;
        }
        // Allow placeholders only as listing fallback text; prefer numeric docs
        selected[field] = { value: text, source: candidate };
        break;
      }

      if (
        field === "publishedDate" ||
        field === "openingDate" ||
        field === "closingDate" ||
        field === "bidSubmissionDate"
      ) {
        const parsed = parseBidAssistDate(text);
        if (parsed.valid && parsed.isoDate) {
          selected[field] = { value: parsed.isoDate, source: candidate };
          break;
        }
        // keep trying higher-priority failures; don't take invalid
        continue;
      }

      if (isPlaceholderText(text) && candidate.priority < 3) {
        continue;
      }
      if (isPlaceholderText(text) && candidate.priority === 3) {
        // listing placeholder — keep only if nothing else
        if (!selected[field]) {
          selected[field] = { value: text, source: candidate };
        }
        continue;
      }

      selected[field] = { value: text, source: candidate };
      break;
    }

    // Conflicting EMD values
    if (field === "emdText" && list.length > 1) {
      const amounts = list
        .map((c) => parseIndianCurrencyAmount(c.value))
        .filter((p) => p.valid && p.amount != null)
        .map((p) => p.amount);
      const unique = [...new Set(amounts)];
      if (unique.length > 1) {
        warnings.push(
          `Conflicting EMD amounts found: ${unique.join(", ")}`,
        );
      }
    }
  }

  return selected;
}

/**
 * Parse extracted BidAssist documents and merge with listing-card metadata.
 */
export async function extractBidAssistDocumentMetadata(input: {
  tenderFolder: string;
  extractedDocumentPaths: string[];
  listingMetadata: Record<string, unknown>;
}): Promise<BidAssistExtractedMetadata> {
  const result = emptyResult();
  const candidates: Candidate[] = [];
  const htmlRaw: Record<string, Record<string, string>> = {};
  const pdfRaw: Record<
    string,
    { textLength: number; matchedFields: Record<string, string>; excerpt?: string }
  > = {};

  const htmlFiles = input.extractedDocumentPaths.filter((p) =>
    /(?:^|[\\/])(?:ba-)?Tender_Detail.*\.html$/i.test(p) ||
    (/\.html?$/i.test(p) && /tender[_\s-]*detail/i.test(path.basename(p))),
  );
  const pdfFiles = input.extractedDocumentPaths.filter((p) =>
    /\.pdf$/i.test(p),
  );

  // Prefer Tender_Detail HTML; also accept any html if none match
  const htmlTargets =
    htmlFiles.length > 0
      ? htmlFiles
      : input.extractedDocumentPaths.filter((p) => /\.html?$/i.test(p));

  for (const htmlPath of htmlTargets) {
    const fileName = path.basename(htmlPath);
    try {
      const html = fs.readFileSync(htmlPath, "utf8");
      const pairs = collectHtmlPairs(html);
      htmlRaw[fileName] = pairs;
      const fieldCandidates = pairsToCandidates(pairs, fileName, "HTML", 1);
      candidates.push(...fieldCandidates);
      result.extractionSources.push({
        fileName,
        fileType: "HTML",
        extractedFields: [
          ...new Set(fieldCandidates.map((c) => String(c.field))),
        ],
      });
    } catch (error) {
      result.warnings.push(
        `HTML parse failed for ${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const pdfPath of pdfFiles) {
    const fileName = path.basename(pdfPath);
    try {
      const text = await extractPdfText(pdfPath);
      const { pairs, candidates: pdfCandidates } = extractFromPdfText(
        text,
        fileName,
      );
      pdfRaw[fileName] = {
        textLength: text.length,
        matchedFields: pairs,
        excerpt: text.slice(0, 1500),
      };
      candidates.push(...pdfCandidates);
      result.extractionSources.push({
        fileName,
        fileType: "PDF",
        extractedFields: [
          ...new Set(pdfCandidates.map((c) => String(c.field))),
        ],
      });
    } catch (error) {
      result.warnings.push(
        `PDF parse failed for ${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  candidates.push(...listingCandidates(input.listingMetadata));

  const selected = selectBest(candidates, result.warnings);

  for (const [field, entry] of Object.entries(selected) as Array<
    [FieldKey, { value: unknown; source: Candidate }]
  >) {
    (result as Record<string, unknown>)[field] = entry.value;
  }

  // Derive numeric amounts from selected text
  const valueParsed = parseIndianCurrencyAmount(result.tenderValueText);
  if (valueParsed.valid && valueParsed.amount != null) {
    result.tenderValue = valueParsed.amount;
    result.tenderValueText = valueParsed.normalizedText;
  } else if (isMeaninglessCurrencyText(result.tenderValueText)) {
    result.tenderValue = null;
    result.tenderValueText = null;
  } else if (
    result.tenderValueText &&
    isPlaceholderText(result.tenderValueText)
  ) {
    result.tenderValue = null;
    // preserve meaningful placeholder text
  } else if (!valueParsed.valid) {
    result.tenderValue = null;
  }

  const emdParsed = parseIndianCurrencyAmount(result.emdText);
  if (emdParsed.valid && emdParsed.amount != null) {
    result.emdAmount = emdParsed.amount;
    result.emdText = emdParsed.normalizedText;
  } else if (isMeaninglessCurrencyText(result.emdText)) {
    result.emdAmount = null;
    result.emdText = null;
  } else if (result.emdText && /not\s+required|required\s+no/i.test(result.emdText)) {
    result.emdAmount = null;
  } else if (!emdParsed.valid) {
    result.emdAmount = null;
  }

  // Location helper
  if (!result.locationText) {
    const parts = [result.city, result.state].filter(Boolean);
    result.locationText = parts.length ? parts.join(", ") : null;
  }

  result.rawExtractedFields = {
    html: htmlRaw,
    pdf: pdfRaw,
    listing: {
      tenderAmountText: input.listingMetadata.tenderAmountText ?? null,
      closingDate: input.listingMetadata.closingDate ?? null,
      title: input.listingMetadata.title ?? null,
    },
  };

  if (htmlTargets.length === 0 && pdfFiles.length === 0) {
    result.warnings.push("No HTML or PDF documents available for extraction");
  }

  return result;
}

function isValidExplicitValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0;
  }
  const text = String(value).trim();
  if (!text) return false;
  if (isPlaceholderText(text)) return false;
  if (isMeaninglessCurrencyText(text)) return false;
  return true;
}

/**
 * Field-level merge: document values win over listing placeholders.
 */
export function mergeBidAssistMetadata(input: {
  listingMetadata: Record<string, unknown>;
  documentMetadata: BidAssistExtractedMetadata;
}): Record<string, unknown> {
  const { listingMetadata, documentMetadata: doc } = input;

  const listingAmountText =
    typeof listingMetadata.tenderAmountText === "string"
      ? listingMetadata.tenderAmountText
      : null;
  const listingAmount = parseIndianCurrencyAmount(listingAmountText);

  const tenderValue = isValidExplicitValue(doc.tenderValue)
    ? doc.tenderValue
    : listingAmount.valid
      ? listingAmount.amount
      : null;

  let tenderValueText: string | null = null;
  if (isValidExplicitValue(doc.tenderValueText) && !isPlaceholderText(String(doc.tenderValueText))) {
    tenderValueText = String(doc.tenderValueText);
  } else if (listingAmount.valid && listingAmount.normalizedText) {
    tenderValueText = listingAmount.normalizedText;
  } else if (
    listingAmountText &&
    isPlaceholderText(listingAmountText)
  ) {
    // Preserve meaningful placeholder only when no numeric value
    tenderValueText = tenderValue == null ? listingAmountText : null;
  } else if (listingAmount.reason === "currency_marker_only") {
    tenderValueText = null;
  }

  if (isMeaninglessCurrencyText(tenderValueText)) {
    tenderValueText = null;
  }

  const emdAmount = isValidExplicitValue(doc.emdAmount) ? doc.emdAmount : null;
  let emdText =
    isValidExplicitValue(doc.emdText) && !isPlaceholderText(String(doc.emdText))
      ? String(doc.emdText)
      : null;
  if (isMeaninglessCurrencyText(emdText)) {
    emdText = null;
  }

  const pickText = (
    docValue: string | null,
    listingKey: string,
  ): string | null => {
    if (isValidExplicitValue(docValue) && !isPlaceholderText(String(docValue))) {
      return String(docValue);
    }
    const listing = listingMetadata[listingKey];
    if (isValidExplicitValue(listing) && !isPlaceholderText(String(listing))) {
      return String(listing);
    }
    return isValidExplicitValue(docValue) ? String(docValue) : null;
  };

  const pickDate = (docValue: string | null, listingKey: string): string | null => {
    if (docValue) {
      const parsed = parseBidAssistDate(docValue);
      if (parsed.valid) return parsed.isoDate;
    }
    const listing = listingMetadata[listingKey];
    const parsed = parseBidAssistDate(listing);
    return parsed.valid ? parsed.isoDate : null;
  };

  const normalized = {
    tenderValue,
    tenderValueText,
    emdAmount,
    emdText,
    publishedDate: doc.publishedDate,
    openingDate: pickDate(doc.openingDate, "openingDateFilterFrom"),
    closingDate: pickDate(doc.closingDate, "closingDate"),
    bidSubmissionDate:
      pickDate(doc.bidSubmissionDate, "closingDate") ||
      pickDate(doc.closingDate, "closingDate"),
    title: pickText(doc.title, "title"),
    organization:
      pickText(doc.organization, "authority") ||
      pickText(doc.authority, "authority"),
    department: doc.department,
    authority: pickText(doc.authority, "authority"),
    description: pickText(doc.description, "description"),
    category: pickText(doc.category, "category"),
    city: pickText(doc.city, "city"),
    state: pickText(doc.state, "state"),
    locationText:
      doc.locationText ||
      [pickText(doc.city, "city"), pickText(doc.state, "state")]
        .filter(Boolean)
        .join(", ") ||
      null,
    sourceUrl: pickText(doc.sourceUrl, "tenderDetailUrl"),
    sourceTenderPortal: pickText(
      doc.sourceTenderPortal,
      "sourceTenderPortal",
    ),
    tenderId:
      pickText(doc.tenderId, "bidassistId") ||
      (typeof listingMetadata.bidassistId === "string"
        ? listingMetadata.bidassistId
        : null),
  };

  return {
    ...listingMetadata,
    // Flatten commonly used enriched fields onto the BidAssist metadata object
    title: normalized.title || listingMetadata.title || "",
    authority: normalized.authority || listingMetadata.authority || "",
    description: normalized.description || listingMetadata.description || "",
    category: normalized.category || listingMetadata.category || "",
    city: normalized.city || listingMetadata.city || "",
    state: normalized.state || listingMetadata.state || "",
    closingDate:
      normalized.closingDate ||
      (typeof listingMetadata.closingDate === "string"
        ? listingMetadata.closingDate
        : ""),
    tenderAmountText: tenderValueText || listingAmountText || "",
    tenderValue,
    tenderValueText,
    emdAmount,
    emdText,
    organization: normalized.organization,
    department: normalized.department,
    publishedDate: normalized.publishedDate,
    openingDate: normalized.openingDate,
    bidSubmissionDate: normalized.bidSubmissionDate,
    locationText: normalized.locationText,
    sourceUrl: normalized.sourceUrl,
    listingMetadata: { ...listingMetadata },
    documentExtraction: {
      html: doc.rawExtractedFields.html,
      pdf: doc.rawExtractedFields.pdf,
      warnings: doc.warnings,
      extractionSources: doc.extractionSources,
    },
    normalized,
  };
}

/** Validate BidAssist row fields before Supabase upsert. */
export function validateBidAssistUpsertPayload(row: {
  source_tender_id: string;
  title: string;
  raw_metadata: unknown;
  tender_value: number | null;
  tender_value_text: string | null;
  emd_amount: number | null;
  published_date?: string | null;
  opening_date?: string | null;
  closing_date?: string | null;
  bid_submission_date?: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (!row.source_tender_id?.trim()) {
    return { ok: false, error: "source_tender_id is empty" };
  }
  if (!row.title?.trim()) {
    return { ok: false, error: "title is empty" };
  }
  if (
    row.raw_metadata === null ||
    row.raw_metadata === undefined ||
    (typeof row.raw_metadata === "object" &&
      Object.keys(row.raw_metadata as object).length === 0)
  ) {
    return { ok: false, error: "raw_metadata is empty" };
  }
  if (row.tender_value != null && row.tender_value < 0) {
    return { ok: false, error: "tender_value is negative" };
  }
  if (row.emd_amount != null && row.emd_amount < 0) {
    return { ok: false, error: "emd_amount is negative" };
  }

  for (const [name, value] of [
    ["published_date", row.published_date],
    ["opening_date", row.opening_date],
    ["closing_date", row.closing_date],
    ["bid_submission_date", row.bid_submission_date],
  ] as const) {
    if (value == null || value === "") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, error: `${name} is not YYYY-MM-DD` };
    }
  }

  return { ok: true };
}
