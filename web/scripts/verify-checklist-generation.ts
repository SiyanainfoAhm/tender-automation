/**
 * Real end-to-end verification for per-item AI checklist document generation.
 *
 * Usage (from web/):
 *   npx tsx scripts/verify-checklist-generation.ts
 */
import { createHash, randomBytes } from "crypto";
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import OpenAI from "openai";

import { resolveGenerationPolicy } from "../src/lib/bid-checklist";
import {
  buildGeneratedFileName,
  nextVersionLabel,
  sanitizeFileNamePart,
} from "../src/server/generation/filenames";
import {
  buildSystemPrompt,
  resolveDocumentTypeKey,
} from "../src/server/generation/prompts";
import { renderGeneratedDocx } from "../src/server/generation/renderDocx";
import {
  GENERATION_PROMPT_VERSION,
  generatedDocumentSchema,
} from "../src/server/generation/types";

// Allow importing server-only modules from a Node script.
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as NodeModule;

function loadEnvFile(path: string) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), "../.env"));

const REQUIREMENT_ID =
  process.env.VERIFY_REQUIREMENT_ID ||
  "95c0009a-d10b-488a-851c-fddc26c5663c";
const WORKSPACE_ID =
  process.env.VERIFY_WORKSPACE_ID ||
  "ede59a01-a070-4910-bcdc-6b2d3dbd4f91";
const TENDER_ID =
  process.env.VERIFY_TENDER_ID || "b4a82ba2-3a5a-42d3-8358-711066d9865d";
