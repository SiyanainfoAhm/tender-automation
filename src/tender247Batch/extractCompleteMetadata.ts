import type { Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { parseOptionalMoney } from "./resumeArtifacts.js";

export interface CompleteTenderMetadata {
  source: "tender247";
  t247Id: string;
  detailUrl: string;
  /** Exact portal strings (including "Refer Document") */
  raw?: Record<string, string | null>;
  normalized: Record<string, string | number | null>;
  tenderOverview: Record<string, string>;
  aiSummary: Record<string, string>;
  downloads: {
    aiSummaryDownloaded: boolean;
    allDocumentsDownloaded: boolean;
    aiSummaryFile: string | null;
    allDocumentsFile: string | null;
  };
  processedAt: string;
  metadataExtractionStatus?: "processing" | "complete" | "partial";
  metadataExtractionError?: string | null;
  securityCodeCaptured?: boolean;
  status?: string;
  apiDetail?: Record<string, unknown>;
}

const MAX_SUMMARY_SCROLL_PASSES = 20;
const MAX_STABLE_PASSES = 2;
const MAX_ROWS_PER_SCAN = 80;
const MIN_FIELDS_BEFORE_SCROLL = 6;

/**
 * Extract tender overview + AI Summary using Playwright Locator APIs only.
 * All loops are bounded. Optional fields never block completion.
 */
export async function extractCompleteTenderMetadata(options: {
  detailPage: Page;
  t247Id: string;
  detailUrl: string;
  titleHint?: string | null;
  apiDetailRow?: Record<string, unknown>;
  logger: Logger;
  /** Absolute epoch ms deadline; extraction aborts cleanly when exceeded */
  deadlineMs?: number;
}): Promise<CompleteTenderMetadata> {
  const { detailPage, t247Id, detailUrl, titleHint, apiDetailRow, logger } =
    options;
  const deadlineMs = options.deadlineMs ?? Date.now() + 30_000;

  const assertNotTimedOut = (): void => {
    if (Date.now() > deadlineMs) {
      throw new Error("METADATA_EXTRACTION_TIMEOUT");
    }
  };

  logger.info(`METADATA_EXTRACTION_START T247-${t247Id}`);
  assertNotTimedOut();

  logger.info("TENDER_OVERVIEW_EXTRACTION_START");
  const tenderOverview = await extractTenderOverview(
    detailPage,
    logger,
    assertNotTimedOut,
  );
  logger.info("TENDER_OVERVIEW_EXTRACTION_COMPLETE");
  logger.info(
    `TENDER_OVERVIEW_FIELDS_EXTRACTED=${Object.keys(tenderOverview).length}`,
  );
  assertNotTimedOut();

  logger.info("AI_SUMMARY_EXTRACTION_START");
  const aiSummary = await extractAiSummaryComplete(
    detailPage,
    logger,
    assertNotTimedOut,
  );
  logger.info("AI_SUMMARY_EXTRACTION_COMPLETE");
  logger.info(
    `AI_SUMMARY_FIELDS_EXTRACTED=${Object.keys(aiSummary).length}`,
  );

  const { raw, normalized } = buildNormalized({
    t247Id,
    titleHint: titleHint ?? null,
    tenderOverview,
    aiSummary,
    apiDetailRow: apiDetailRow ?? {},
  });

  logKeyNormalizedFields(normalized, logger);

  return {
    source: "tender247",
    t247Id,
    detailUrl,
    raw,
    normalized,
    tenderOverview,
    aiSummary,
    downloads: {
      aiSummaryDownloaded: false,
      allDocumentsDownloaded: false,
      aiSummaryFile: null,
      allDocumentsFile: null,
    },
    processedAt: new Date().toISOString(),
    metadataExtractionStatus: "complete",
    metadataExtractionError: null,
    ...(apiDetailRow && Object.keys(apiDetailRow).length > 0
      ? { apiDetail: apiDetailRow }
      : {}),
  };
}

async function extractTenderOverview(
  page: Page,
  logger: Logger,
  assertNotTimedOut: () => void,
): Promise<Record<string, string>> {
  const map = new Map<string, string>();
  assertNotTimedOut();

  const overviewAnchor = page
    .getByText(/^Brief$/i)
    .or(page.getByText(/Tender\s*Overview/i))
    .or(page.getByText(/T247\s*ID/i))
    .first();

  let scope: Locator = page.locator("main").first();
  if ((await overviewAnchor.count().catch(() => 0)) > 0) {
    const ancestor = overviewAnchor
      .locator(
        'xpath=ancestor::*[self::div or self::section or self::article][position()<=5][1]',
      )
      .first();
    if ((await ancestor.count().catch(() => 0)) > 0) {
      scope = ancestor;
    }
  } else if ((await scope.count().catch(() => 0)) === 0) {
    scope = page.locator("body");
  }

  assertNotTimedOut();
  await collectBoundedRows(scope, map, assertNotTimedOut);
  if (map.size < 4) {
    assertNotTimedOut();
    const text =
      (await scope.textContent({ timeout: 5_000 }).catch(() => "")) || "";
    mergeParsedTextPairs(text, map);
  }

  logger.info(`Overview fields collected=${map.size}`);
  return Object.fromEntries(map);
}

async function extractAiSummaryComplete(
  page: Page,
  logger: Logger,
  assertNotTimedOut: () => void,
): Promise<Record<string, string>> {
  const map = new Map<string, string>();
  assertNotTimedOut();

  const heading = page.getByText(/AI\s*Generated\s*Tender\s*Summary/i).first();
  if ((await heading.count().catch(() => 0)) === 0) {
    logger.warn("AI Generated Tender Summary section not found");
    return {};
  }
  logger.info("AI_SUMMARY_SECTION_FOUND");

  const section = heading
    .locator(
      'xpath=ancestor::*[self::div or self::section or self::article or self::aside][position()<=8][1]',
    )
    .first();

  const summaryTab = section
    .getByRole("tab", { name: /^Summary$/i })
    .or(section.getByText(/^Summary$/i))
    .first();
  if ((await summaryTab.count().catch(() => 0)) > 0) {
    await summaryTab.click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);
  }

  assertNotTimedOut();
  logger.info("AI_SUMMARY_ROWS_SCAN_START");
  await collectBoundedRows(section, map, assertNotTimedOut);

  assertNotTimedOut();
  const completeSummaryText =
    (await section.textContent({ timeout: 8_000 }).catch(() => "")) ||
    (await section.innerText({ timeout: 8_000 }).catch(() => "")) ||
    "";
  if (completeSummaryText) {
    mergeParsedTextPairs(completeSummaryText, map);
  }

  logger.info("AI_SUMMARY_ROWS_SCAN_COMPLETE");
  logger.info(`AI Summary fields after DOM read=${map.size}`);

  if (map.size < MIN_FIELDS_BEFORE_SCROLL) {
    assertNotTimedOut();
    await boundedSummaryScroll(section, page, map, logger, assertNotTimedOut);
  }

  return Object.fromEntries(map);
}

