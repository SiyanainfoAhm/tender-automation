import crypto from "node:crypto";
import type { BidassistMetadata } from "../bidassist/bidassistTypes.js";
import {
  isMeaninglessCurrencyText,
  parseIndianCurrencyAmount,
} from "../bidassist/parseIndianCurrencyAmount.js";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";

export type AgenttenderSourcePortal = "TENDER247" | "BIDASSIST";

export type AgenttenderDownloadStatus =
  | "DISCOVERED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "READY"
  | "COMPLETED"
  | "FAILED"
  | "DB_SYNC_FAILED";

export interface AgenttenderTenderRow {
  source_portal: AgenttenderSourcePortal;
  source_tender_id: string;
  folder_id: string | null;
  title: string;
  organization: string | null;
  department: string | null;
  authority: string | null;
  category: string | null;
  tender_type: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  published_date: string | null;
  opening_date: string | null;
  closing_date: string | null;
  bid_submission_date: string | null;
  tender_value: number | null;
  tender_value_text: string | null;
  emd_amount: number | null;
  emd_text: string | null;
  currency: string;
  source_url: string | null;
  local_folder_path: string | null;
  ai_summary_available: boolean;
  document_archive_available: boolean;
  download_status: AgenttenderDownloadStatus;
  qualification_status: string | null;
  raw_metadata: CompleteTenderMetadata | Record<string, unknown>;
  metadata_version: number;
  content_hash: string;
  last_seen_at: string;
  crawled_at: string | null;
  supabase_synced_at: string;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (!cleaned) {
      return null;
    }
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Parse portal dates such as 17-08-2026, 17/08/2026, or 2026-08-17. */
export function parsePortalDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) {
    return null;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}

export function hashMetadataContent(metadata: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(metadata))
    .digest("hex");
}

function splitLocation(location: string | null): {
  city: string | null;
  state: string | null;
} {
  if (!location) {
    return { city: null, state: null };
  }
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts[0] || null,
      state: parts.slice(1).join(", ") || null,
    };
  }
  return { city: null, state: location };
}

export function mapDownloadStatus(options: {
  metadata: CompleteTenderMetadata;
  syncFailed?: boolean;
}): AgenttenderDownloadStatus {
  if (options.syncFailed) {
    return "DB_SYNC_FAILED";
  }
  const { metadata } = options;
  const docsReady = Boolean(metadata.downloads?.allDocumentsDownloaded);
  const extraction = metadata.metadataExtractionStatus;
  if (extraction === "processing") {
    return "DOWNLOADING";
  }
  if (docsReady && (extraction === "complete" || extraction === "partial")) {
    return "READY";
  }
  if (docsReady) {
    return "DOWNLOADED";
  }
  if (extraction === "partial") {
    return "DOWNLOADED";
  }
  if (extraction === "complete") {
    return "DOWNLOADED";
  }
  return "DISCOVERED";
}