const COMPANY_ID =
  process.env.VERIFY_COMPANY_ID ||
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const {
    buildGenerationContext,
    formatContextForPrompt,
  } = await import("../src/server/generation/buildContext");

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / service key in web/.env");
  }
  if (!openaiKey) throw new Error("Missing OPENAI_API_KEY in web/.env");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: companyDocCountBefore } = await supabase
    .from("agenttender_company_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_ID);

  console.log("[1] Loading generation context…");
  const context = await buildGenerationContext({
    companyId: COMPANY_ID,
    workspaceId: WORKSPACE_ID,
    tenderId: TENDER_ID,
    requirementId: REQUIREMENT_ID,
  });

  const policy = resolveGenerationPolicy({
    requirementKey: context.requirement.key,
    requirementName: context.requirement.name,
    generationAllowed: context.requirement.generationAllowed,
  });
  if (
    policy !== "GENERATABLE" &&
    policy !== "GENERATABLE_DRAFT_ONLY"
  ) {
    throw new Error(`Requirement not generatable: ${policy}`);
  }

  const documentTypeKey = resolveDocumentTypeKey(context.requirement.key);
  const model =
    process.env.OPENAI_GENERATION_MODEL?.trim() ||
    process.env.OPENAI_INGESTION_MODEL?.trim() ||
    "gpt-4o-mini";
  const systemPrompt = buildSystemPrompt({
    documentTypeKey,
    generationPolicy: policy,
  });
  const userPrompt = [
    "Generate the tender response document for the requirement below.",
    "Evidence package (JSON):",
    formatContextForPrompt(context),
  ].join("\n\n");

  console.log("[2] Calling OpenAI…", { model, documentTypeKey, policy });
  const client = new OpenAI({ apiKey: openaiKey });
  let structured;
  try {
    const response = await client.responses.create({
      model,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const raw =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output_text ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output?.[0]?.content?.[0]?.text ||
      "{}";
    structured = generatedDocumentSchema.parse(JSON.parse(String(raw)));
  } catch (err) {
    console.warn("responses API failed, falling back to chat.completions", err);
    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    structured = generatedDocumentSchema.parse(
      JSON.parse(response.choices[0]?.message?.content || "{}"),
    );
  }

  if (!structured.sections.length && !structured.tables.length) {
    throw new Error("OpenAI returned empty structured document");
  }
  console.log("[2b] Structured sections:", structured.sections.length);

  console.log("[3] Rendering DOCX…");
  const { data: priorDocs } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id, title, file_name")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("company_id", COMPANY_ID);
  const needle = sanitizeFileNamePart(context.requirement.name).toLowerCase();
  const priorCount = (priorDocs || []).filter((row) => {
    const title = String(row.title || "").toLowerCase();
    const file = String(row.file_name || "").toLowerCase();
    return (
      title.includes(context.requirement.name.toLowerCase()) ||
      file.includes(needle)
    );
  }).length;
  const versionLabel = nextVersionLabel(priorCount);
  const fileName = buildGeneratedFileName({
    requirementName: context.requirement.name,
    tenderReference: context.tender.reference,
    versionLabel,
  });
  const title = `${context.requirement.name} (${versionLabel})`;

  const docxBuffer = await renderGeneratedDocx({
    content: structured,
    tenderTitle: context.tender.title,
    tenderReference: context.tender.reference,
    companyName: context.company.name,
    requirementName: context.requirement.name,
  });

  if (docxBuffer.length < 64 || docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4b) {
    throw new Error("Invalid DOCX buffer");
  }
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml?.includes(structured.document_title.slice(0, 12))) {
    throw new Error("DOCX missing expected title content");
  }

  const outDir = resolve(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, fileName);
  writeFileSync(outPath, docxBuffer);
  console.log("[3b] Wrote local DOCX:", outPath, `(${docxBuffer.length} bytes)`);

  console.log("[4] Creating ephemeral session for Azure workspace save…");
  const { data: users, error: userError } = await supabase
    .from("agenttender_users")
    .select("id, role, company_id, is_active")
    .eq("company_id", COMPANY_ID)
    .eq("is_active", true)
    .limit(10);
  if (userError || !users?.length) {
    throw new Error(`No active company user for Azure save: ${userError?.message}`);
  }
  const preferred = users.find((u) =>
    ["company_admin", "admin", "bid_manager", "super_admin", "COMPANY_ADMIN"].includes(
      String(u.role),
    ),
  );
  const user = preferred || users[0];

  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: sessionRow, error: sessionError } = await supabase
    .from("agenttender_user_sessions")
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (sessionError) throw new Error(sessionError.message);

  try {
    console.log("[5] Uploading to Azure via workspace-document-save…");
    const form = new FormData();
    form.set("action", "workspace-document-save");
    form.set("workspaceId", WORKSPACE_ID);
    form.set("tenderId", TENDER_ID);
    form.set("tenderReference", context.tender.reference);
    form.set("documentType", "Annexure");
    form.set("title", title);
    form.set(
      "file",
      new File([new Uint8Array(docxBuffer)], fileName, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    const saveRes = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/tender-automation-company-documents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "x-agenttender-session": token,
        },
        body: form,
      },
    );
    const saveJson = (await saveRes.json()) as {
      success?: boolean;
      error?: string;
      workspaceDocumentId?: string;
      documentId?: string;
    };
    if (!saveRes.ok || !saveJson.success) {
      throw new Error(saveJson.error || `Save failed (${saveRes.status})`);
    }
    const documentId = String(saveJson.workspaceDocumentId || saveJson.documentId);
    if (!documentId) throw new Error("No document id returned");

    await supabase
      .from("agenttender_bid_workspace_documents")
      .update({
        status: "drafting",
        version_label: versionLabel,
        file_name: fileName,
      })
      .eq("id", documentId)
      .eq("company_id", COMPANY_ID);

    await supabase
      .from("agenttender_bid_checklist_items")
      .update({
        matched_document_source: "TENDER",
        matched_company_document_id: null,
        matched_workspace_document_id: documentId,
        matched_by: "AI",
        completion_status: "DRAFT_AVAILABLE",
        match_reason: `AI draft generated (${versionLabel}, ${GENERATION_PROMPT_VERSION}).`,
        match_confidence: 0.85,
      })
      .eq("id", REQUIREMENT_ID)
      .eq("workspace_id", WORKSPACE_ID);

    const { data: savedDoc } = await supabase
      .from("agenttender_bid_workspace_documents")
      .select("id, file_name, status, storage_url, blob_name, file_size_bytes")
      .eq("id", documentId)
      .maybeSingle();

    const { count: companyDocCountAfter } = await supabase
      .from("agenttender_company_documents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", COMPANY_ID);

    const report = {
      requirement: context.requirement.name,
      requirementKey: context.requirement.key,
      generatedFilename: fileName,
      fileSize: docxBuffer.length,
      localPath: outPath,
      azureSaved: Boolean(savedDoc?.storage_url || savedDoc?.blob_name),
      dbSaved: Boolean(savedDoc?.id),
      status: savedDoc?.status,
      documentId,
      companyDocumentsUnchanged:
        companyDocCountBefore === companyDocCountAfter,
      companyDocCountBefore,
      companyDocCountAfter,
      model,
      promptVersion: GENERATION_PROMPT_VERSION,
      rfpContextChars: context.rfpContextText.length,
      sourceDocuments: context.sourceDocumentNames,
    };
    console.log("[6] RESULT", JSON.stringify(report, null, 2));

    if (!report.azureSaved || !report.dbSaved) {
      throw new Error("Azure or DB save incomplete");
    }
    if (!report.companyDocumentsUnchanged) {
      throw new Error("Company documents count changed — fail");
    }
    console.log("OK: end-to-end checklist AI generation verified.");
  } finally {
    await supabase
      .from("agenttender_user_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: "verify-script",
      })
      .eq("id", sessionRow.id);
  }
}

main().catch((error) => {
  console.error("VERIFY FAILED", error);
  process.exit(1);
});
