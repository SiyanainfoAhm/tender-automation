/**
 * GPT-ready accounting: every ready tender is reused, queued, pending, or
 * explicitly limit-skipped. Send limits apply only to NEW GPT requests.
 *
 * Local prescreen must not shrink this queue. Phase-1 VERIFY/MAY_BID/WILL_BID
 * plus current disk artifacts are the candidate source.
 */
import { isUnlimitedProductionLimit } from "../productionLimit.js";

export type GptNotQueuedReason =
  | "EXISTING_VALID_REUSED"
  | "EXPLICIT_MAX_LIMIT"
  | "PENDING_EXISTING_CONVERSATION"
  | "ALREADY_COMPLETED_THIS_RUN";

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
  /** Ignored for queue membership — Phase-1 screening is authoritative. */
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
  const alreadyCompletedIds = unique(options.alreadyCompletedIds ?? []).filter(
    (id) => readySet.has(id) && !reusedSet.has(id) && !pendingSet.has(id),
  );
  const alreadySet = new Set(alreadyCompletedIds);

  const newRequiredIds = readyIds.filter(
    (id) =>
      !reusedSet.has(id) &&
      !pendingSet.has(id) &&
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
    prescreenBlockedIds: [],
    alreadyCompletedIds,
    notQueued,
    explicitLimit: unlimited ? "UNLIMITED" : options.maxGptSends,
  };
}

export function expectedGptNewRequired(plan: Pick<
  GptQueuePlan,
  "readyIds" | "reusedIds" | "pendingRecoveryIds" | "alreadyCompletedIds"
>): number {
  return (
    plan.readyIds.length -
    plan.reusedIds.length -
    plan.pendingRecoveryIds.length -
    plan.alreadyCompletedIds.length
  );
}

export function assertGptQueueIntegrity(plan: GptQueuePlan): void {
  const expectedNew = expectedGptNewRequired(plan);
  if (plan.newRequiredIds.length !== expectedNew) {
    throw new Error(
      `GPT_QUEUE_INTEGRITY_ERROR ready=${plan.readyIds.length} reused=${plan.reusedIds.length} expectedNew=${expectedNew} actualNew=${plan.newRequiredIds.length}`,
    );
  }
  if (plan.explicitLimit === "UNLIMITED" && plan.queuedNewIds.length !== plan.newRequiredIds.length) {
    throw new Error(
      `GPT_QUEUE_INTEGRITY_ERROR ready=${plan.readyIds.length} reused=${plan.reusedIds.length} expectedNew=${expectedNew} actualQueued=${plan.queuedNewIds.length}`,
    );
  }
  const queueBuckets = reconcileGptReadyQueueBuckets(plan);
  if (!queueBuckets.ok) {
    throw new Error(
      `GPT_READY_QUEUE_RECONCILIATION_FAILED READY=${queueBuckets.ready} REUSED_VALID=${queueBuckets.reusedValid} NEW_QUEUED=${queueBuckets.newQueued} VALID_PENDING=${queueBuckets.validPending}`,
    );
  }
  if (!assertGptReadyFullyAccounted(plan)) {
    throw new Error(
      `GPT_QUEUE_INTEGRITY_ERROR ready=${plan.readyIds.length} reused=${plan.reusedIds.length} expectedNew=${expectedNew} actualNew=${plan.newRequiredIds.length}`,
    );
  }
}

export function assertGptReadyFullyAccounted(plan: GptQueuePlan): boolean {
  const accounted = new Set([
    ...plan.reusedIds,
    ...plan.queuedNewIds,
    ...plan.limitSkippedIds,
    ...plan.pendingRecoveryIds,
    ...plan.alreadyCompletedIds,
  ]);
  return (
    plan.readyIds.length === accounted.size &&
    plan.readyIds.every((id) => accounted.has(id))
  );
}

export type GptReadyQueueBuckets = {
  ready: number;
  reusedValid: number;
  newQueued: number;
  validPending: number;
  alreadyCompleted: number;
  limitSkipped: number;
  accounted: number;
  ok: boolean;
};

/**
 * Planning reconciliation:
 * READY = REUSED_VALID + NEW_QUEUED + VALID_PENDING
 * (+ already-completed-this-run and explicit limit skips when present).
 * Prescreen-skipped tenders must not occupy REUSED_VALID.
 */
export function reconcileGptReadyQueueBuckets(
  plan: Pick<
    GptQueuePlan,
    | "readyIds"
    | "reusedIds"
    | "queuedNewIds"
    | "pendingRecoveryIds"
    | "alreadyCompletedIds"
    | "limitSkippedIds"
  >,
): GptReadyQueueBuckets {
  const ready = plan.readyIds.length;
  const reusedValid = plan.reusedIds.length;
  const newQueued = plan.queuedNewIds.length;
  const validPending = plan.pendingRecoveryIds.length;
  const alreadyCompleted = plan.alreadyCompletedIds.length;
  const limitSkipped = plan.limitSkippedIds.length;
  const accounted =
    reusedValid + newQueued + validPending + alreadyCompleted + limitSkipped;
  return {
    ready,
    reusedValid,
    newQueued,
    validPending,
    alreadyCompleted,
    limitSkipped,
    accounted,
    ok: accounted === ready,
  };
}

export type GptReadyReconciliation = {
  readyTotal: number;
  reusedExistingValid: number;
  completedThisRun: number;
  pending: number;
  failed: number;
  queuedRemaining: number;
  accountedTotal: number;
  unaccountedIds: string[];
  coverageCompleted: number;
  coverageLabel: string;
};

/**
 * Every GPT-ready tender must land in exactly one terminal-or-queued bucket.
 * Reused IDs must not also count as completed-this-run.
 */
export function reconcileGptReadyCoverage(options: {
  readyIds: string[];
  reusedIds: string[];
  completedThisRunIds: string[];
  pendingIds: string[];
  failedIds: string[];
  queuedRemainingIds: string[];
}): GptReadyReconciliation {
  const readyIds = unique(options.readyIds);
  const readySet = new Set(readyIds);
  const reused = unique(options.reusedIds).filter((id) => readySet.has(id));
  const reusedSet = new Set(reused);
  const completedThisRun = unique(options.completedThisRunIds).filter(
    (id) => readySet.has(id) && !reusedSet.has(id),
  );
  const completedSet = new Set([...reusedSet, ...completedThisRun]);
  const pending = unique(options.pendingIds).filter(
    (id) => readySet.has(id) && !completedSet.has(id),
  );
  const pendingSet = new Set([...completedSet, ...pending]);
  const failed = unique(options.failedIds).filter(
    (id) => readySet.has(id) && !pendingSet.has(id),
  );
  const failedSet = new Set([...pendingSet, ...failed]);
  const queuedRemaining = unique(options.queuedRemainingIds).filter(
    (id) => readySet.has(id) && !failedSet.has(id),
  );
  const accounted = new Set([
    ...reused,
    ...completedThisRun,
    ...pending,
    ...failed,
    ...queuedRemaining,
  ]);
  const unaccountedIds = readyIds.filter((id) => !accounted.has(id));
  const coverageCompleted = reused.length + completedThisRun.length;
  return {
    readyTotal: readyIds.length,
    reusedExistingValid: reused.length,
    completedThisRun: completedThisRun.length,
    pending: pending.length,
    failed: failed.length,
    queuedRemaining: queuedRemaining.length,
    accountedTotal:
      reused.length +
      completedThisRun.length +
      pending.length +
      failed.length +
      queuedRemaining.length,
    unaccountedIds,
    coverageCompleted,
    coverageLabel: `${coverageCompleted}/${readyIds.length}`,
  };
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
