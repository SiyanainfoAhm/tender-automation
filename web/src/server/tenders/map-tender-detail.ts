import "server-only";

import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { isTenderStatus } from "@/lib/tender-classification";
import { toAccessibleStorageUrl } from "@/lib/storage/accessible-storage-url";
import type {
  ExtractedRequirement,
  TenderArchiveDocument,
  TenderDetailDTO,
  TenderQualificationDTO,
} from "@/lib/tender-detail";
import type { TenderStatus } from "@/lib/tender-status";

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function criterionText(item: unknown): { name: string; description: string } {
  if (typeof item === "string") {
    return { name: item, description: item };
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const name =
      asString(record.name) ||
      asString(record.criterion) ||
      asString(record.title) ||
      asString(record.condition) ||
      "Requirement";
    const description =
      asString(record.description) ||
      asString(record.detail) ||
      asString(record.reason) ||
      asString(record.action) ||
      JSON.stringify(item);
    return { name, description };
  }
  return { name: "Requirement", description: String(item) };
}

function pickRawScope(rawResult: unknown): string | null {
  if (!rawResult || typeof rawResult !== "object") return null;
  const record = rawResult as Record<string, unknown>;
  const keys = [
    "scopeOfWork",
    "scope_of_work",
    "scope",
    "workScope",
    "scopeSummary",
    "scope_summary",
  ];
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}

export function deriveScopeText(
  description: string | null,
  qualification: Record<string, unknown> | null,
): string | null {
  const fromRaw = pickRawScope(qualification?.raw_result);
  if (fromRaw) return fromRaw;
  const fromSummary = asString(qualification?.verdict);
  if (fromSummary && fromSummary.length > 40) return fromSummary;
  return description;
}

export function mapArchiveDocuments(
  qualification: Record<string, unknown> | null,
  archiveAvailable: boolean,
  tender?: Record<string, unknown> | null,
): TenderArchiveDocument[] {
  const files: TenderArchiveDocument[] = [];
  const documentsZipUrl = asString(tender?.documents_zip_url);
  const aiSummaryUrl = asString(tender?.ai_summary_url);

  if (documentsZipUrl) {
    files.push({
      name: "Tender_All_Documents.zip",
      kind: "Tender Documents",
      sizeLabel: null,
      downloadable: true,
      url: toAccessibleStorageUrl(documentsZipUrl, {
        download: true,
        fileName: "Tender_All_Documents.zip",
      }),
    });
  }
  if (aiSummaryUrl) {
    files.push({
      name: "AI_Summary.pdf",
      kind: "AI Summary PDF",
      sizeLabel: null,
      downloadable: true,
      url: toAccessibleStorageUrl(aiSummaryUrl, {
        fileName: "AI_Summary.pdf",
      }),
    });
  }

  if (files.length > 0) return files;

  for (const item of jsonArray(qualification?.evidence_files)) {
    if (typeof item !== "string" || !item.trim()) continue;
    files.push({
      name: item.trim(),
      kind: "Evidence",
      sizeLabel: null,
      downloadable: false,
      url: null,
    });
  }
  if (files.length === 0 && archiveAvailable) {
    files.push({
      name: "Tender document archive",
      kind: "Archive",
      sizeLabel: null,
      downloadable: false,
      url: null,
    });
  }
  return files;
}

export function mapExtractedRequirements(
  qualification: Record<string, unknown> | null,
): ExtractedRequirement[] {
  if (!qualification) return [];
  const groups: Array<{
    group: ExtractedRequirement["group"];
    matched: boolean | null;
    items: unknown[];
  }> = [
    { group: "matched", matched: true, items: jsonArray(qualification.matched_criteria) },
    { group: "failed", matched: false, items: jsonArray(qualification.failed_criteria) },
    { group: "unclear", matched: null, items: jsonArray(qualification.unclear_criteria) },
    { group: "missing", matched: false, items: jsonArray(qualification.missing_documents) },
  ];

  const out: ExtractedRequirement[] = [];
  groups.forEach((entry, groupIndex) => {
    entry.items.forEach((item, index) => {
      const text = criterionText(item);
      out.push({
        id: `${entry.group}-${groupIndex}-${index}`,
        name: text.name,
        description: text.description,
        group: entry.group,
        matched: entry.matched,
      });
    });
  });
  return out;
}

export function mapQualification(
  qualification: Record<string, unknown> | null,
): TenderQualificationDTO | null {
  if (!qualification) return null;
  const status = asString(qualification.status);
  if (!isTenderStatus(status)) return null;
  return {
    id: String(qualification.id),
    status,
    decisionLabel: asString(qualification.decision_label),
    verdict: asString(qualification.verdict),
    reason: asString(qualification.reason),
    requiredAction: asString(qualification.required_action),
    confidence: asNumber(qualification.confidence),
    qualifiedAt: asString(qualification.qualified_at),
    modelName: asString(qualification.model_name),
    promptVersion: asString(qualification.prompt_version),
    chatUrl: asString(qualification.chat_url),
    manualReviewRequired: Boolean(qualification.manual_review_required),
    matchedCriteria: jsonArray(qualification.matched_criteria),
    failedCriteria: jsonArray(qualification.failed_criteria),
    unclearCriteria: jsonArray(qualification.unclear_criteria),
    missingDocuments: jsonArray(qualification.missing_documents),
    conditions: jsonArray(qualification.conditions),
    partnershipRequiredFor: jsonArray(qualification.partnership_required_for),
    partnershipModeAllowed: jsonArray(qualification.partnership_mode_allowed),
    evidenceFiles: jsonArray(qualification.evidence_files),
    rawResult: qualification.raw_result ?? null,
  };
}