/** Build the upsert row for Tender247 crawler metadata. */
export function buildTender247SupabaseRow(options: {
  metadata: CompleteTenderMetadata;
  localFolderPath: string;
  syncFailed?: boolean;
  /** Optional overrides from on-disk artifact detection (backfill). */
  aiSummaryAvailable?: boolean;
  documentArchiveAvailable?: boolean;
}): AgenttenderTenderRow {
  const { metadata, localFolderPath } = options;
  const normalized = metadata.normalized || {};
  const overview = metadata.tenderOverview || {};
  const title =
    asText(normalized.tenderName) ||
    asText(overview["Tender Name -"]) ||
    asText(overview["Tender Name"]) ||
    `T247-${metadata.t247Id}`;
  const organization =
    asText(normalized.organisation) ||
    asText(overview["Organisation -"]) ||
    asText(overview["Organization -"]) ||
    asText(metadata.raw?.Organisation);
  const department =
    asText(normalized.department) || asText(metadata.raw?.Department);
  const locationText =
    asText(normalized.location) ||
    asText(overview["Site Location -"]) ||
    asText(metadata.raw?.Location);
  const { city, state } = splitLocation(locationText);
  const closingDate = parsePortalDate(
    normalized.closingDate || overview["Closing Date -"],
  );
  const openingDate = parsePortalDate(
    normalized.openingDate || overview["Opening Date -"],
  );
  const now = new Date().toISOString();

  const aiSummaryAvailable =
    options.aiSummaryAvailable ??
    Boolean(metadata.downloads?.aiSummaryDownloaded);
  const documentArchiveAvailable =
    options.documentArchiveAvailable ??
    Boolean(metadata.downloads?.allDocumentsDownloaded);

  // Keep download_status consistent with the availability flags we persist
  const statusMetadata: CompleteTenderMetadata = {
    ...metadata,
    downloads: {
      aiSummaryDownloaded: aiSummaryAvailable,
      allDocumentsDownloaded: documentArchiveAvailable,
      aiSummaryFile: metadata.downloads?.aiSummaryFile ?? null,
      allDocumentsFile: metadata.downloads?.allDocumentsFile ?? null,
    },
  };

  return {
    source_portal: "TENDER247",
    source_tender_id: String(metadata.t247Id),
    folder_id: `T247-${metadata.t247Id}`,
    title,
    organization,
    department,
    authority: organization,
    category: asText(normalized.category),
    tender_type: null,
    description:
      asText(normalized.description) || asText(normalized.brief) || null,
    city,
    state,
    location_text: locationText,
    published_date: null,
    opening_date: openingDate,
    closing_date: closingDate,
    bid_submission_date: closingDate,
    tender_value: asNumber(normalized.tenderValue),
    tender_value_text:
      asText(metadata.raw?.["Tender Estimated Cost"]) ||
      (normalized.tenderValue != null ? String(normalized.tenderValue) : null),
    emd_amount: asNumber(normalized.emdAmount),
    emd_text: asText(metadata.raw?.EMD) || asText(metadata.aiSummary?.["EMD Amount"]),
    currency: "INR",
    source_url: metadata.detailUrl || null,
    local_folder_path: localFolderPath,
    ai_summary_available: aiSummaryAvailable,
    document_archive_available: documentArchiveAvailable,
    download_status: mapDownloadStatus({
      metadata: statusMetadata,
      syncFailed: options.syncFailed,
    }),
    qualification_status: null,
    raw_metadata: metadata,
    metadata_version: 1,
    content_hash: hashMetadataContent(metadata),
    last_seen_at: now,
    crawled_at: metadata.processedAt || now,
    supabase_synced_at: now,
  };
}

