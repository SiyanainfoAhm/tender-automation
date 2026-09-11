import "server-only";

import OpenAI from "openai";

import {
  resolveGenerationPolicy,
  resolveRequirementPattern,
  type GenerationPolicy,
} from "@/lib/bid-checklist";
import { getServerSupabase } from "@/lib/db/server";
import {
  buildGenerationContext,
  formatContextForPrompt,
} from "@/server/generation/buildContext";
import {
  buildSystemPrompt,
  resolveDocumentTypeKey,
} from "@/server/generation/prompts";
import { renderGeneratedDocx } from "@/server/generation/renderDocx";
import {
  GENERATION_PROMPT_VERSION,
  generatedDocumentSchema,
  type GenerateChecklistDocumentResult,
  type GeneratedDocumentContent,
} from "@/server/generation/types";
import {
  buildGeneratedFileName,
  nextVersionLabel,
  sanitizeFileNamePart,
} from "@/server/generation/filenames";
import {
  setChecklistAiDraftMatch,
} from "@/server/repositories/bidChecklistRepository";
import { updateWorkspaceDocumentStatus } from "@/server/repositories/bidWorkspaceRepository";
import {
  invokeWorkspaceDocumentDelete,
  invokeWorkspaceDocumentSave,
} from "@/server/storage/tenderAutomationDocumentFunctions";

function getOpenAiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not configured in web/.env. Cannot generate documents.",
    );
  }
  return new OpenAI({ apiKey: key });
}

function generationModel(): string {
  return (
    process.env.OPENAI_GENERATION_MODEL?.trim() ||
    process.env.OPENAI_INGESTION_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

async function countPriorAiDrafts(options: {
  workspaceId: string;
  companyId: string;
  requirementName: string;
}): Promise<number> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id, title, file_name")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
  const needle = sanitizeFileNamePart(options.requirementName).toLowerCase();
  return (data || []).filter((row) => {
    const title = String(row.title || "").toLowerCase();
    const file = String(row.file_name || "").toLowerCase();
    return (
      title.includes(options.requirementName.toLowerCase()) ||
      file.includes(needle)
    );
  }).length;
}

async function callOpenAiStructured(options: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}): Promise<GeneratedDocumentContent> {
  const client = getOpenAiClient();

  try {
    const response = await client.responses.create({
      model: options.model,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
    });
    const raw =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output_text ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output?.[0]?.content?.[0]?.text ||
      "{}";
    return generatedDocumentSchema.parse(JSON.parse(String(raw)));
  } catch (responsesError) {
    const response = await client.chat.completions.create({
      model: options.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
    });
    const raw = response.choices[0]?.message?.content || "{}";
    return generatedDocumentSchema.parse(JSON.parse(raw));
  }
}

function assertGenerationAllowed(policy: GenerationPolicy): void {
  if (
    policy === "GENERATABLE" ||
    policy === "GENERATABLE_DRAFT_ONLY"
  ) {
    return;
  }
  throw new Error(
    `AI generation is not allowed for this requirement (${policy}). Upload external evidence instead.`,
  );
}

function workspaceDocTypeFor(
  requirementKey: string,
  requirementName: string,
): string {
  const pattern =
    resolveRequirementPattern(requirementKey) ||
    resolveRequirementPattern(requirementName);
  return pattern?.workspaceDocType || "Technical";
}

/**
 * Per-checklist-item AI document generation:
 * RFP + company context → OpenAI structured → DOCX → Azure tender workspace →
 * Supabase workspace document → checklist COMPLETED_TENDER_DOCUMENT link.
 */
