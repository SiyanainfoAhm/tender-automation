import "server-only";

import {
  excludeDocumentSource,
  indexDocumentSource,
} from "@/server/ai/rag/document-ingestion";
import type {
  IndexableSourceDescriptor,
  IndexSourceResult,
} from "@/server/ai/rag/types";
import {
  getCompanyBidPreferences,
  getCompanyById,
} from "@/server/repositories/companyRepository";
import {
  getCompanyDocumentById,
  listCompanyDocuments,
} from "@/server/repositories/documentRepository";
import { listCompanyExperience } from "@/server/repositories/experienceRepository";
import { getServerSupabase } from "@/lib/db/server";

function companyProfileSourceId(companyId: string): string {
  return `company_profile:${companyId}`;
}

function companyDocumentInventorySourceId(companyId: string): string {
  return `company_document_inventory:${companyId}`;
}

function companyDocumentSourceId(documentId: string): string {
  return documentId;
}

/** Categories that are useful as bid evidence (exclude vague "Other" dumps by default). */
const INDEXABLE_CATEGORIES = new Set([
  "Certificate",
  "Financial",
  "Experience",
  "GST",
  "PAN",
  "Bank Guarantee",
  "General",
]);

export async function buildCompanyProfileText(companyId: string): Promise<string> {
  const [company, preferences, experience] = await Promise.all([
    getCompanyById(companyId),
    getCompanyBidPreferences(companyId).catch(() => null),
    listCompanyExperience(companyId).catch(() => []),
  ]);
  if (!company) throw new Error("Company not found.");

  const lines: string[] = [
    `Company Profile: ${company.name}`,
    company.industryType ? `Industry: ${company.industryType}` : "",
    company.businessLocation ? `Location: ${company.businessLocation}` : "",
    company.yearEstablished
      ? `Year established: ${company.yearEstablished}`
      : "",
    company.website ? `Website: ${company.website}` : "",
    company.description ? `Description: ${company.description}` : "",
  ];

  if (preferences) {
    lines.push("Bid preferences:");
    if (preferences.maxEmdInr != null) {
      lines.push(`- Max EMD (INR): ${preferences.maxEmdInr}`);
    }
    if (preferences.minTenderValueInr != null) {
      lines.push(`- Min tender value (INR): ${preferences.minTenderValueInr}`);
    }
    if (preferences.maxTenderValueInr != null) {
      lines.push(`- Max tender value (INR): ${preferences.maxTenderValueInr}`);
    }
    if (preferences.serviceScope.length) {
      lines.push(`- Service scope: ${preferences.serviceScope.join("; ")}`);
    }
    if (preferences.excludedScope.length) {
      lines.push(`- Excluded scope: ${preferences.excludedScope.join("; ")}`);
    }
  }

  if (experience.length) {
    lines.push("Documented experience projects:");
    for (const item of experience.slice(0, 40)) {
      lines.push(
        [
          `- ${item.projectName}`,
          item.clientName ? `client=${item.clientName}` : null,
          item.projectType ? `type=${item.projectType}` : null,
          item.natureOfWork ? `nature=${item.natureOfWork}` : null,
          item.projectValueInr != null ? `value_inr=${item.projectValueInr}` : null,
          item.projectStatus ? `status=${item.projectStatus}` : null,
          item.startDate || item.endDate
            ? `period=${item.startDate || "?"}–${item.endDate || "?"}`
            : null,
          item.workOrderFileName
            ? `work_order=${item.workOrderFileName}`
            : null,
          item.completionCertificateFileName
            ? `completion_cert=${item.completionCertificateFileName}`
            : null,
          item.description ? `notes=${item.description}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Safe catalogue metadata for the Company Documents library. This deliberately
 * exposes availability/counts to Ask AI without treating file names or metadata
 * as proof that a tender requirement is met.
 */
export async function buildCompanyDocumentInventoryText(companyId: string): Promise<string> {
  const docs = await listCompanyDocuments({ companyId });
  const byCategory = new Map<string, number>();
  for (const doc of docs) {
    byCategory.set(doc.documentCategory, (byCategory.get(doc.documentCategory) || 0) + 1);
  }
  const lines = [
    "Company Documents Inventory (catalogue metadata; not document-content evidence).",
    `Active reusable company documents: ${docs.length}.`,
    byCategory.size ? `Categories: ${[...byCategory.entries()].map(([category, count]) => `${category} (${count})`).join(", ")}.` : "Categories: none.",
    "Document list:",
  ];
  for (const doc of docs.slice(0, 200)) {
    lines.push([
      `- ${doc.name}`,
      `category=${doc.documentCategory}`,
      doc.documentType ? `type=${doc.documentType}` : null,
      doc.certificateType ? `certificate=${doc.certificateType}` : null,
      doc.financialYear ? `financial_year=${doc.financialYear}` : null,
      doc.expiryDate ? `expiry=${doc.expiryDate}` : null,
      `verification=${doc.verificationStatus}`,
      doc.storageUrl ? "file_available=yes" : "file_available=no",
    ].filter(Boolean).join(" | "));
  }
  return lines.join("\n");
}

async function isAiIndexEnabled(documentId: string): Promise<boolean> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_documents")
    .select("ai_index_enabled, status")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  if (String(data.status) !== "active") return false;
  return data.ai_index_enabled !== false;
}

export async function indexCompanyProfile(
  companyId: string,
): Promise<IndexSourceResult> {
  const text = await buildCompanyProfileText(companyId);
  return indexDocumentSource({
    sourceType: "COMPANY_PROFILE",
    sourceId: companyProfileSourceId(companyId),
    companyId,
    tenderId: null,
    documentName: "Company Profile",
    documentUrl: null,
    documentType: "profile",
    section: "company_profile",
    fetch: { kind: "profile_text", text },
    metadata: { origin: "company_profile" },
  });
}

export async function indexCompanyDocumentInventory(companyId: string): Promise<IndexSourceResult> {
  const text = await buildCompanyDocumentInventoryText(companyId);
  return indexDocumentSource({
    sourceType: "COMPANY_PROFILE",
    sourceId: companyDocumentInventorySourceId(companyId),
    companyId,
    tenderId: null,
    documentName: "Company Documents Inventory",
    documentUrl: null,
    documentType: "company_document_inventory",
    section: "company_documents_inventory",
    fetch: { kind: "profile_text", text },
    metadata: { origin: "company_document_inventory", catalogue_only: true },
  });
}

export async function indexCompanyDocument(options: {
  companyId: string;
  documentId: string;
  /** Batch callers refresh the inventory once after all documents finish. */
  refreshInventory?: boolean;
}): Promise<IndexSourceResult> {
  const enabled = await isAiIndexEnabled(options.documentId);
  if (!enabled) {
    await excludeDocumentSource({
      sourceType: "COMPANY_DOCUMENT",
      sourceId: companyDocumentSourceId(options.documentId),
      companyId: options.companyId,
    });
    const skipped = {
      sourceType: "COMPANY_DOCUMENT",
      sourceId: companyDocumentSourceId(options.documentId),
      status: "SKIPPED_DISABLED",
      chunkCount: 0,
      contentHash: null,
      skipped: true,
      timings: {
        fetchMs: 0,
        extractMs: 0,
        chunkMs: 0,
        embeddingMs: 0,
        dbWriteMs: 0,
        totalMs: 0,
      },
    } satisfies IndexSourceResult;
    if (options.refreshInventory !== false) {
      await indexCompanyDocumentInventory(options.companyId);
    }
    return skipped;
  }

  const doc = await getCompanyDocumentById({
    companyId: options.companyId,
    documentId: options.documentId,
  });
  if (!doc) throw new Error("Company document not found.");
  if (!INDEXABLE_CATEGORIES.has(doc.documentCategory)) {
    const skipped = {
      sourceType: "COMPANY_DOCUMENT",
      sourceId: companyDocumentSourceId(doc.id),
      status: "SKIPPED_DISABLED",
      chunkCount: 0,
      contentHash: null,
      skipped: true,
      timings: {
        fetchMs: 0,
        extractMs: 0,
        chunkMs: 0,
        embeddingMs: 0,
        dbWriteMs: 0,
        totalMs: 0,
      },
    } satisfies IndexSourceResult;
    if (options.refreshInventory !== false) {
      await indexCompanyDocumentInventory(options.companyId);
    }
    return skipped;
  }

  const descriptor: IndexableSourceDescriptor = {
    sourceType: "COMPANY_DOCUMENT",
    sourceId: companyDocumentSourceId(doc.id),
    companyId: options.companyId,
    tenderId: null,
    // Display names frequently omit extensions; extraction must receive the
    // original uploaded filename so it can select the correct parser.
    documentName: doc.originalFileName || doc.name,
    documentUrl: doc.storageUrl,
    documentType: doc.documentType || doc.documentCategory,
    section: doc.documentCategory,
    fetch: {
      kind: "company_document",
      documentId: doc.id,
      companyId: options.companyId,
    },
    metadata: {
      document_category: doc.documentCategory,
      certificate_type: doc.certificateType,
      financial_year: doc.financialYear,
    },
  };

  const result = await indexDocumentSource(descriptor);
  if (options.refreshInventory !== false) {
    await indexCompanyDocumentInventory(options.companyId);
  }
  return result;
}

/** Index profile + enabled company library documents. */
export async function indexCompanyKnowledge(
  companyId: string,
): Promise<IndexSourceResult[]> {
  const results: IndexSourceResult[] = [];
  results.push(await indexCompanyProfile(companyId));

  const docs = await listCompanyDocuments({ companyId });
  for (const doc of docs) {
    if (!INDEXABLE_CATEGORIES.has(doc.documentCategory)) continue;
    results.push(
      await indexCompanyDocument({
        companyId,
        documentId: doc.id,
        refreshInventory: false,
      }),
    );
  }
  results.push(await indexCompanyDocumentInventory(companyId));
  return results;
}
