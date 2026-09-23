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

export async function indexCompanyDocument(options: {
  companyId: string;
  documentId: string;
}): Promise<IndexSourceResult> {
  const enabled = await isAiIndexEnabled(options.documentId);
  if (!enabled) {
    await excludeDocumentSource({
      sourceType: "COMPANY_DOCUMENT",
      sourceId: companyDocumentSourceId(options.documentId),
      companyId: options.companyId,
    });
    return {
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
    };
  }

  const doc = await getCompanyDocumentById({
    companyId: options.companyId,
    documentId: options.documentId,
  });
  if (!doc) throw new Error("Company document not found.");
  if (!INDEXABLE_CATEGORIES.has(doc.documentCategory)) {
    return {
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
    };
  }

  const descriptor: IndexableSourceDescriptor = {
    sourceType: "COMPANY_DOCUMENT",
    sourceId: companyDocumentSourceId(doc.id),
    companyId: options.companyId,
    tenderId: null,
    documentName: doc.name,
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

  return indexDocumentSource(descriptor);
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
      }),
    );
  }
  return results;
}
