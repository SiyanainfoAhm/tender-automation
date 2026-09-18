import "server-only";

import { normalizeMatchText } from "@/lib/bid-checklist";
import { getServerSupabase } from "@/lib/db/server";
import { ingestDocumentBytes } from "@/server/ingestion/extractFiles";
import { resolveTenderSourceDocuments } from "@/server/ingestion/resolveTenderSourceDocuments";
import { getCompanyById, getCompanyBidPreferences } from "@/server/repositories/companyRepository";
import { listCompanyDocuments } from "@/server/repositories/documentRepository";
import { listCompanyExperience } from "@/server/repositories/experienceRepository";
import { invokeBlobRead } from "@/server/storage/tenderAutomationDocumentFunctions";

const RELATED_CONTEXT_KEYWORDS = [
  "scope of work",
  "scope",
  "functional requirement",
  "technical requirement",
  "deliverable",
  "implementation",
  "schedule",
  "sla",
  "milestone",
  "evaluation",
  "manpower",
  "team",
  "security",
  "integration",
  "methodology",
  "approach",
  "eligibility",
  "qualification",
];

function resolveStorageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith("/api/storage/blob")) return trimmed;
  try {
    const parsed = new URL(trimmed, "http://localhost");
    const nested = parsed.searchParams.get("url");
    return nested?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const storageUrl = resolveStorageUrl(url);
  try {
    const edge = await invokeBlobRead({
      storageUrl,
      disposition: "attachment",
    });
    if (edge.ok) {
      const ab = await edge.arrayBuffer();
      return Buffer.from(ab);
    }
  } catch {
    // fall through
  }
  if (storageUrl.startsWith("/")) {
    throw new Error("Failed to download tender document via storage proxy");
  }
  const res = await fetch(storageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download tender document (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function pickRelevantChunks(corpus: string, requirementName: string): string {
  const needles = [
    ...RELATED_CONTEXT_KEYWORDS,
    ...normalizeMatchText(requirementName).split(" ").filter((w) => w.length > 3),
  ];
  const blocks = corpus
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 40);
  const scored = blocks
    .map((block) => {
      const hay = normalizeMatchText(block);
      const score = needles.reduce(
        (acc, n) => (n && hay.includes(n) ? acc + 1 : acc),
        0,
      );
      return { block, score };
    })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = (scored.length ? scored : blocks.slice(0, 12).map((block) => ({
    block,
    score: 0,
  })))
    .slice(0, 40)
    .map((s) => s.block);

  return selected.join("\n\n").slice(0, 80_000);
}

export type GenerationContextBundle = {
  tender: {
    id: string;
    title: string;
    reference: string;
    organization: string | null;
    authority: string | null;
    description: string | null;
    scopeText: string | null;
    deadline: string | null;
    tenderValue: number | null;
    emdAmount: number | null;
  };
  requirement: {
    id: string;
    key: string;
    name: string;
    category: string;
    description: string | null;
    mandatory: boolean;
    documentType: string | null;
    sourcePage: number | null;
    sourceClause: string | null;
    sourceText: string | null;
    generationAllowed: boolean;
  };
  relatedChecklistSources: Array<{
    key: string;
    name: string;
    sourceClause: string | null;
    sourcePage: number | null;
    sourceText: string | null;
  }>;
  qualificationSummary: string | null;
  rfpContextText: string;
  sourceDocumentNames: string[];
  company: {
    name: string;
    industryType: string | null;
    businessLocation: string | null;
    website: string | null;
    yearEstablished: number | null;
    description: string | null;
    serviceScope: string[];
  };
  companyDocuments: Array<{
    name: string;
    category: string;
    certificateType: string | null;
    documentType: string | null;
    verificationStatus: string;
    expiryState: string;
  }>;
  companyExperience: Array<{
    projectName: string;
    clientName: string;
    location: string;
    projectType: string;
    natureOfWork: string[];
    projectValueInr: number;
    projectStatus: string;
    description: string | null;
  }>;
};

export async function buildGenerationContext(options: {
  companyId: string;
  workspaceId: string;
  tenderId: string;
  requirementId: string;
}): Promise<GenerationContextBundle> {
  const supabase = getServerSupabase();

  const { data: item, error: itemError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("*")
    .eq("id", options.requirementId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item) throw new Error("Checklist requirement not found.");

  const { data: tender, error: tenderError } = await supabase
    .from("agenttender_tenders")
    .select(
      "id, title, source_tender_id, reference_no, organization, authority, description, closing_date, tender_value, emd_amount, documents_zip_url, document_urls",
    )
    .eq("id", options.tenderId)
    .maybeSingle();
  if (tenderError) throw new Error(tenderError.message);
  if (!tender) throw new Error("Tender not found.");

  const { data: qualification } = await supabase
    .from("agenttender_qualification_results")
    .select("verdict, reason, raw_result, missing_documents")
    .eq("tender_id", options.tenderId)
    .maybeSingle();

  const { data: relatedRows } = await supabase
    .from("agenttender_bid_checklist_items")
    .select(
      "requirement_key, requirement_name, source_clause, source_page, source_text",
    )
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .order("display_order", { ascending: true });

  const company = await getCompanyById(options.companyId);
  if (!company) throw new Error("Company not found.");
  const prefs = await getCompanyBidPreferences(options.companyId).catch(() => null);
  const companyDocuments = await listCompanyDocuments({
    companyId: options.companyId,
  });
  const experience = await listCompanyExperience(options.companyId).catch(() => []);

  let rfpContextText = "";
  const sourceDocumentNames: string[] = [];
  try {
    const { resolveTenderArtifactUrls } = await import(
      "@/lib/tenders/resolve-document-urls"
    );
    const artifacts = resolveTenderArtifactUrls({
      document_urls: tender.document_urls,
      documents_zip_url: tender.documents_zip_url,
    });
    const sources = await resolveTenderSourceDocuments({
      tenderId: options.tenderId,
      companyId: options.companyId,
      workspaceId: options.workspaceId,
      documentsZipUrl: artifacts.documentsZipUrl,
    });
    const texts: string[] = [];
    for (const source of sources.slice(0, 4)) {
      sourceDocumentNames.push(source.fileName);
      try {
        const bytes = await fetchUrlBytes(source.url);
        const ingested = await ingestDocumentBytes({
          fileName: source.fileName,
          bytes,
        });
        for (const file of ingested) {
          if (file.text?.trim()) {
            texts.push(`--- ${file.fileName} ---\n${file.text}`);
          }
        }
      } catch {
        // keep going with other sources / qualification text
      }
    }
    const corpus = texts.join("\n\n");
    rfpContextText = pickRelevantChunks(
      corpus,
      String(item.requirement_name || ""),
    );
  } catch {
    rfpContextText = "";
  }

  const rawResult =
    qualification?.raw_result && typeof qualification.raw_result === "object"
      ? JSON.stringify(qualification.raw_result).slice(0, 20_000)
      : null;

  const scopeFromRaw =
    qualification?.raw_result &&
    typeof qualification.raw_result === "object" &&
    (() => {
      const record = qualification.raw_result as Record<string, unknown>;
      for (const key of [
        "scopeOfWork",
        "scope_of_work",
        "scope",
        "workScope",
        "scopeSummary",
      ]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return null;
    })();

  if (!rfpContextText.trim()) {
    rfpContextText = [
      typeof tender.description === "string" ? tender.description : "",
      scopeFromRaw || "",
      typeof qualification?.verdict === "string" ? qualification.verdict : "",
      typeof qualification?.reason === "string" ? qualification.reason : "",
      rawResult || "",
      typeof item.source_text === "string" ? item.source_text : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 80_000);
  }

  return {
    tender: {
      id: String(tender.id),
      title: String(tender.title || "Tender"),
      reference: String(
        tender.source_tender_id || tender.reference_no || tender.id,
      ),
      organization:
        typeof tender.organization === "string" ? tender.organization : null,
      authority: typeof tender.authority === "string" ? tender.authority : null,
      description:
        typeof tender.description === "string" ? tender.description : null,
      scopeText: scopeFromRaw,
      deadline:
        typeof tender.closing_date === "string"
          ? tender.closing_date
          : null,
      tenderValue:
        tender.tender_value == null ? null : Number(tender.tender_value),
      emdAmount: tender.emd_amount == null ? null : Number(tender.emd_amount),
    },
    requirement: {
      id: String(item.id),
      key: String(item.requirement_key),
      name: String(item.requirement_name),
      category: String(item.category || "COMPLIANCE"),
      description: item.description ? String(item.description) : null,
      mandatory: item.mandatory !== false,
      documentType: item.document_type ? String(item.document_type) : null,
      sourcePage: item.source_page == null ? null : Number(item.source_page),
      sourceClause: item.source_clause ? String(item.source_clause) : null,
      sourceText: item.source_text ? String(item.source_text) : null,
      generationAllowed: item.generation_allowed === true,
    },
    relatedChecklistSources: (relatedRows || [])
      .filter((row) => row.source_text || row.source_clause)
      .slice(0, 40)
      .map((row) => ({
        key: String(row.requirement_key),
        name: String(row.requirement_name),
        sourceClause: row.source_clause ? String(row.source_clause) : null,
        sourcePage: row.source_page == null ? null : Number(row.source_page),
        sourceText: row.source_text ? String(row.source_text) : null,
      })),
    qualificationSummary:
      typeof qualification?.verdict === "string" ? qualification.verdict : null,
    rfpContextText,
    sourceDocumentNames,
    company: {
      name: company.name,
      industryType: company.industryType,
      businessLocation: company.businessLocation,
      website: company.website,
      yearEstablished: company.yearEstablished,
      description: company.description,
      serviceScope: prefs?.serviceScope || [],
    },
    companyDocuments: companyDocuments.slice(0, 80).map((doc) => ({
      name: doc.name,
      category: doc.documentCategory,
      certificateType: doc.certificateType,
      documentType: doc.documentType,
      verificationStatus: doc.verificationStatus,
      expiryState: doc.expiryState,
    })),
    companyExperience: experience.slice(0, 30).map((exp) => ({
      projectName: exp.projectName,
      clientName: exp.clientName,
      location: exp.location,
      projectType: exp.projectType,
      natureOfWork: exp.natureOfWork,
      projectValueInr: exp.projectValueInr,
      projectStatus: exp.projectStatus,
      description: exp.description,
    })),
  };
}

export function formatContextForPrompt(bundle: GenerationContextBundle): string {
  return JSON.stringify(
    {
      tender: bundle.tender,
      requirement: bundle.requirement,
      related_checklist_sources: bundle.relatedChecklistSources,
      qualification_summary: bundle.qualificationSummary,
      source_document_names: bundle.sourceDocumentNames,
      rfp_relevant_excerpts: bundle.rfpContextText.slice(0, 60_000),
      company_profile: bundle.company,
      company_documents_inventory: bundle.companyDocuments,
      company_past_experience: bundle.companyExperience,
      notes: [
        "Company documents listed above are evidence inventory only.",
        "Do not invent facts beyond these records.",
        "Generated output must remain tender-scoped (never a company-library document).",
      ],
    },
    null,
    2,
  );
}
