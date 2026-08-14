import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type { TenderActivityEvent } from "@/lib/tender-detail";

export type TenderActivityInsert = {
  tenderId: string;
  companyId?: string | null;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
  actorUserId?: string | null;
};

export async function insertTenderActivity(
  input: TenderActivityInsert,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("agenttender_tender_activity").insert({
    tender_id: input.tenderId,
    company_id: input.companyId ?? null,
    event_type: input.eventType,
    summary: input.summary,
    payload: input.payload ?? {},
    actor_user_id: input.actorUserId ?? null,
  });
  if (error) {
    console.error("[tender-activity] insert failed", error.message);
  }
}

export async function listTenderActivity(options: {
  tenderId: string;
  companyId?: string | null;
}): Promise<TenderActivityEvent[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_tender_activity")
    .select("id, event_type, summary, created_at, actor_user_id, company_id")
    .eq("tender_id", options.tenderId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (options.companyId) {
    query = query.or(`company_id.is.null,company_id.eq.${options.companyId}`);
  } else {
    query = query.is("company_id", null);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[tender-activity] list failed", error.message);
    return [];
  }

  const actorIds = [
    ...new Set(
      (data || [])
        .map((row) => row.actor_user_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase
      .from("agenttender_users")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const user of users || []) {
      names.set(
        String(user.id),
        String(user.full_name || user.email || "Team member"),
      );
    }
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    summary: String(row.summary),
    createdAt: String(row.created_at),
    actorName: row.actor_user_id
      ? names.get(String(row.actor_user_id)) ?? null
      : null,
  }));
}

export function derivedTenderLifecycleEvents(input: {
  tenderId: string;
  firstSeenAt: string | null;
  crawledAt: string | null;
  qualifiedAt: string | null;
}): TenderActivityEvent[] {
  const events: TenderActivityEvent[] = [];
  const importedAt = input.firstSeenAt || input.crawledAt;
  if (importedAt) {
    events.push({
      id: `imported:${input.tenderId}`,
      eventType: "tender_imported",
      summary: "Tender imported",
      createdAt: importedAt,
      actorName: null,
    });
  }
  if (input.qualifiedAt) {
    events.push({
      id: `qualified:${input.tenderId}`,
      eventType: "ai_evaluation_completed",
      summary: "AI evaluation completed",
      createdAt: input.qualifiedAt,
      actorName: null,
    });
  }
  return events;
}
