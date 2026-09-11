import "server-only";

import {
  BID_AI_PROMPT_CATALOG,
  isBidAiPromptKey,
  sanitizePromptTemplate,
  type BidAiPromptKey,
} from "@/lib/bid-ai-prompts";
import { getServerSupabase } from "@/lib/db/server";

export type AiPromptOverridesMap = Partial<
  Record<BidAiPromptKey, { template: string; updatedAt: string; updatedBy?: string }>
>;

function parseOverrides(raw: unknown): AiPromptOverridesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AiPromptOverridesMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isBidAiPromptKey(key)) continue;
    if (typeof value === "string" && value.trim()) {
      out[key] = { template: value, updatedAt: new Date(0).toISOString() };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const template = String(record.template || "").trim();
      if (!template) continue;
      out[key] = {
        template,
        updatedAt: String(record.updatedAt || new Date().toISOString()),
        updatedBy: record.updatedBy ? String(record.updatedBy) : undefined,
      };
    }
  }
  return out;
}

export async function getWorkspaceAiPromptOverrides(
  workspaceId: string,
): Promise<AiPromptOverridesMap> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("ai_prompt_overrides")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseOverrides(data?.ai_prompt_overrides);
}

/**
 * Effective instruction template for a prompt key (custom override or catalog default).
 * Runtime tender/RFP context is injected separately by the caller.
 */
export async function resolveEffectivePromptTemplate(options: {
  workspaceId: string;
  promptKey: BidAiPromptKey;
}): Promise<{
  promptKey: BidAiPromptKey;
  template: string;
  isCustom: boolean;
  defaultTemplate: string;
  updatedAt: string | null;
}> {
  const meta = BID_AI_PROMPT_CATALOG[options.promptKey];
  const overrides = await getWorkspaceAiPromptOverrides(options.workspaceId);
  const custom = overrides[options.promptKey];
  if (custom?.template?.trim()) {
    return {
      promptKey: options.promptKey,
      template: custom.template,
      isCustom: true,
      defaultTemplate: meta.defaultTemplate,
      updatedAt: custom.updatedAt || null,
    };
  }
  return {
    promptKey: options.promptKey,
    template: meta.defaultTemplate,
    isCustom: false,
    defaultTemplate: meta.defaultTemplate,
    updatedAt: null,
  };
}

export async function saveWorkspaceAiPromptOverride(options: {
  workspaceId: string;
  companyId: string;
  userId: string;
  promptKey: BidAiPromptKey;
  template: string;
}): Promise<{ template: string }> {
  const meta = BID_AI_PROMPT_CATALOG[options.promptKey];
  const template = sanitizePromptTemplate(options.template, meta.maxLength);
  const supabase = getServerSupabase();
  const overrides = await getWorkspaceAiPromptOverrides(options.workspaceId);
  const next: AiPromptOverridesMap = {
    ...overrides,
    [options.promptKey]: {
      template,
      updatedAt: new Date().toISOString(),
      updatedBy: options.userId,
    },
  };
  const { error } = await supabase
    .from("agenttender_bid_workspaces")
    .update({
      ai_prompt_overrides: next,
      updated_by: options.userId,
    })
    .eq("id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
  return { template };
}

export async function resetWorkspaceAiPromptOverride(options: {
  workspaceId: string;
  companyId: string;
  userId: string;
  promptKey: BidAiPromptKey;
}): Promise<{ template: string }> {
  const supabase = getServerSupabase();
  const overrides = await getWorkspaceAiPromptOverrides(options.workspaceId);
  const next = { ...overrides };
  delete next[options.promptKey];
  const { error } = await supabase
    .from("agenttender_bid_workspaces")
    .update({
      ai_prompt_overrides: next,
      updated_by: options.userId,
    })
    .eq("id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
  return { template: BID_AI_PROMPT_CATALOG[options.promptKey].defaultTemplate };
}