export async function generateChecklistDocument(options: {
  companyId: string;
  userId: string;
  workspaceId: string;
  tenderId: string;
  tenderReference: string;
  requirementId: string;
  customInstructions?: string | null;
  adminCustomPrompt?: string | null;
  itemPromptTemplate?: string | null;
}): Promise<GenerateChecklistDocumentResult> {
  const context = await buildGenerationContext({
    companyId: options.companyId,
    workspaceId: options.workspaceId,
    tenderId: options.tenderId,
    requirementId: options.requirementId,
  });

  // Also allow catalog/heuristic from-scratch policy even if DB flag lags.
  const policy = resolveGenerationPolicy({
    requirementKey: context.requirement.key,
    requirementName: context.requirement.name,
    generationAllowed: context.requirement.generationAllowed,
  });
  assertGenerationAllowed(policy);

  const documentTypeKey = resolveDocumentTypeKey(context.requirement.key);
  const model = generationModel();
  const systemPrompt = buildSystemPrompt({
    documentTypeKey,
    generationPolicy: policy,
    customPrompt: options.adminCustomPrompt,
    itemPrompt: options.itemPromptTemplate,
  });

  const userPrompt = [
    "Generate the tender response document for the requirement below.",
    options.customInstructions?.trim()
      ? `User regeneration instructions:\n${options.customInstructions.trim()}`
      : "",
    "Evidence package (JSON):",
    formatContextForPrompt(context),
  ]
    .filter(Boolean)
    .join("\n\n");

  const structured = await callOpenAiStructured({
    systemPrompt,
    userPrompt,
    model,
  });

  if (!structured.sections.length && !structured.tables.length) {
    throw new Error("Document generation returned empty content.");
  }

  const priorCount = await countPriorAiDrafts({
    workspaceId: options.workspaceId,
    companyId: options.companyId,
    requirementName: context.requirement.name,
  });
  const versionLabel = nextVersionLabel(priorCount);
  const fileName = buildGeneratedFileName({
    requirementName: context.requirement.name,
    tenderReference: context.tender.reference || options.tenderReference,
    versionLabel,
  });
  const title = `${context.requirement.name} (${versionLabel})`;

  const docxBuffer = await renderGeneratedDocx({
    content: structured,
    tenderTitle: context.tender.title,
    tenderReference: context.tender.reference || options.tenderReference,
    companyName: context.company.name,
    requirementName: context.requirement.name,
  });

  if (docxBuffer.length < 64) {
    throw new Error("Generated DOCX was empty.");
  }

  // Validate ZIP/OOXML package before upload.
  if (docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4b) {
    throw new Error("Generated file is not a valid DOCX package.");
  }

  const documentType = workspaceDocTypeFor(
    context.requirement.key,
    context.requirement.name,
  );

  const file = new File([new Uint8Array(docxBuffer)], fileName, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  // Always create a NEW tender workspace document (never company library).
  // Do not pass documentId so prior versions remain.
  let savedDocumentId: string | null = null;
  try {
    const saveResult = await invokeWorkspaceDocumentSave({
      workspaceId: options.workspaceId,
      tenderId: options.tenderId,
      tenderReference: context.tender.reference || options.tenderReference,
      documentType,
      title,
      file,
    });
    if (!saveResult.success) {
      throw new Error(saveResult.error || "Failed to save generated document.");
    }
    savedDocumentId = String(
      saveResult.workspaceDocumentId || saveResult.documentId || "",
    );
    if (!savedDocumentId) {
      throw new Error("Workspace document save did not return an id.");
    }

    await updateWorkspaceDocumentStatus({
      documentId: savedDocumentId,
      workspaceId: options.workspaceId,
      companyId: options.companyId,
      userId: options.userId,
      status: "drafting",
    });

    // Keep version label / metadata aligned with filename.
    const supabase = getServerSupabase();
    await supabase
      .from("agenttender_bid_workspace_documents")
      .update({
        version_label: versionLabel,
        file_name: fileName,
      })
      .eq("id", savedDocumentId)
      .eq("company_id", options.companyId);

    await setChecklistAiDraftMatch({
      itemId: options.requirementId,
      workspaceId: options.workspaceId,
      companyId: options.companyId,
      workspaceDocumentId: savedDocumentId,
      matchReason: `AI draft generated (${versionLabel}, ${GENERATION_PROMPT_VERSION}).`,
      generationMeta: {
        generated_for_requirement_id: options.requirementId,
        source_document_names: context.sourceDocumentNames,
        source_clause: context.requirement.sourceClause,
        source_page: context.requirement.sourcePage,
        generation_model: model,
        generation_timestamp: new Date().toISOString(),
        generation_prompt_version: GENERATION_PROMPT_VERSION,
        generation_policy: policy,
        document_type_key: documentTypeKey,
      },
    });
  } catch (error) {
    if (savedDocumentId) {
      await invokeWorkspaceDocumentDelete(savedDocumentId).catch(() => null);
    }
    throw error;
  }

  return {
    documentId: savedDocumentId!,
    fileName,
    title,
    versionLabel,
    documentType,
    fileSizeBytes: docxBuffer.length,
    status: "drafting",
    generationPolicy: policy,
    model,
    missingInformation: structured.missing_information,
    warnings: structured.warnings,
  };
}
