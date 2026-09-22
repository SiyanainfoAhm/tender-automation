import "server-only";

import { ingestDocumentBytes } from "@/server/ingestion/extractFiles";
import { resolveTenderArtifactUrls } from "@/lib/tenders/resolve-document-urls";
import { isSharePointUrl } from "@/lib/storage/accessible-storage-url";
import { listTenderDocuments } from "@/server/repositories/bidFeeRepository";
import { getCompanyById, getCompanyBidPreferences } from "@/server/repositories/companyRepository";
import { listCompanyDocuments } from "@/server/repositories/documentRepository";
import { listCompanyExperience } from "@/server/repositories/experienceRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { invokeBlobRead, invokeDocumentRead } from "@/server/storage/tenderAutomationDocumentFunctions";

export type TenderAiSource = {
  documentId: string | null;
  fileName: string;
  section: string | null;
  text: string;
  pageCount: number | null;
  unavailable?: boolean;
};

export type TenderAiContext = {
  tender: Record<string, unknown>;
  company: Record<string, unknown>;
  qualification: Record<string, unknown> | null;
  documents: TenderAiSource[];
  warnings: string[];
};

const MAX_TENDER_SOURCES = 5;
const MAX_COMPANY_SOURCES = 3;
const MAX_CONTEXT_CHARS = 60_000;
const cachedExtraction = new Map<string, { expiresAt: number; sources: TenderAiSource[]; warnings: string[] }>();