export function mapTenderDetail(options: {
  tender: Record<string, unknown>;
  qualification: Record<string, unknown> | null;
  submitted: boolean;
  workspaceId: string | null;
  activity: TenderDetailDTO["activity"];
}): TenderDetailDTO {
  const { tender, qualification } = options;
  const title = asString(tender.title) || "Untitled tender";
  const description = asString(tender.description);
  const portal = asString(tender.source_portal);
  const sourcePortal: TenderSource =
    portal === "BIDASSIST"
      ? "BIDASSIST"
      : portal === "MANUAL"
        ? "MANUAL"
        : "TENDER247";
  const qualStatus =
    (asString(qualification?.status) as TenderStatus | null) ??
    (asString(tender.qualification_status) as TenderStatus | null);
  const qualificationStatus = isTenderStatus(qualStatus) ? qualStatus : null;
  const location =
    asString(tender.location_text) ||
    [asString(tender.city), asString(tender.state)].filter(Boolean).join(", ") ||
    null;

  const rawMeta =
    tender.raw_metadata && typeof tender.raw_metadata === "object"
      ? (tender.raw_metadata as Record<string, unknown>)
      : {};
  const contactsRaw = Array.isArray(rawMeta.contacts) ? rawMeta.contacts : [];
  const contacts = contactsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const c = item as Record<string, unknown>;
      const name = asString(c.name);
      const mobile = asString(c.mobile);
      if (!name || !mobile) return null;
      return {
        name,
        mobile,
        email: asString(c.email),
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    mobile: string;
    email?: string | null;
  }>;

  const exemptionTypes = Array.isArray(rawMeta.exemptionTypes)
    ? rawMeta.exemptionTypes.filter((v): v is string => typeof v === "string")
    : [];

  return {
    id: String(tender.id),
    title,
    organization: asString(tender.organization),
    authority: asString(tender.authority) || asString(tender.organization),
    department: asString(tender.department),
    sourcePortal,
    sourceTenderId: asString(tender.source_tender_id) || String(tender.id),
    folderId: asString(tender.folder_id),
    sourceUrl: asString(tender.source_url),
    projectCategory: asString(tender.project_category),
    sourceCategory: asString(tender.category),
    tenderType: asString(tender.tender_type),
    qualificationStatus,
    description,
    scopeText: deriveScopeText(description, qualification),
    location,
    state: asString(tender.state),
    city: asString(tender.city),
    tenderValue: asNumber(tender.tender_value),
    tenderValueText: asString(tender.tender_value_text),
    emdAmount: asNumber(tender.emd_amount),
    emdText: asString(tender.emd_text),
    publishedDate: asString(tender.published_date),
    closingDate: asString(tender.closing_date),
    openingDate: asString(tender.opening_date),
    bidSubmissionDate: asString(tender.bid_submission_date),
    documentArchiveAvailable: Boolean(tender.document_archive_available),
    aiSummaryAvailable: Boolean(tender.ai_summary_available),
    downloadStatus: asString(tender.download_status),
    firstSeenAt: asString(tender.first_seen_at),
    crawledAt: asString(tender.crawled_at),
    scrapedDate: asString(tender.scraped_date),
    createdAt: asString(tender.created_at),
    updatedAt: asString(tender.updated_at),
    prescreenStatus: asString(tender.prescreen_status),
    prescreenReason: asString(tender.prescreen_reason),
    prescreenReasonCode: asString(tender.prescreen_reason_code),
    chatgptEligible: asBoolean(tender.chatgpt_eligible),
    decisionSource: asString(tender.decision_source),
    prescreenRulesVersion: asString(tender.prescreen_rules_version),
    prescreenedAt: asString(tender.prescreened_at),
    submitted: options.submitted,
    workspaceId: options.workspaceId,
    qualification: mapQualification(qualification),
    archiveDocuments: mapArchiveDocuments(
      qualification,
      Boolean(tender.document_archive_available),
      tender,
    ),
    activity: options.activity,
    extractedRequirements: mapExtractedRequirements(qualification),
    tenderEstCost: asNumber(rawMeta.tenderEstCost),
    tenderFee: asNumber(rawMeta.tenderFee),
    processingFee: asNumber(rawMeta.processingFee),
    finalCost: asNumber(rawMeta.finalCost),
    msmeExemption: Boolean(rawMeta.msmeExemption),
    startupExemption: Boolean(rawMeta.startupExemption),
    exemptionTypes,
    contacts,
    notes: asString(rawMeta.notes),
    decisionReason: asString(rawMeta.decisionReason) || asString(qualification?.reason),
    lostReason: asString(rawMeta.lostReason),
    disqualificationReason: asString(rawMeta.disqualificationReason),
  };
}
