/**
 * GPT-ready accounting: every ready tender is reused, queued, pending, or
 * explicitly limit-skipped. Send limits apply only to NEW GPT requests.
 */
import { isUnlimitedProductionLimit } from "../productionLimit.js";

export type GptNotQueuedReason =
  | "EXISTING_VALID_REUSED"
  | "EXPLICIT_MAX_LIMIT"
  | "PENDING_EXISTING_CONVERSATION"
  | "ALREADY_COMPLETED_THIS_RUN"
  | "PRESCREEN_BLOCKED";

export type GptQueuePlan = {
  readyIds: string[];
  notReadyIds: string[];
  reusedIds: string[];
  newRequiredIds: string[];
  queuedNewIds: string[];
  limitSkippedIds: string[];
  pendingRecoveryIds: string[];
  prescreenBlockedIds: string[];
  alreadyCompletedIds: string[];
  notQueued: Array<{ id: string; reason: GptNotQueuedReason }>;
  explicitLimit: number | "UNLIMITED";
};

export function planGptQualificationQueue(options: {
  readyIds: string[];
  notReadyIds?: string[];
  reusedIds?: string[];
  pendingRecoveryIds?: string[];
  prescreenBlockedIds?: string[];
  alreadyCompletedIds?: string[];
  /** 0 / negative = unlimited new GPT sends. */
  maxGptSends: number;
}): GptQueuePlan {
  const readyIds = unique(options.readyIds);
  const readySet = new Set(readyIds);
  const notReadyIds = unique(options.notReadyIds ?? []);
  const reusedIds = unique(options.reusedIds ?? []).filter((id) =>
    readySet.has(id),
  );
  const reusedSet = new Set(reusedIds);
  const pendingRecoveryIds = unique(options.pendingRecoveryIds ?? []).filter(
    (id) => readySet.has(id) && !reusedSet.has(id),
  );
  const pendingSet = new Set(pendingRecoveryIds);
  const prescreenBlockedIds = unique(options.prescreenBlockedIds ?? []).filter(
    (id) => readySet.has(id) && !reusedSet.has(id) && !pendingSet.has(id),
  );
  const blockedSet = new Set(prescreenBlockedIds);
  const alreadyCompletedIds = unique(options.alreadyCompletedIds ?? []).filter(
    (id) =>
      readySet.has(id) &&
      !reusedSet.has(id) &&
      !pendingSet.has(id) &&
      !blockedSet.has(id),
  );
  const alreadySet = new Set(alreadyCompletedIds);

  const newRequiredIds = readyIds.filter(
    (id) =>
      !reusedSet.has(id) &&
      !pendingSet.has(id) &&
      !blockedSet.has(id) &&
      !alreadySet.has(id),
  );

  const unlimited = isUnlimitedProductionLimit(options.maxGptSends);
  const cap = unlimited ? newRequiredIds.length : options.maxGptSends;
  const queuedNewIds = newRequiredIds.slice(0, Math.max(0, cap));
  const queuedSet = new Set(queuedNewIds);
  const limitSkippedIds = newRequiredIds.filter((id) => !queuedSet.has(id));

  const notQueued: GptQueuePlan["notQueued"] = [];
  for (const id of reusedIds) {
    notQueued.push({ id, reason: "EXISTING_VALID_REUSED" });
  }
  for (const id of pendingRecoveryIds) {
    notQueued.push({ id, reason: "PENDING_EXISTING_CONVERSATION" });
  }
  for (const id of alreadyCompletedIds) {
    notQueued.push({ id, reason: "ALREADY_COMPLETED_THIS_RUN" });
  }
  for (const id of prescreenBlockedIds) {
    notQueued.push({ id, reason: "PRESCREEN_BLOCKED" });
  }
  for (const id of limitSkippedIds) {
    notQueued.push({ id, reason: "EXPLICIT_MAX_LIMIT" });
  }

  return {
    readyIds,
    notReadyIds,
    reusedIds,
    newRequiredIds,
    queuedNewIds,
    limitSkippedIds,
    pendingRecoveryIds,
    prescreenBlockedIds,
    alreadyCompletedIds,
    notQueued,
    explicitLimit: unlimited ? "UNLIMITED" : options.maxGptSends,
  };
}

export function assertGptReadyFullyAccounted(plan: GptQueuePlan): boolean {
  const accounted = new Set([
    ...plan.reusedIds,
    ...plan.queuedNewIds,
    ...plan.limitSkippedIds,
    ...plan.pendingRecoveryIds,
    ...plan.prescreenBlockedIds,
    ...plan.alreadyCompletedIds,
  ]);
  return (
    plan.readyIds.length === accounted.size &&
    plan.readyIds.every((id) => accounted.has(id))
  );
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const normalized = String(id).replace(/^T247-/i, "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