/** Build the upsert row for BidAssist crawler metadata. */
export function buildBidassistSupabaseRow(options: {
  metadata: BidassistMetadata;
  localFolderPath: string;
  documentArchiveAvailable?: boolean;
  syncFailed?: boolean;
}): AgenttenderTenderRow {
  const { metadata, localFolderPath } = options;
  const now = new Date().toISOString();
  const documentArchiveAvailable =
    options.documentArchiveAvailable ??
    Boolean(metadata.originalZipFile && metadata.documents?.length);

  const normalized =
    metadata.normalized && typeof metadata.normalized === "object"
      ? (metadata.normalized as Record<string, unknown>)
      : {};

  const title =
    asText(normalized.title) ||
    asText(metadata.title) ||
    `BA-${metadata.bidassistId}`;
  const authority =
    asText(normalized.authority) || asText(metadata.authority);
  const organization =
    asText(normalized.organization) ||
    asText(metadata.organization) ||
    authority;
  const department =
    asText(normalized.department) || asText(metadata.department);
  const city = asText(normalized.city) || asText(metadata.city);
  const state = asText(normalized.state) || asText(metadata.state);
  const locationText =
    asText(normalized.locationText) ||
    asText(metadata.locationText) ||
    ([city, state].filter(Boolean).join(", ") || null);

  let tenderValue =
    asNumber(normalized.tenderValue) ??
    asNumber(metadata.tenderValue) ??
    null;
  let tenderValueText =
    asText(normalized.tenderValueText) ||
    asText(metadata.tenderValueText) ||
    asText(metadata.tenderAmountText);

  if (tenderValue == null && tenderValueText) {
    const parsed = parseIndianCurrencyAmount(tenderValueText);
    if (parsed.valid) {
      tenderValue = parsed.amount;
      tenderValueText = parsed.normalizedText;
    } else if (parsed.reason === "currency_marker_only") {
      tenderValueText = null;
      console.log("BIDASSIST_INVALID_TENDER_VALUE_TEXT_REJECTED");
    } else if (!parsed.valid && isMeaninglessCurrencyText(tenderValueText)) {
      tenderValueText = null;
      console.log("BIDASSIST_INVALID_TENDER_VALUE_TEXT_REJECTED");
    }
  } else if (tenderValueText && isMeaninglessCurrencyText(tenderValueText)) {
    tenderValueText = null;
    console.log("BIDASSIST_INVALID_TENDER_VALUE_TEXT_REJECTED");
  }

  const emdAmount =
    asNumber(normalized.emdAmount) ?? asNumber(metadata.emdAmount) ?? null;
  let emdText =
    asText(normalized.emdText) || asText(metadata.emdText) || null;
  if (emdText && isMeaninglessCurrencyText(emdText)) {
    emdText = null;
  }

  const publishedDate =
    parsePortalDate(normalized.publishedDate) ||
    parsePortalDate(metadata.publishedDate);
  const openingDate =
    parsePortalDate(normalized.openingDate) ||
    parsePortalDate(metadata.openingDate) ||
    parsePortalDate(metadata.openingDateFilterFrom);
  const closingDate =
    parsePortalDate(normalized.closingDate) ||
    parsePortalDate(metadata.closingDate);
  const bidSubmissionDate =
    parsePortalDate(normalized.bidSubmissionDate) ||
    parsePortalDate(metadata.bidSubmissionDate) ||
    closingDate;

  return {
    source_portal: "BIDASSIST",
    source_tender_id: String(metadata.bidassistId),
    folder_id: metadata.folderId || `BA-${metadata.bidassistId}`,
    title,
    organization,
    department,
    authority,
    category: asText(normalized.category) || asText(metadata.category),
    tender_type: null,
    description:
      asText(normalized.description) || asText(metadata.description),
    city,
    state,
    location_text: locationText,
    published_date: publishedDate,
    opening_date: openingDate,
    closing_date: closingDate,
    bid_submission_date: bidSubmissionDate,
    tender_value: tenderValue,
    tender_value_text: tenderValueText,
    emd_amount: emdAmount,
    emd_text: emdText,
    currency: "INR",
    source_url:
      asText(normalized.sourceUrl) ||
      asText(metadata.sourceUrl) ||
      asText(metadata.tenderDetailUrl),
    local_folder_path: localFolderPath,
    ai_summary_available: false,
    document_archive_available: documentArchiveAvailable,
    download_status: options.syncFailed
      ? "DB_SYNC_FAILED"
      : documentArchiveAvailable
        ? "READY"
        : "DOWNLOADED",
    qualification_status: null,
    raw_metadata: { ...metadata } as Record<string, unknown>,
    metadata_version: 1,
    content_hash: hashMetadataContent(metadata),
    last_seen_at: now,
    crawled_at: metadata.downloadedAt || now,
    supabase_synced_at: now,
  };
}

export function keepLocalMetadataJson(): boolean {
  const raw = process.env.KEEP_LOCAL_METADATA_JSON?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw === "true" || raw === "1";
}

export function isSupabaseRequired(): boolean {
  const raw = process.env.SUPABASE_REQUIRED?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}