function readableName(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function keywords(question: string): string[] {
  return question.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
}

function selectRelevantText(text: string, question: string): string {
  const terms = keywords(question);
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter((block) => block.length > 50);
  const ranked = blocks
    .map((block) => ({
      block,
      score: terms.reduce((score, term) => score + (block.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  const selected = (ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0) : ranked)
    .slice(0, 30)
    .map((item) => item.block)
    .join("\n\n");
  return selected.slice(0, 18_000);
}

async function readSharePoint(url: string, fileName: string, tenderId?: string): Promise<Buffer> {
  const response = await invokeBlobRead({
    storageUrl: url,
    disposition: "attachment",
    fileName,
    tenderId,
  });
  if (!response.ok) throw new Error(`SharePoint returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function extractTenderSource(options: {
  fileName: string;
  url: string;
  documentId?: string | null;
  section?: string | null;
  tenderId: string;
}): Promise<TenderAiSource> {
  const bytes = await readSharePoint(options.url, options.fileName, options.tenderId);
  const files = await ingestDocumentBytes({ fileName: options.fileName, bytes });
  const text = files
    .filter((file) => file.text?.trim())
    .map((file) => `--- ${file.fileName} ---\n${file.text!.trim()}`)
    .join("\n\n");
  return {
    documentId: options.documentId || null,
    fileName: options.fileName,
    section: options.section || null,
    text,
    pageCount: files.find((file) => file.pageCount != null)?.pageCount ?? null,
    unavailable: !text.trim(),
  };
}

function tenderMetadata(tender: Record<string, unknown>): Record<string, unknown> {
  const fields = [
    "id", "source_tender_id", "reference_no", "folder_id", "title", "organization", "department", "authority",
    "category", "project_category", "tender_type", "description", "city", "state", "location_text", "published_date",
    "closing_date", "bid_submission_date", "tender_value", "emd_amount", "currency", "qualification_status", "status",
    "prescreen_status", "prescreen_reason", "raw_metadata",
  ];
  return Object.fromEntries(fields.filter((field) => tender[field] != null).map((field) => [field, tender[field]]));
}

/** Builds grounded, scoped context. All storage and extraction stay on the server. */
export async function buildTenderAiContext(options: {
  tenderId: string;
  companyId: string;
  question: string;
}): Promise<TenderAiContext> {
  const loaded = await getTenderById(options.tenderId);
  if (!loaded) throw new Error("Tender not found.");
  const tender = loaded.tender;
  const warnings: string[] = [];
  const [company, preferences, experience, companyDocuments, tenderDocuments] = await Promise.all([
    getCompanyById(options.companyId),
    getCompanyBidPreferences(options.companyId).catch(() => null),
    listCompanyExperience(options.companyId).catch(() => []),
    listCompanyDocuments({ companyId: options.companyId }).catch(() => []),
    listTenderDocuments({ companyId: options.companyId, tenderId: options.tenderId }).catch(() => []),
  ]);
  if (!company) throw new Error("Company profile not found.");

  const artifacts = resolveTenderArtifactUrls({
    document_urls: tender.document_urls,
    documents_zip_url: typeof tender.documents_zip_url === "string" ? tender.documents_zip_url : null,
  });
  const candidates: Array<{ fileName: string; url: string; documentId: string | null; section: string | null }> = [];
  if (artifacts.documentsZipUrl) {
    candidates.push({ fileName: "Tender_All_Documents.zip", url: artifacts.documentsZipUrl, documentId: null, section: "portal_archive" });
  }
  for (const doc of tenderDocuments) {
    if (!doc.storageUrl || !isSharePointUrl(doc.storageUrl)) continue;
    candidates.push({ fileName: readableName(doc.originalName, doc.fileName), url: doc.storageUrl, documentId: doc.id, section: doc.section });
  }
  const unique = candidates.filter((candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index).slice(0, MAX_TENDER_SOURCES);
  const cacheKey = unique.map((source) => source.url).join("|");
  const cached = cachedExtraction.get(cacheKey);
  let documents: TenderAiSource[] = [];
  if (cached && cached.expiresAt > Date.now()) {
    documents = cached.sources;
    warnings.push(...cached.warnings);
  } else {
    for (const source of unique) {
      try {
        documents.push(await extractTenderSource({ ...source, tenderId: options.tenderId }));
      } catch {
        warnings.push(`The tender document “${source.fileName}” could not be retrieved from SharePoint.`);
        documents.push({ documentId: source.documentId, fileName: source.fileName, section: source.section, text: "", pageCount: null, unavailable: true });
      }
    }
    cachedExtraction.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, sources: documents, warnings: [...warnings] });
  }
  if (unique.length === 0) warnings.push("No accessible tender documents are linked to this tender.");

  const fullAssessment = /\b(assess|assessment|complete eligibility)\b/i.test(options.question);
  const companyEvidence = await Promise.all(companyDocuments
    .filter((doc) => fullAssessment || keywords(options.question).some((term) => [doc.name, doc.documentType, doc.certificateType, doc.documentCategory].filter(Boolean).join(" ").toLowerCase().includes(term)))
    .slice(0, MAX_COMPANY_SOURCES)
    .map(async (doc) => {
      try {
        const response = await invokeDocumentRead(doc.id, "attachment");
        if (!response.ok) return { name: doc.name, text: "", unavailable: true };
        const files = await ingestDocumentBytes({ fileName: readableName(doc.originalFileName, doc.name), bytes: Buffer.from(await response.arrayBuffer()) });
        return { name: doc.name, text: files.map((file) => file.text || "").filter(Boolean).join("\n").slice(0, 8_000), unavailable: false };
      } catch {
        return { name: doc.name, text: "", unavailable: true };
      }
    }));

  const companyContext = {
    company: { name: company.name, industryType: company.industryType, businessLocation: company.businessLocation, website: company.website, yearEstablished: company.yearEstablished, description: company.description },
    bidPreferences: preferences ? { maxEmdInr: preferences.maxEmdInr, minTenderValueInr: preferences.minTenderValueInr, maxTenderValueInr: preferences.maxTenderValueInr, serviceScope: preferences.serviceScope, excludedScope: preferences.excludedScope, screeningPolicies: preferences.screeningPolicies } : null,
    experience: experience.map((item) => ({ projectName: item.projectName, clientName: item.clientName, projectType: item.projectType, natureOfWork: item.natureOfWork, projectValueInr: item.projectValueInr, projectStatus: item.projectStatus, startDate: item.startDate, endDate: item.endDate, description: item.description, workOrderFileName: item.workOrderFileName, completionCertificateFileName: item.completionCertificateFileName })),
    supportingDocuments: companyDocuments.map((doc) => ({ name: doc.name, category: doc.documentCategory, documentType: doc.documentType, certificateType: doc.certificateType, financialYear: doc.financialYear, verificationStatus: doc.verificationStatus, expiryState: doc.expiryState })),
    selectedSupportingText: companyEvidence,
  };

  return { tender: tenderMetadata(tender), company: companyContext as Record<string, unknown>, qualification: loaded.qualification, documents: documents.map((doc) => ({ ...doc, text: selectRelevantText(doc.text, options.question) })).filter((doc) => Boolean(doc.text) || doc.unavailable), warnings };
}

export function formatTenderAiContext(context: TenderAiContext): string {
  const documentText = context.documents.map((doc) => `SOURCE: ${doc.fileName}${doc.pageCount ? ` (PDF pages: ${doc.pageCount})` : ""}\n${doc.unavailable ? "Text could not be extracted from this document." : doc.text}`).join("\n\n");
  return JSON.stringify({ tender: context.tender, company: context.company, previousAssessment: context.qualification, tenderDocuments: documentText, retrievalWarnings: context.warnings }, null, 2).slice(0, MAX_CONTEXT_CHARS);
}
