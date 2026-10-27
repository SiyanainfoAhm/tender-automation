import "server-only";
import { generatedDocumentSchema } from "@/server/generation/types";

/** Reuse the deployed V2 document writer and its DeepSeek-first provider policy. */
export async function callChecklistWriter(options: {
  companyId: string; workspaceId: string; requirementId: string;
  systemPrompt: string; userPrompt: string;
}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Document generation is not configured.");
  const response = await fetch(`${url}/functions/v1/agenttender-bid-draft-generator`, {
    method:"POST", headers:{Authorization:`Bearer ${key}`, apikey:key, "Content-Type":"application/json"},
    body:JSON.stringify({operation:"interactive-checklist-draft", company_id:options.companyId,
      workspace_id:options.workspaceId, item_id:options.requirementId,
      system_prompt:options.systemPrompt, user_prompt:options.userPrompt}),
    cache:"no-store", signal:AbortSignal.timeout(180000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error("AI document generation is temporarily unavailable. Please try again. Your original attachment is unchanged.");
  const parsed = generatedDocumentSchema.safeParse(result.document);
  if (!parsed.success) throw new Error("AI returned an incomplete draft. Please try again. Your original attachment is unchanged.");
  return {content:parsed.data, model:String(result.model || "V2 writer"), provider:String(result.provider || "")};
}
