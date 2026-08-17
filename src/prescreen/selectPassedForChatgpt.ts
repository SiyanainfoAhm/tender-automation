import { assertPrescreenAllowsChatgpt } from "./chatgptGate.js";
import { loadPrescreenConfig } from "./prescreenConfig.js";
import type { PrescreenSourcePortal } from "./prescreenTypes.js";

export type PrescreenSkipRecord = {
  sourceTenderId: string;
  status: string | null;
  reasonCode: string | null;
  message: string | null;
};

export type SelectPassedForChatgptResult = {
  passedIds: string[];
  skipped: PrescreenSkipRecord[];
  /** First PASSED id, or null when none */
  firstPassedId: string | null;
};

/**
 * Keep only tenders that passed deterministic pre-screen (ChatGPT-eligible).
 * Rejected / MANUAL_REVIEW remain stored in Supabase and are never opened in ChatGPT.
 */
export async function selectPassedForChatgpt(options: {
  sourcePortal: PrescreenSourcePortal;
  sourceTenderIds: string[];
  logger: { info: (msg: string) => void; warn?: (msg: string) => void };
  /** Max PASSED ids to return (default: all). 0 / omitted = unlimited. */
  limit?: number;
  allowMissingPrescreenRow?: boolean;
}): Promise<SelectPassedForChatgptResult> {
  const config = loadPrescreenConfig();
  const skipped: PrescreenSkipRecord[] = [];
  const passedIds: string[] = [];
  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? options.limit
      : Number.POSITIVE_INFINITY;
  // limit <= 0 or omitted → UNLIMITED (never "process zero PASSED rows")

  if (!config.enabled) {
    const all = options.sourceTenderIds.slice(
      0,
      Number.isFinite(limit) ? limit : undefined,
    );
    return {
      passedIds: all,
      skipped: [],
      firstPassedId: all[0] ?? null,
    };
  }

  for (const sourceTenderId of options.sourceTenderIds) {
    if (passedIds.length >= limit) {
      break;
    }

    const gate = await assertPrescreenAllowsChatgpt({
      sourcePortal: options.sourcePortal,
      sourceTenderId,
      logger: options.logger,
      allowMissingPrescreenRow: options.allowMissingPrescreenRow,
    });

    const label =
      options.sourcePortal === "TENDER247"
        ? `T247-${sourceTenderId}`
        : sourceTenderId.toUpperCase().startsWith("BA-")
          ? sourceTenderId
          : `BA-${sourceTenderId}`;

    if (gate.allowed) {
      options.logger.info(`PRESCREEN_PASSED_FOR_CHATGPT=${label}`);
      passedIds.push(sourceTenderId);
      continue;
    }

    options.logger.info(`PRESCREEN_STORED_WITHOUT_CHATGPT=${label}`);
    options.logger.info(`PRESCREEN_STATUS=${gate.status ?? "null"}`);
    options.logger.info(
      `PRESCREEN_REASON_CODE=${gate.reasonCode ?? "null"}`,
    );
    skipped.push({
      sourceTenderId,
      status: gate.status,
      reasonCode: gate.reasonCode,
      message: gate.message,
    });
  }

  return {
    passedIds,
    skipped,
    firstPassedId: passedIds[0] ?? null,
  };
}
