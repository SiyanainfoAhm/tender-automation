import "server-only";

import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/db/server";
import type { AskAiSource } from "@/lib/ai/ask-ai-stream";

export type ChatScope = { companyId: string; userId: string; tenderId: string };
export type ChatSession = { id: string; title: string; createdAt: string; updatedAt: string; lastMessageAt: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; action?: string | null; sources?: AskAiSource[]; warnings?: string[]; status: "complete" | "interrupted" | "cancelled" | "error"; createdAt: string };

function titleFor(question: string, action?: string | null) {
  const labels: Record<string, string> = { ASSESS_TENDER: "Tender assessment", CHECK_ELIGIBILITY: "Eligibility assessment", CHECK_TURNOVER: "Turnover requirement", CHECK_EMD_MSME: "EMD and MSME exemption", CHECK_SIMILAR_EXPERIENCE: "Similar experience", CHECK_REQUIRED_DOCUMENTS: "Required documents", SUMMARIZE_TENDER: "Tender summary" };
  return labels[action || ""] || question.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").slice(0, 80) || "Ask AI conversation";
}
export async function listChatSessions(scope: ChatScope, offset = 0, limit = 20, search = "") {
  const db = getServerSupabase();
  let query = db.from("agenttender_ai_chat_sessions").select("id,title,created_at,updated_at,last_message_at", { count: "exact" }).eq("company_id", scope.companyId).eq("user_id", scope.userId).eq("tender_id", scope.tenderId).eq("is_archived", false).order("last_message_at", { ascending: false }).range(offset, offset + limit - 1);
  if (search.trim()) query = query.ilike("title", `%${search.trim().replace(/[%_]/g, "\\$&")}%`);
  const { data, error, count } = await query; if (error) throw new Error(error.message);
  return { sessions: (data || []).map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, lastMessageAt: r.last_message_at })), total: count || 0 };
}
export async function createChatSession(scope: ChatScope, question: string, action?: string | null) {
  const db = getServerSupabase(); const now = new Date().toISOString(); const id = randomUUID(); const title = titleFor(question, action);
  // Do not depend on a PostgREST representation response: an insert may have
  // succeeded while a stale schema cache returns no selected row.
  const { error } = await db.from("agenttender_ai_chat_sessions").insert({ id, company_id: scope.companyId, user_id: scope.userId, tender_id: scope.tenderId, title, last_message_at: now });
  if (error) throw new Error(error.message || "Could not create conversation.");
  return { id, title, createdAt: now, updatedAt: now, lastMessageAt: now } as ChatSession;
}
async function ownedSession(scope: ChatScope, id: string) {
  const db = getServerSupabase(); const { data, error } = await db.from("agenttender_ai_chat_sessions").select("id").eq("id", id).eq("company_id", scope.companyId).eq("user_id", scope.userId).eq("tender_id", scope.tenderId).maybeSingle();
  if (error) throw new Error(error.message); if (!data) throw new Error("Conversation not found."); return db;
}
export async function getChatMessages(scope: ChatScope, id: string) { const db = await ownedSession(scope, id); const { data, error } = await db.from("agenttender_ai_chat_messages").select("id,role,content,action,sources,warnings,status,created_at").eq("session_id", id).eq("company_id", scope.companyId).eq("user_id", scope.userId).eq("tender_id", scope.tenderId).order("created_at"); if (error) throw new Error(error.message); return (data || []).map((r) => ({ id:r.id, role:r.role as ChatMessage["role"], content:r.content, action:r.action, sources:Array.isArray(r.sources) ? r.sources as AskAiSource[] : undefined, warnings:Array.isArray(r.warnings) ? r.warnings as string[] : undefined, status:r.status as ChatMessage["status"], createdAt:r.created_at })); }
export async function addChatMessage(scope: ChatScope, sessionId: string, message: Omit<ChatMessage, "id" | "createdAt">) { const db = await ownedSession(scope, sessionId); const now = new Date().toISOString(); const { data,error } = await db.from("agenttender_ai_chat_messages").insert({ session_id:sessionId, company_id:scope.companyId,user_id:scope.userId,tender_id:scope.tenderId,role:message.role,content:message.content,action:message.action || null,sources:message.sources || null,warnings:message.warnings || null,status:message.status }).select("id").single(); if(error) throw new Error(error.message); await db.from("agenttender_ai_chat_sessions").update({updated_at:now,last_message_at:now}).eq("id",sessionId); return data.id as string; }
export async function renameChatSession(scope: ChatScope, id: string, title: string) { const db = await ownedSession(scope,id); const clean=title.trim().slice(0,160); if(!clean) throw new Error("A title is required."); const {error}=await db.from("agenttender_ai_chat_sessions").update({title:clean,updated_at:new Date().toISOString()}).eq("id",id); if(error) throw new Error(error.message); }
export async function deleteChatSession(scope: ChatScope, id: string) { const db=await ownedSession(scope,id); const {error}=await db.from("agenttender_ai_chat_sessions").delete().eq("id",id); if(error) throw new Error(error.message); }
