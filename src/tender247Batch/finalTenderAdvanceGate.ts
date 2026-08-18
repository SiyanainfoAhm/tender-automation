import { t247Event } from "./tenderDocumentStage.js";
import {
  FINAL_GATE_RECOVERY_MS,
  inspectTenderArtifactState,
  pendingTimeoutMessage,
  pendingTimeoutReasonFromState,
  type PendingTimeoutReason,
  type TenderArtifactState,
} from "./tenderArtifactState.js";

export type FinalGateLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type FinalTenderAdvanceGateResult = {
  ready: boolean;
  pendingTimeout: boolean;
  pendingReason: PendingTimeoutReason | null;
  pendingMessage: string | null;
  state: TenderArtifactState;
  safeToAdvance: boolean;
  safeToClose: boolean;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logGateCheck(
  logger: FinalGateLogger,
  t247Id: string,
  state: TenderArtifactState,
): void {
  t247Event(logger, t247Id, "FINAL_GATE_CHECK");
  t247Event(logger, t247Id, `metadata=${state.metadataValid}`);
  t247Event(logger, t247Id, `aiSummary=${state.aiSummaryValid}`);
  t247Event(logger, t247Id, `documents=${state.documentsZipValid}`);
}

export function assertPreviousTenderTerminal(options: {
  previousTenderId: string | null;
  previousSafeToAdvance: boolean;
}): void {
  if (!options.previousTenderId) {
    return;
  }
  if (options.previousSafeToAdvance) {
    return;
  }
  throw new Error(
    `T247_PREVIOUS_TENDER_NOT_TERMINAL: ${options.previousTenderId}`,
  );
}

export function assertCanCloseAfterFinalGate(
  t247Id: string,
  gate: FinalTenderAdvanceGateResult,
): void {
  if (gate.safeToClose) {
    return;
  }
  throw new Error(`REFUSING_TO_CLOSE_TENDER_${t247Id}_ARTIFACTS_INCOMPLETE`);
}

export async function runFinalTenderAdvanceGate(options: {
  tenderDir: string;
  t247Id: string;
  logger: FinalGateLogger;
  recoveryBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  retryAi?: () => Promise<void>;
  retryDocuments?: () => Promise<void>;
  retryDelayMs?: number;
}): Promise<FinalTenderAdvanceGateResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const budget = options.recoveryBudgetMs ?? FINAL_GATE_RECOVERY_MS;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const deadline = now() + budget;
  const { tenderDir, t247Id, logger } = options;

  while (true) {
    const state = inspectTenderArtifactState(tenderDir, t247Id);
    logGateCheck(logger, t247Id, state);

    if (state.ready) {
      t247Event(logger, t247Id, "FINAL_GATE=PASS");
      t247Event(logger, t247Id, "SAFE_TO_ADVANCE=true");
      return {
        ready: true,
        pendingTimeout: false,
        pendingReason: null,
        pendingMessage: null,
        state,
        safeToAdvance: true,
        safeToClose: true,
      };
    }

    t247Event(logger, t247Id, "FINAL_GATE=FAIL");
    if (now() >= deadline) {
      const pendingReason = pendingTimeoutReasonFromState(state);
      const pendingMessage = pendingTimeoutMessage(pendingReason);
      t247Event(logger, t247Id, "RECOVERY_DEADLINE_EXCEEDED");
      t247Event(logger, t247Id, `STATUS=${pendingReason}`);
      t247Event(logger, t247Id, "SAFE_TO_ADVANCE_BY_TIMEOUT_EXCEPTION=true");
      logger.warn?.(
        `[T247 ${t247Id}] ${pendingReason}: ${pendingMessage}`,
      );
      return {
        ready: false,
        pendingTimeout: true,
        pendingReason,
        pendingMessage,
        state,
        safeToAdvance: true,
        safeToClose: true,
      };
    }

    if (!state.aiSummaryValid) {
      t247Event(logger, t247Id, "RETRY_AI");
      try {
        await options.retryAi?.();
      } catch (error) {
        logger.warn?.(
          `[T247 ${t247Id}] RETRY_AI_FAILED ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const afterAi = inspectTenderArtifactState(tenderDir, t247Id);
    if (!afterAi.documentsZipValid) {
      t247Event(logger, t247Id, "RETRY_DOCUMENTS");
      try {
        await options.retryDocuments?.();
      } catch (error) {
        logger.warn?.(
          `[T247 ${t247Id}] RETRY_DOCUMENTS_FAILED ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (now() < deadline) {
      const waitMs = Math.min(retryDelayMs, Math.max(0, deadline - now()));
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }
  }
}
