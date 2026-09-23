import "server-only";

import { isSharePointUrl } from "@/lib/storage/accessible-storage-url";
import { resolveTenderArtifactUrls } from "@/lib/tenders/resolve-document-urls";
import { indexDocumentSource } from "@/server/ai/rag/document-ingestion";
import type {
  IndexableSourceDescriptor,
  IndexSourceResult,
} from "@/server/ai/rag/types";
import { listTenderDocuments } from "@/server/repositories/bidFeeRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";

function portalZipSourceId(tenderId: string): string {
  return `tender_portal_zip:${tenderId}`;
}

function tenderDocumentSourceId(documentId: string): string {
  return documentId;
}

export async function buildTenderSourceDescriptors(options: {
  tenderId: string;
  companyId: string;
}): Promise<IndexableSourceDescriptor[]> {
  const loaded = await getTenderById(options.tenderId);
  if (!loaded) throw new Error("Tender not found.");

  const descriptors: IndexableSourceDescriptor[] = [];
  const artifacts = resolveTenderArtifactUrls({
    document_urls: loaded.tender.document_urls,
    documents_zip_url:
      typeof loaded.tender.documents_zip_url === "string"
        ? loaded.tender.documents_zip_url
        : null,
  });

  if (artifacts.documentsZipUrl && isSharePointUrl(artifacts.documentsZipUrl)) {
    descriptors.push({
      sourceType: "TENDER_DOCUMENT",
      sourceId: portalZipSourceId(options.tenderId),
      companyId: options.companyId,
      tenderId: options.tenderId,
      documentName: "Tender_All_Documents.zip",
      documentUrl: artifacts.documentsZipUrl,
      documentType: "zip",
      section: "portal_archive",
      fetch: {
        kind: "sharepoint_url",
        url: artifacts.documentsZipUrl,
        fileName: "Tender_All_Documents.zip",
        tenderId: options.tenderId,
      },
      metadata: { origin: "portal_zip" },
    });
  }

  const tenderDocs = await listTenderDocuments({
    companyId: options.companyId,
    tenderId: options.tenderId,
  });

  for (const doc of tenderDocs) {
    if (!doc.storageUrl || !isSharePointUrl(doc.storageUrl)) continue;
    descriptors.push({
      sourceType: "TENDER_DOCUMENT",
      sourceId: tenderDocumentSourceId(doc.id),
      companyId: options.companyId,
      tenderId: options.tenderId,
      documentName: doc.originalName || doc.fileName,
      documentUrl: doc.storageUrl,
      documentType: doc.mimeType,
      section: doc.section,
      fetch: {
        kind: "sharepoint_url",
        url: doc.storageUrl,
        fileName: doc.originalName || doc.fileName,
        tenderId: options.tenderId,
      },
      metadata: {
        tender_document_id: doc.id,
        company_document_id: doc.companyDocumentId,
      },
    });
  }

  return descriptors;
}

/** Index all discoverable tender sources; skips unchanged individually. */
export async function indexTenderKnowledge(options: {
  tenderId: string;
  companyId: string;
}): Promise<IndexSourceResult[]> {
  const descriptors = await buildTenderSourceDescriptors(options);
  const results: IndexSourceResult[] = [];
  for (const descriptor of descriptors) {
    results.push(await indexDocumentSource(descriptor));
  }
  return results;
}

export async function indexTenderDocumentById(options: {
  companyId: string;
  tenderId: string;
  tenderDocumentId: string;
}): Promise<IndexSourceResult> {
  const docs = await listTenderDocuments({
    companyId: options.companyId,
    tenderId: options.tenderId,
  });
  const doc = docs.find((row) => row.id === options.tenderDocumentId);
  if (!doc) throw new Error("Tender document not found.");
  if (!doc.storageUrl || !isSharePointUrl(doc.storageUrl)) {
    throw new Error("Tender document has no SharePoint URL to index.");
  }

  return indexDocumentSource({
    sourceType: "TENDER_DOCUMENT",
    sourceId: tenderDocumentSourceId(doc.id),
    companyId: options.companyId,
    tenderId: options.tenderId,
    documentName: doc.originalName || doc.fileName,
    documentUrl: doc.storageUrl,
    documentType: doc.mimeType,
    section: doc.section,
    fetch: {
      kind: "sharepoint_url",
      url: doc.storageUrl,
      fileName: doc.originalName || doc.fileName,
      tenderId: options.tenderId,
    },
    metadata: {
      tender_document_id: doc.id,
      company_document_id: doc.companyDocumentId,
    },
  });
}

export async function indexTenderPortalZip(options: {
  tenderId: string;
  companyId: string;
}): Promise<IndexSourceResult | null> {
  const descriptors = await buildTenderSourceDescriptors(options);
  const zip = descriptors.find(
    (item) => item.sourceId === portalZipSourceId(options.tenderId),
  );
  if (!zip) return null;
  return indexDocumentSource(zip);
}