async function collectBoundedRows(
  scope: Locator,
  map: Map<string, string>,
  assertNotTimedOut: () => void,
): Promise<void> {
  const rows = scope.locator(
    'tr, [class*="row" i], li, div:has(> *:nth-child(2)):not(:has(> *:nth-child(4)))',
  );
  const rowCount = Math.min(
    await rows.count().catch(() => 0),
    MAX_ROWS_PER_SCAN,
  );

  for (let i = 0; i < rowCount; i += 1) {
    assertNotTimedOut();
    const row = rows.nth(i);
    const text = cleanValue((await row.textContent().catch(() => "")) || "");
    if (!text || text.length < 3 || text.length > 4000) {
      continue;
    }

    const cells = row.locator("th, td, > *");
    const cellCount = await cells.count().catch(() => 0);
    if (cellCount >= 2 && cellCount <= 4) {
      const label = cleanLabel(
        (await cells.nth(0).textContent().catch(() => "")) || "",
      );
      const valueParts: string[] = [];
      for (let c = 1; c < cellCount; c += 1) {
        valueParts.push(
          (await cells.nth(c).textContent().catch(() => "")) || "",
        );
      }
      addPair(map, label, cleanValue(valueParts.join(" ")));
      continue;
    }

    const colon = text.match(/^(.{2,80}?)\s*[:：]\s*([\s\S]+)$/);
    if (colon) {
      addPair(map, cleanLabel(colon[1] ?? ""), cleanValue(colon[2] ?? ""));
    }
  }

  const dts = scope.locator("dt");
  const dtCount = Math.min(await dts.count().catch(() => 0), 40);
  for (let i = 0; i < dtCount; i += 1) {
    assertNotTimedOut();
    const dt = dts.nth(i);
    const dd = dt.locator("xpath=following-sibling::dd[1]");
    addPair(
      map,
      cleanLabel((await dt.textContent().catch(() => "")) || ""),
      cleanValue((await dd.textContent().catch(() => "")) || ""),
    );
  }
}

