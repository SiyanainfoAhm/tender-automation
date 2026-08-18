/**
 * Strict sequential selected-tender artifact acquisition (concurrency = 1).
 */
export type SequentialAcquisitionEvent = string;

export type SequentialAcquisitionCounters = {
  selected: number;
  completed: number;
  full: number;
  partial: number;
  none: number;
  metadataSuccess: number;
  aiSummarySuccess: number;
  documentsSuccess: number;
};

export async function runSequentialArtifactAcquisition<T>(options: {
  candidates: T[];
  getId: (candidate: T) => string;
  process: (candidate: T, index: number, total: number) => Promise<{
    evidenceMode?: string;
    metadataOk?: boolean;
    aiOk?: boolean;
    documentsOk?: boolean;
    complete?: boolean;
    pendingTimeout?: boolean;
    dropped?: boolean;
    safeToAdvance?: boolean;
  } | void>;
  logger?: { info: (msg: string) => void };
  onEvent?: (event: SequentialAcquisitionEvent) => void;
  gptStarted?: { count: number };
}): Promise<SequentialAcquisitionCounters> {
  const { candidates, getId, process, logger, onEvent, gptStarted } = options;
  const total = candidates.length;
  logger?.info("T247_PHASE=ARTIFACT_ACQUISITION");
  const emit = (event: string) => {
    onEvent?.(event);
    logger?.info(event);
  };

  const counters: SequentialAcquisitionCounters = {
    selected: total,
    completed: 0,
    full: 0,
    partial: 0,
    none: 0,
    metadataSuccess: 0,
    aiSummarySuccess: 0,
    documentsSuccess: 0,
  };

  let previousTenderId: string | null = null;
  let previousSafeToAdvance = true;

  for (let index = 0; index < candidates.length; index += 1) {
    if ((gptStarted?.count ?? 0) > 0) {
      throw new Error(
        "T247_SEQUENTIAL_PROCESSING_INVARIANT_VIOLATION GPT started during artifact acquisition",
      );
    }
    if (previousTenderId && !previousSafeToAdvance) {
      throw new Error(`T247_PREVIOUS_TENDER_NOT_TERMINAL: ${previousTenderId}`);
    }
    const candidate = candidates[index]!;
    const id = getId(candidate);
    logger?.info(`T247_SELECTED_INDEX=${index + 1}/${total}`);
    emit(`T247_ARTIFACT_TRANSACTION_START=${id}`);
    logger?.info(`[T247 ${id}] DETAIL_OPENED`);
    const result = await process(candidate, index + 1, total);
    previousTenderId = id;
    previousSafeToAdvance = Boolean(
      result?.safeToAdvance ||
        result?.complete ||
        result?.pendingTimeout ||
        result?.dropped,
    );
    if (!previousSafeToAdvance) {
      throw new Error(`T247_PREVIOUS_TENDER_NOT_TERMINAL: ${id}`);
    }
    counters.completed += 1;
    if (result?.metadataOk) counters.metadataSuccess += 1;
    if (result?.aiOk) counters.aiSummarySuccess += 1;
    if (result?.documentsOk) counters.documentsSuccess += 1;
    const mode = (result?.evidenceMode || "").toUpperCase();
    if (mode === "FULL") counters.full += 1;
    else if (mode === "NONE") counters.none += 1;
    else if (mode) counters.partial += 1;
    emit(`T247_ARTIFACT_TRANSACTION_COMPLETE=${id}`);
  }

  logger?.info("T247_ARTIFACT_ACQUISITION_BATCH_COMPLETE=true");
  logger?.info("T247_SELECTED_ARTIFACT_BATCH_COMPLETE=true");
  emit("T247_SELECTED_ARTIFACT_BATCH_COMPLETE=true");
  logger?.info(`SELECTED_TENDERS=${counters.selected}`);
  logger?.info(`ARTIFACT_TRANSACTIONS_COMPLETED=${counters.completed}`);
  logger?.info(`FULL_EVIDENCE=${counters.full}`);
  logger?.info(`PARTIAL_EVIDENCE=${counters.partial}`);
  logger?.info(`NO_EVIDENCE=${counters.none}`);
  logger?.info(`METADATA_SUCCESS=${counters.metadataSuccess}`);
  logger?.info(`AI_SUMMARY_SUCCESS=${counters.aiSummarySuccess}`);
  logger?.info(`DOCUMENTS_SUCCESS=${counters.documentsSuccess}`);
  return counters;
}
