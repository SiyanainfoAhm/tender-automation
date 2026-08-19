import { t247Event } from "./tenderDocumentStage.js";
import {
  FINAL_GATE_RECOVERY_MS,
  inspectTenderArtifactState,
  pendingTimeoutMessage,
  pendingTimeoutReasonFromState,
  type PendingTimeoutReason,
  type TenderArtifactState,
} from "./tenderArtifactState.js";
import {
  isAiSummaryInProgress,
  isAiSummaryTerminal,
  isAiSummaryTerminalFailure,
  resolveAiSummaryStage,
  type AiSummaryStage,
} from "./aiSummaryStage.js";

export type FinalGateLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type FinalGateOutcome =
  | "COMPLETE"
  | "COMPLETE_WITH_AI_MISSING"
  | "WAIT"
  | "BLOCK_DOCUMENTS"
  | "BLOCK_METADATA";

export type FinalArtifactGateDecision = {
  coreArtifactsReady: boolean;
  aiTerminal: boolean;
  aiInProgress: boolean;
  aiStage: AiSummaryStage;
  safeToAdvance: boolean;
  safeToClose: boolean;
  shouldRetryAi: boolean;
  shouldRetryDocuments: boolean;
  outcome: FinalGateOutcome;
};

export type FinalTenderAdvanceGateResult = {
  ready: boolean;
  pendingTimeout: boolean;
  pendingReason: PendingTimeoutReason | null;
  pendingMessage: string | null;
  state: TenderArtifactState;
  safeToAdvance: boolean;
  safeToClose: boolean;
  completeWithAiMissing?: boolean;
  aiStage?: AiSummaryStage;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function evaluateFinalArtifactGate(options: {
  metadataValid: boolean;
  documentsZipValid: boolean;
  aiSummaryValid: boolean;
  aiStage: AiSummaryStage;
}): FinalArtifactGateDecision {
  const aiStage = options.aiSummaryValid ? "COMPLETE" : options.aiStage;
  const coreArtifactsReady = options.metadataValid && options.documentsZipValid;
  const aiTerminal = isAiSummaryTerminal(aiStage, options.aiSummaryValid);
  const aiInProgress = !options.aiSummaryValid && isAiSummaryInProgress(aiStage);
  const safeToAdvance = coreArtifactsReady && aiTerminal;
  const shouldRetryDocuments = !options.documentsZipValid;
  const shouldRetryAi =
    !options.aiSummaryValid &&
    !isAiSummaryTerminalFailure(aiStage) &&
    !aiInProgress;

  let outcome: FinalGateOutcome;
  if (coreArtifactsReady && options.aiSummaryValid) {
    outcome = "COMPLETE";
  } else if (coreArtifactsReady && isAiSummaryTerminalFailure(aiStage)) {
    outcome = "COMPLETE_WITH_AI_MISSING";
  } else if (coreArtifactsReady && (aiInProgress || shouldRetryAi)) {
    outcome = "WAIT";
  } else if (!options.documentsZipValid) {
    outcome = "BLOCK_DOCUMENTS";
  } else {
    outcome = "BLOCK_METADATA";
  }

  return {
    coreArtifactsReady,
    aiTerminal,
    aiInProgress,
    aiStage,
    safeToAdvance,
    safeToClose: safeToAdvance,
    shouldRetryAi: shouldRetryAi && !safeToAdvance,
    shouldRetryDocuments,
    outcome,
  };
}

function logGateCheck(
  logger: FinalGateLogger,
  t247Id: string,
  state: TenderArtifactState,
  aiStage: AiSummaryStage,
): void {
  t247Event(logger, t247Id, "FINAL_GATE_CHECK");
  t247Event(logger, t247Id, `metadata=${state.metadataValid}`);
  t247Event(logger, t247Id, `aiSummary=${state.aiSummaryValid}`);
  t247Event(logger, t247Id, `aiStage=${aiStage}`);
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
  getAiStage?: () => AiSummaryStage | string | null | undefined;
  aiStage?: AiSummaryStage | string | null;
}): Promise<FinalTenderAdvanceGateResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const budget = options.recoveryBudgetMs ?? FINAL_GATE_RECOVERY_MS;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const deadline = now() + budget;
  const { tenderDir, t247Id, logger } = options;

  while (true) {
    const state = inspectTenderArtifactState(tenderDir, t247Id);
    const aiStage = resolveAiSummaryStage({
      tenderDir,
      aiSummaryValid: state.aiSummaryValid,
      explicitStage: options.getAiStage?.() ?? options.aiStage,
    });
    const decision = evaluateFinalArtifactGate({
      metadataValid: state.metadataValid,
      documentsZipValid: state.documentsZipValid,
      aiSummaryValid: state.aiSummaryValid,
      aiStage,
    });
    logGateCheck(logger, t247Id, state, decision.aiStage);

    if (decision.safeToAdvance) {
      if (decision.outcome === "COMPLETE_WITH_AI_MISSING") {
        t247Event(logger, t247Id, "AI_SUMMARY_DOWNLOAD_FAILED");
        t247Event(logger, t247Id, "AI_SUMMARY_NON_BLOCKING=true");
        t247Event(logger, t247Id, `AI_SUMMARY_STATUS=${decision.aiStage}`);
        t247Event(logger, t247Id, "AI_SUMMARY_RECOVERY_PENDING=true");
      }
      t247Event(logger, t247Id, "CORE_ARTIFACT_GATE=PASS");
      t247Event(logger, t247Id, "SAFE_TO_ADVANCE=true");
      t247Event(logger, t247Id, "FINAL_GATE=PASS");
      return {
        ready: decision.outcome === "COMPLETE",
        pendingTimeout: false,
        pendingReason: null,
        pendingMessage: null,
        state,
        safeToAdvance: true,
        safeToClose: true,
        completeWithAiMissing: decision.outcome === "COMPLETE_WITH_AI_MISSING",
        aiStage: decision.aiStage,
      };
    }

    if (decision.outcome === "WAIT") {
      t247Event(logger, t247Id, "WAIT");
      t247Event(logger, t247Id, "CORE_ARTIFACT_GATE=PASS");
    } else {
      t247Event(logger, t247Id, "FINAL_GATE=FAIL");
    }

    if (now() >= deadline) {
      if (decision.aiInProgress) {
        t247Event(logger, t247Id, "REFUSING_TO_CLOSE_AI_IN_PROGRESS");
      }
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
        aiStage: decision.aiStage,
      };
    }

    if (decision.shouldRetryAi) {
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
