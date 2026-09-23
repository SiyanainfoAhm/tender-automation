import "server-only";

import { createHash } from "node:crypto";

import { ingestDocumentBytes } from "@/server/ingestion/extractFiles";
import { chunkText, normalizeText } from "@/server/ai/rag/chunking";
import { embedTexts } from "@/server/ai/rag/embeddings";
import {
  getIndexStatus,
  upsertIndexStatus,
} from "@/server/ai/rag/index-status-repository";
import {
  deactivateActiveChunks,
  replaceActiveChunks,
} from "@/server/ai/rag/vector-repository";
import type {
  AiChunkDraft,
  ExtractedSourceText,
  IndexableSourceDescriptor,
  IndexSourceResult,
} from "@/server/ai/rag/types";
import { getEmbeddingModel } from "@/server/ai/rag/types";
import {
  invokeBlobRead,
  invokeDocumentRead,
} from "@/server/storage/tenderAutomationDocumentFunctions";
import { createAskAiRequestId, insertAiUsageLog } from "@/server/ai/rag/usage-log";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function emptyTimings() {
  return {
    fetchMs: 0,
    extractMs: 0,
    chunkMs: 0,
    embeddingMs: 0,
    dbWriteMs: 0,
    totalMs: 0,
  };
}

function logIndex(event: string, payload: Record<string, unknown>) {
  console.info("[ai-rag]", event, payload);
}

