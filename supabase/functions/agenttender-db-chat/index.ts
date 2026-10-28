import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-agenttender-session",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function presentForMobile(raw: string) {
  let answer = String(raw || "").replace(/\r\n/g, "\n");
  // Hide infrastructure diagnostics from the user-facing narrative, not from logs.
  const diagnostics: string[] = [];
  answer = answer.replace(/(?:Note the index warning:|Index warning:)[^\n]*(?:\n(?!\n)[^\n]*)?/gi, (match) => {
    if (/chunks?|embeddings?|indexing/i.test(match)) { diagnostics.push(match.trim()); return ""; }
    return match;
  });
  answer = answer.replace(/^\s*(?:Current tender evidence is limited\.|No OCR, extraction, indexing or embedding job was started\.)[^\n]*$/gim, (match) => { diagnostics.push(match.trim()); return ""; });
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();
  const followups = [...answer.matchAll(/^\s*(?:\d+[.)]|[-*])\s+(.+\?)\s*$/gm)]
    .map(m => m[1].trim()).slice(-3);
  return { answer, diagnostics, followups };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return respond({ success: false, error: "POST required" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) return respond({ success: false, error: "Service unavailable" }, 503);

    // Keep AgentTender's existing custom-session authentication contract.
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const token = req.headers.get("x-agenttender-session")?.trim() || bearer;
    if (!token) return respond({ success: false, error: "Authentication required" }, 401);

    const db = createClient(url, key, { auth: { persistSession: false } });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const { data: session, error: sessionError } = await db
      .from("agenttender_user_sessions")
      .select("user_id,expires_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (sessionError || !session || session.revoked_at || session.expires_at <= new Date().toISOString()) {
      return respond({ success: false, error: "Invalid session" }, 401);
    }

    const { data: user, error: userError } = await db
      .from("agenttender_users")
      .select("id,company_id,is_active")
      .eq("id", session.user_id)
      .maybeSingle();
    if (userError || !user?.is_active || !uuid.test(String(user.company_id))) {
      return respond({ success: false, error: "Inactive user" }, 401);
    }

    const { data: membership, error: membershipError } = await db
      .from("agenttender_company_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", user.company_id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError || !membership) {
      return respond({ success: false, error: "Company access denied" }, 403);
    }

    const input = await req.json().catch(() => ({}));
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return respond({ success: false, error: "Valid tender_id and message required" }, 400);
    }
    if(input.company_id&&input.company_id!==user.company_id||input.user_id&&input.user_id!==user.id)return respond({success:false,error:'Company access denied'},403);
    const tenderId = String(input.tender_id || "");
    const question = String(input.question || input.message || "").trim();
    if (!uuid.test(tenderId) || !question || question.length > 4000) {
      return respond({ success: false, error: "Valid tender_id and message required" }, 400);
    }

    // Preserve the existing frontend payload while removing client-supplied identity.
    const body = { ...input, tender_id: tenderId, company_id: user.company_id, question };
    delete body.user_id;

    // V2 must authenticate the actual AgentTender session itself. Do not send a
    // service-role bearer token: that would select V2's trusted internal path.
    const upstream = await fetch(url + "/functions/v1/agenttender-orch-v2-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agenttender-session": token,
      },
      body: JSON.stringify(body),
    });

    const raw = await upstream.text();
    let result: any;
    try {
      result = JSON.parse(raw);
    } catch {
      return respond({ success: false, error: "V2 returned invalid response" }, 502);
    }

    if (!upstream.ok || result.ok === false) {
      return respond({ success: false, error: result.error || "V2 request failed", ...result }, upstream.status);
    }
    const formatted = presentForMobile(result.answer || "");
    // Preserve the full V2 evidence in a separate field; the initial mobile
    // response exposes only a short source preview.
    const fullSources = Array.isArray(result.sources) ? result.sources : null;
    return respond({
      ...result,
      ...(fullSources ? { sources: fullSources.slice(0, 5), source_count: fullSources.length, all_sources: fullSources } : {}),
      success: true,
      answer: formatted.answer,
      message: formatted.answer,
      presentation: {
        version: 2,
        layout: "mobile",
        follow_up_questions: formatted.followups,
        diagnostics: formatted.diagnostics,
        source_preview_limit: 5,
      },
    });
  } catch (error) {
    console.error("V2 chat adapter error", error);
    return respond({ success: false, error: "Chat service unavailable" }, 502);
  }
});
