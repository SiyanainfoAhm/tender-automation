/**
 * Batch lifecycle invariants for ChatGPT qualification.
 * Pure helpers — RESPONSE_PENDING must never terminate the queue.
 */

export function shouldExitBatchWhileQueueRemains(options: {
  remainingQueued: number;
  status?: "FAILED_FATAL" | "OPERATOR_CANCELLED" | "RUNNING" | "COMPLETE";
}): boolean {
  if (
    options.status === "FAILED_FATAL" ||
    options.status === "OPERATOR_CANCELLED"
  ) {
    return true;
  }
  // Never print terminal exit while work remains.
  return options.remainingQueued <= 0;
}

/**
 * Leaving the whole browser open because one chat is response_pending
 * is forbidden — pending is candidate-specific recovery.
 */
export function shouldLeaveBrowserOpenSolelyForResponsePending(options: {
  hasResponsePending: boolean;
  remainingQueued: number;
}): boolean {
  void options.hasResponsePending;
  void options.remainingQueued;
  return false;
}

/**
 * After Send, project navigation / reload / fresh-composer prep is forbidden
 * until the candidate reaches a terminal state.
 */
export function mayMutatePageAfterPromptSubmitted(options: {
  promptSubmitted: boolean;
  candidateTerminal: boolean;
}): boolean {
  if (!options.promptSubmitted) return true;
  return options.candidateTerminal;
}

/**
 * While WAITING_FOR_SEND_SLOT: no refresh / reupload / repaste.
 */
export function mayMutateComposerWhileWaitingForSendSlot(
  waitingForSendSlot: boolean,
): boolean {
  return !waitingForSendSlot;
}