async function boundedSummaryScroll(
  section: Locator,
  page: Page,
  map: Map<string, string>,
  logger: Logger,
  assertNotTimedOut: () => void,
): Promise<void> {
  let stablePasses = 0;
  let previousFieldCount = map.size;

  try {
    await section.hover({ timeout: 2_000 }).catch(() => undefined);
  } catch {
    logger.info("AI_SUMMARY_SCROLL_CONTAINER_NOT_FOUND");
    return;
  }

  for (let pass = 0; pass < MAX_SUMMARY_SCROLL_PASSES; pass += 1) {
    assertNotTimedOut();
    await page.mouse.wheel(0, 350).catch(() => undefined);
    await page.waitForTimeout(350).catch(() => undefined);

    await collectBoundedRows(section, map, assertNotTimedOut);
    const text =
      (await section.textContent({ timeout: 2_000 }).catch(() => "")) || "";
    mergeParsedTextPairs(text, map);

    if (map.size === previousFieldCount) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
    }
    previousFieldCount = map.size;

    if (stablePasses >= MAX_STABLE_PASSES) {
      break;
    }
  }

  logger.info(`AI Summary fields after bounded scroll=${map.size}`);
}

function mergeParsedTextPairs(
  text: string,
  map: Map<string, string>,
): void {
  if (!text || !text.trim()) {
    return;
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const knownLabel =
    /^(Tender\s*Id|GEM\s*Bid\s*number|GEM\s*Bid|Bid\s*End\s*Date\s*Time|Bid\s*Opening\s*Date\s*Time|Bid\s*Offer\s*Validity[^\n]*|Ministry\s*State\s*Name|Department\s*Name|Organi[sz]ation\s*Name|Office\s*Name|Item\s*Category|Contract\s*Period|Bid\s*to\s*RA?\s*Enabled|Type\s*of\s*Bid|Time\s*Allowed[^\n]*|Evaluation\s*Method|Advisory\s*Bank|Emd\s*Amount|EMD\s*Amount|Emd\s*Instrument\s*Type|Completion\s*Period|Category|Location|EMD\s*Value|Document\s*required\s*from\s*seller|Pre\s*Bid\s*Meeting|Last\s*date\s*for\s*Seeking\s*Clarification|Performance\s*Bank\s*Guarantee|Payment\s*terms|Evaluation\s*Weightage|Mandatory\s*Sample\s*Submission|Checklist|T247\s*ID|Quantity|Website|Brief|Description|Submission\s*Date|Opening\s*Date|Bid\s*Value|Tender\s*Estimated\s*Cost|Tender\s*Document\s*Fees?|Organi[sz]ation|Department)$/i;

  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentLabel: string | null = null;
  let valueBuf: string[] = [];

  const flush = (): void => {
    if (currentLabel && valueBuf.length > 0) {
      addPair(map, currentLabel, cleanValue(valueBuf.join("\n")));
    }
    currentLabel = null;
    valueBuf = [];
  };

  for (const line of lines) {
    const colon = line.match(/^([^:：]{2,80})[:：]\s*(.+)$/);
    if (colon && knownLabel.test(cleanLabel(colon[1] ?? ""))) {
      flush();
      addPair(map, cleanLabel(colon[1] ?? ""), cleanValue(colon[2] ?? ""));
      continue;
    }

    if (knownLabel.test(line) && line.length <= 80) {
      flush();
      currentLabel = cleanLabel(line);
      continue;
    }

    if (currentLabel) {
      valueBuf.push(line);
    }
  }
  flush();
}

function addPair(
  map: Map<string, string>,
  labelRaw: string,
  valueRaw: string,
): void {
  const label = cleanLabel(labelRaw);
  const value = cleanValue(valueRaw);
  if (!label || label.length > 160) {
    return;
  }
  if (/download|pdf download|^summary$|^overview$|^documents$/i.test(label)) {
    return;
  }
  if (!value || value === "-" || /^n\/?a$/i.test(value)) {
    return;
  }
  if (value.toLowerCase() === label.toLowerCase()) {
    return;
  }
  const existing = map.get(label);
  if (!existing || value.length > existing.length) {
    map.set(label, value);
  }
}

function cleanLabel(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim();
}

function cleanValue(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildNormalized(input: {
  t247Id: string;
  titleHint: string | null;
  tenderOverview: Record<string, string>;
  aiSummary: Record<string, string>;
  apiDetailRow: Record<string, unknown>;
}): {
  raw: Record<string, string | null>;
  normalized: Record<string, string | number | null>;
} {
  const ov = input.tenderOverview;
  const ai = input.aiSummary;
  const api = input.apiDetailRow;

  const pick = (...candidates: Array<string | null | undefined>): string | null => {
    for (const c of candidates) {
      if (c != null && String(c).trim() !== "") {
        return String(c).trim();
      }
    }
    return null;
  };

  const fromMaps = (
    sources: Array<Record<string, string>>,
    patterns: RegExp[],
  ): string | null => {
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) {
        if (patterns.some((re) => re.test(k.trim()))) {
          if (v && v.trim()) {
            return v.trim();
          }
        }
      }
    }
    return null;
  };

  const organisation = pick(
    fromMaps([ov, ai], [/^Organi[sz]ation(\s*Name)?$/i, /^Authority$/i]),
    typeof api.organization_name === "string" ? api.organization_name : null,
  );

  const department = pick(
    fromMaps([ai, ov], [/^Department(\s*Name)?$/i]),
  );

  const ministry = pick(
    fromMaps([ai, ov], [/^Ministry(\s*State\s*Name)?$/i, /^Ministry$/i]),
  );

  const location = pick(
    fromMaps([ov, ai], [/^Location$/i, /^City$/i, /^Place$/i]),
    typeof api.city_name === "string" ? api.city_name : null,
  );

  const closingDate = pick(
    fromMaps([ai, ov], [
      /^Bid\s*End\s*Date(\s*Time)?$/i,
      /^Submission\s*Date$/i,
      /^Closing\s*Date$/i,
    ]),
    typeof api.tender_endsubmission_datetime === "string"
      ? api.tender_endsubmission_datetime
      : null,
  );

  const openingDate = pick(
    fromMaps([ai, ov], [/^Bid\s*Opening\s*Date(\s*Time)?$/i, /^Opening\s*Date$/i]),
    typeof api.tender_opening_datetime === "string"
      ? api.tender_opening_datetime
      : null,
  );

  const tenderName = pick(
    fromMaps([ov, ai], [
      /^Brief$/i,
      /^Tender\s*Name$/i,
      /^Title$/i,
      /^Description$/i,
      /^Item\s*Category$/i,
    ]),
    typeof api.requirement_workbrief === "string"
      ? api.requirement_workbrief
      : null,
    input.titleHint,
  );

  const gemBidNumber = pick(
    fromMaps([ai, ov], [/^GEM\s*Bid\s*number$/i, /^GEM\s*Bid$/i]),
  );

  const category = pick(
    fromMaps([ai, ov], [/^Item\s*Category$/i, /^Category$/i]),
  );

  const tenderValueRaw = pick(
    fromMaps([ov, ai], [
      /^Bid\s*Value$/i,
      /^Tender\s*Estimated\s*Cost$/i,
      /^Estimated\s*(Cost|Value)$/i,
    ]),
    api.tender_estimatedcost != null ? String(api.tender_estimatedcost) : null,
  );

  const emdRaw = pick(
    fromMaps([ai, ov], [/^Emd\s*Amount$/i, /^EMD\s*Value$/i, /^EMD$/i]),
    api.earnest_money_deposite != null
      ? String(api.earnest_money_deposite)
      : null,
  );

  const documentFeesRaw = fromMaps([ov, ai], [
    /^Tender\s*Document\s*Fees?$/i,
    /^Document\s*Fees?$/i,
  ]);

  const raw: Record<string, string | null> = {
    "Tender Estimated Cost": tenderValueRaw,
    EMD: emdRaw,
    "Tender Document Fees": documentFeesRaw,
    "GEM Bid Number": gemBidNumber,
    Organisation: organisation,
    Department: department,
    Location: location,
  };

  const normalized: Record<string, string | number | null> = {
    tenderName,
    gemBidNumber,
    organisation,
    department,
    ministry,
    location,
    closingDate,
    openingDate,
    tenderValue: parseOptionalMoney(tenderValueRaw),
    emdAmount: parseOptionalMoney(emdRaw),
    category,
    contractPeriod: fromMaps([ai, ov], [
      /^Contract\s*Period$/i,
      /^Completion\s*Period$/i,
    ]),
    evaluationMethod: fromMaps([ai, ov], [/^Evaluation\s*Method$/i]),
    evaluationWeightage: fromMaps([ai, ov], [/^Evaluation\s*Weightage$/i]),
    performanceBankGuarantee: fromMaps([ai, ov], [
      /^Performance\s*Bank\s*Guarantee$/i,
    ]),
    preBidMeeting: fromMaps([ai, ov], [/^Pre[-\s]?Bid\s*Meeting$/i]),
    website: fromMaps([ov, ai], [/^Website$/i]),
    quantity: fromMaps([ov, ai], [/^Quantity$/i]),
    documentFees: parseOptionalMoney(documentFeesRaw),
    brief: fromMaps([ov], [/^Brief$/i]),
    description: fromMaps([ov], [/^Description$/i]),
  };

  return { raw, normalized };
}

function logKeyNormalizedFields(
  normalized: Record<string, string | number | null>,
  logger: Logger,
): void {
  if (normalized.gemBidNumber) {
    logger.info(`GEM_BID_NUMBER=${normalized.gemBidNumber}`);
  }
  if (normalized.organisation) {
    logger.info(`ORGANISATION=${normalized.organisation}`);
  }
  if (normalized.department) {
    logger.info(`DEPARTMENT=${normalized.department}`);
  }
  if (normalized.category) {
    logger.info(`CATEGORY=${normalized.category}`);
  }
  if (normalized.location) {
    logger.info(`LOCATION=${normalized.location}`);
  }
}
