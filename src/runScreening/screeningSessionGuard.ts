/**
 * ChatGPT must stay open until the generated screening workbook is
 * downloaded (or an explicit terminal failure is recorded).
 */
import { AutomationError } from "../browserUtils.js";

export type ChatGptScreeningCloseState = {
  submitted: boolean;
  downloaded: boolean;
  validated?: boolean;
  explicitTerminalFailure: boolean;
};

export function assertChatGptScreeningSafeToClose(
  state: ChatGptScreeningCloseState,
): void {
  if (state.submitted && !state.downloaded && !state.explicitTerminalFailure) {
    throw new AutomationError(
      "REFUSING_TO_CLOSE_CHATGPT_SCREENING",
      "REFUSING_TO_CLOSE_CHATGPT_SCREENING: generated workbook not downloaded",
    );
  }
}

export function isChatGptScreeningSafeToClose(
  state: ChatGptScreeningCloseState,
): boolean {
  if (!state.submitted) return true;
  if (state.downloaded) return true;
  return state.explicitTerminalFailure;
}

export const SCREENING_CLOSE_REFUSAL_CODE = "REFUSING_TO_CLOSE_CHATGPT_SCREENING";