function stableMemberSourceId(parentSourceId: string, memberPath: string): string {
  const normalized = memberPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${parentSourceId}::${normalized}`;
}

/**
 * Index one logical source into ai_document_chunks.
 * Failed reindex preserves previously active chunks.
 */
export async function indexDocumentSource(
  descriptor: IndexableSourceDescriptor,
): Promise<IndexSourceResult> {
  const started = Date.now();
  const timings = emptyTimings();
  const baseMeta = {
    source_id: descriptor.sourceId,
    source_type: descriptor.sourceType,
  };

  try {
    // Fetch/extract before flipping to INDEXING so unchanged sources can skip
    // against the previous INDEXED status + content_hash.
    const fetchStarted = Date.now();
    const extractedUnits = await loadAndExtract(descriptor);
    timings.fetchMs = Date.now() - fetchStarted;
    timings.extractMs = timings.fetchMs;

    if (extractedUnits.length === 0) {
      throw new Error("No extractable text found for this source.");
    }

    // Single-file sources keep descriptor.sourceId; ZIP expands to member sources.
    if (
      extractedUnits.length === 1 &&
      extractedUnits[0]!.sourceId === descriptor.sourceId
    ) {
      const result = await indexExtractedUnit({
        descriptor,
        unit: extractedUnits[0]!,
        timings,
        started,
      });
      return result;
    }

    await upsertIndexStatus({
      companyId: descriptor.companyId,
      tenderId: descriptor.tenderId,
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      documentName: descriptor.documentName,
      documentUrl: descriptor.documentUrl,
      status: "INDEXING",
      errorMessage: null,
    });

    let totalChunks = 0;
    let lastHash: string | null = null;
    let anyFailed = false;
    let lastError: string | undefined;
    for (const unit of extractedUnits) {
      const memberDescriptor: IndexableSourceDescriptor = {
        ...descriptor,
        sourceId: unit.sourceId,
        documentName: unit.documentName,
        documentUrl: unit.documentUrl ?? descriptor.documentUrl,
        documentType: unit.documentType ?? descriptor.documentType,
        section: unit.section ?? descriptor.section,
        fetch: { kind: "profile_text", text: unit.text },
        metadata: {
          ...(descriptor.metadata || {}),
          ...unit.metadata,
          archive_source_id: descriptor.sourceId,
          archive_name: descriptor.documentName,
        },
      };
      try {
        const memberResult = await indexExtractedUnit({
          descriptor: memberDescriptor,
          unit,
          timings: emptyTimings(),
          started: Date.now(),
        });
        if (memberResult.status === "INDEX_FAILED") {
          anyFailed = true;
          lastError = memberResult.errorMessage;
          continue;
        }
        totalChunks += memberResult.chunkCount;
        lastHash = memberResult.contentHash;
      } catch (memberError) {
        anyFailed = true;
        lastError =
          memberError instanceof Error
            ? memberError.message
            : String(memberError);
      }
    }

    if (anyFailed && totalChunks === 0) {
      throw new Error(
        lastError || "All ZIP members failed to index.",
      );
    }

    timings.totalMs = Date.now() - started;
    await upsertIndexStatus({
      companyId: descriptor.companyId,
      tenderId: descriptor.tenderId,
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      documentName: descriptor.documentName,
      documentUrl: descriptor.documentUrl,
      contentHash: lastHash,
      status: anyFailed ? "INDEX_FAILED" : "INDEXED",
      chunkCount: totalChunks,
      markIndexed: !anyFailed,
      errorMessage: anyFailed
        ? (lastError || "Some ZIP members failed to index.").slice(0, 2_000)
        : null,
    });

    logIndex(anyFailed ? "INDEX_FAILED_ARCHIVE" : "INDEXED_ARCHIVE", {
      ...baseMeta,
      chunk_count: totalChunks,
      member_count: extractedUnits.length,
      total_ms: timings.totalMs,
    });

    return {
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      status: anyFailed ? "INDEX_FAILED" : "INDEXED",
      chunkCount: totalChunks,
      contentHash: lastHash,
      skipped: false,
      timings,
      errorMessage: anyFailed ? lastError : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    timings.totalMs = Date.now() - started;
    await upsertIndexStatus({
      companyId: descriptor.companyId,
      tenderId: descriptor.tenderId,
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      documentName: descriptor.documentName,
      documentUrl: descriptor.documentUrl,
      status: "INDEX_FAILED",
      errorMessage: message.slice(0, 2_000),
    }).catch(() => null);

    logIndex("INDEX_FAILED", {
      ...baseMeta,
      error: message,
      total_ms: timings.totalMs,
    });

    return {
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      status: "INDEX_FAILED",
      chunkCount: 0,
      contentHash: null,
      skipped: false,
      timings,
      errorMessage: message,
    };
  }
}

async function indexExtractedUnit(options: {
  descriptor: IndexableSourceDescriptor;
  unit: ExtractedSourceText;
  timings: ReturnType<typeof emptyTimings>;
  started: number;
}): Promise<IndexSourceResult> {
  const { descriptor, unit } = options;
  const timings = options.timings;

  const normalized = normalizeText(unit.text);
  if (!normalized) {
    throw new Error(`Empty text after normalization for ${unit.sourceId}.`);
  }

  const contentHash = sha256(normalized);
  const existing = await getIndexStatus({
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
  });

  // Unchanged content: restore INDEXED even if status was NEEDS_REINDEX / INDEX_FAILED.
  if (
    existing?.contentHash === contentHash &&
    existing.chunkCount > 0 &&
    existing.status !== "INDEXING"
  ) {
    timings.totalMs = Date.now() - options.started;
    logIndex("SKIPPED_UNCHANGED", {
      source_id: unit.sourceId,
      source_type: descriptor.sourceType,
      content_hash_prefix: contentHash.slice(0, 12),
      total_ms: timings.totalMs,
    });
    await upsertIndexStatus({
      companyId: descriptor.companyId,
      tenderId: descriptor.tenderId,
      sourceType: descriptor.sourceType,
      sourceId: unit.sourceId,
      documentName: unit.documentName,
      documentUrl: unit.documentUrl,
      contentHash,
      status: "INDEXED",
      chunkCount: existing.chunkCount,
      markIndexed: true,
      errorMessage: null,
    });
    return {
      sourceType: descriptor.sourceType,
      sourceId: unit.sourceId,
      status: "SKIPPED_UNCHANGED",
      chunkCount: existing.chunkCount,
      contentHash,
      skipped: true,
      timings,
    };
  }

  await upsertIndexStatus({
    companyId: descriptor.companyId,
    tenderId: descriptor.tenderId,
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    documentName: unit.documentName,
    documentUrl: unit.documentUrl,
    status: "INDEXING",
    errorMessage: null,
  });

  const chunkStarted = Date.now();
  const textChunks = chunkText({
    text: normalized,
    // Flat PDF extract does not expose per-page offsets — do not invent pages.
    pageNumber: null,
    defaultSection: unit.section,
  });
  timings.chunkMs = Date.now() - chunkStarted;

  if (textChunks.length === 0) {
    throw new Error("Chunking produced no chunks.");
  }

  const embedStarted = Date.now();
  const { embeddings, embeddingTokens } = await embedTexts(
    textChunks.map((c) => c.content),
  );
  timings.embeddingMs = Date.now() - embedStarted;

  const drafts: AiChunkDraft[] = textChunks.map((chunk, index) => ({
    companyId: descriptor.companyId,
    tenderId: descriptor.tenderId,
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    documentName: unit.documentName,
    documentUrl: unit.documentUrl,
    documentType: unit.documentType,
    pageNumber: chunk.pageNumber,
    section: chunk.section,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    contentHash,
    embedding: embeddings[index]!,
    metadata: {
      ...(descriptor.metadata || {}),
      ...unit.metadata,
      page_count: unit.pageCount,
      embedding_model:
        process.env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    },
  }));

  const dbStarted = Date.now();
  await replaceActiveChunks({
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    contentHash,
    chunks: drafts,
  });
  timings.dbWriteMs = Date.now() - dbStarted;
  timings.totalMs = Date.now() - options.started;

  await upsertIndexStatus({
    companyId: descriptor.companyId,
    tenderId: descriptor.tenderId,
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    documentName: unit.documentName,
    documentUrl: unit.documentUrl,
    contentHash,
    status: "INDEXED",
    chunkCount: drafts.length,
    markIndexed: true,
    errorMessage: null,
  });

  logIndex("INDEXED", {
    source_id: unit.sourceId,
    source_type: descriptor.sourceType,
    chunk_count: drafts.length,
    content_hash_prefix: contentHash.slice(0, 12),
    fetch_ms: timings.fetchMs,
    extract_ms: timings.extractMs,
    chunk_ms: timings.chunkMs,
    embedding_ms: timings.embeddingMs,
    db_write_ms: timings.dbWriteMs,
    total_ms: timings.totalMs,
  });

  void insertAiUsageLog({
    requestId: createAskAiRequestId(),
    companyId: descriptor.companyId,
    tenderId: descriptor.tenderId,
    embeddingModel: getEmbeddingModel(),
    usage: { embeddingTokens },
    status: "success",
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    chunkCount: drafts.length,
    totalMs: timings.totalMs,
    metadata: {
      kind: "ingestion_embedding",
      embeddingMs: timings.embeddingMs,
    },
  });

  return {
    sourceType: descriptor.sourceType,
    sourceId: unit.sourceId,
    status: "INDEXED",
    chunkCount: drafts.length,
    contentHash,
    skipped: false,
    timings,
  };
}

async function loadAndExtract(
  descriptor: IndexableSourceDescriptor,
): Promise<ExtractedSourceText[]> {
  if (descriptor.fetch.kind === "profile_text") {
    return [
      {
        sourceId: descriptor.sourceId,
        documentName: descriptor.documentName,
        documentUrl: descriptor.documentUrl,
        documentType: descriptor.documentType,
        section: descriptor.section,
        pageCount: null,
        text: descriptor.fetch.text,
        metadata: descriptor.metadata || {},
      },
    ];
  }

  let bytes: Buffer;
  let fileName = descriptor.documentName;

  if (descriptor.fetch.kind === "company_document") {
    const response = await invokeDocumentRead(
      descriptor.fetch.documentId,
      "attachment",
    );
    if (!response.ok) {
      throw new Error(
        `Company document read failed (${response.status}).`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    fileName = descriptor.fetch.fileName;
    const response = await invokeBlobRead({
      storageUrl: descriptor.fetch.url,
      disposition: "attachment",
      fileName,
      tenderId: descriptor.fetch.tenderId,
    });
    if (!response.ok) {
      throw new Error(`SharePoint blob read failed (${response.status}).`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const files = await ingestDocumentBytes({ fileName, bytes });
  const textFiles = files.filter((file) => file.text?.trim());

  if (textFiles.length === 0) {
    const firstError = files.find((file) => file.error)?.error;
    throw new Error(
      firstError
        ? `Extraction failed: ${firstError}`
        : "Unsupported or empty document after extraction.",
    );
  }

  // ZIP (or multi-file): each member is its own stable source.
  if (textFiles.length > 1 || fileName.toLowerCase().endsWith(".zip")) {
    return textFiles.map((file) => {
      const memberPath = file.path || file.fileName;
      return {
        sourceId: stableMemberSourceId(descriptor.sourceId, memberPath),
        documentName: file.fileName,
        documentUrl: descriptor.documentUrl,
        documentType: file.kind,
        section: descriptor.section,
        pageCount: file.pageCount ?? null,
        text: file.text || "",
        metadata: {
          archive_source_id: descriptor.sourceId,
          archive_name: descriptor.documentName,
          member_path: memberPath,
          parser: file.parser || null,
        },
      };
    });
  }

  const only = textFiles[0]!;
  return [
    {
      sourceId: descriptor.sourceId,
      documentName: descriptor.documentName || only.fileName,
      documentUrl: descriptor.documentUrl,
      documentType: descriptor.documentType || only.kind,
      section: descriptor.section,
      pageCount: only.pageCount ?? null,
      text: only.text || "",
      metadata: {
        parser: only.parser || null,
        ...(descriptor.metadata || {}),
      },
    },
  ];
}

/** When ai_index_enabled is turned off, remove source from active retrieval. */
export async function excludeDocumentSource(options: {
  sourceType: "COMPANY_DOCUMENT";
  sourceId: string;
  companyId: string;
}): Promise<void> {
  await deactivateActiveChunks({
    sourceType: options.sourceType,
    sourceId: options.sourceId,
  });
  await upsertIndexStatus({
    companyId: options.companyId,
    tenderId: null,
    sourceType: options.sourceType,
    sourceId: options.sourceId,
    status: "NOT_INDEXED",
    chunkCount: 0,
    contentHash: null,
    errorMessage: "Excluded by ai_index_enabled=false",
  });
}
