import { loadPrescreenConfig } from "./prescreenConfig.js";
import { getTenderPrescreenGate } from "./prescreenRepository.js";
import type { PrescreenSourcePortal } from "./prescreenTypes.js";

export type ChatgptPrescreenGateResult = {
  allowed: boolean;
  skipped: boolean;
  reasonCode: string | null;
  status: string | null;
  message: string | null;
};

/**
 * Hard gate before materializing ChatGPT metadata / opening ChatGPT.
 * When PRESCREEN_ENABLED=false, always allows.
 */
export async function assertPrescreenAllowsChatgpt(options: {
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
  logger: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<ChatgptPrescreenGateResult> {
  const config = loadPrescreenConfig();
  if (!config.enabled) {
    return {
      allowed: true,
      skipped: false,
      reasonCode: null,
      status: null,
      message: null,
    };
  }

  const label =
    options.sourcePortal === "TENDER247"
      ? `T247-${options.sourceTenderId}`
      : options.sourceTenderId.toUpperCase().startsWith("BA-")
        ? options.sourceTenderId
        : `BA-${options.sourceTenderId}`;

  const gate = await getTenderPrescreenGate({
    sourcePortal: options.sourcePortal,
    sourceTenderId: options.sourceTenderId,
  });

  if (!gate.ok) {
    options.logger.warn?.(
      `CHATGPT_PRESCREEN_GATE_LOOKUP_FAILED=${label} ${gate.error}`,
    );
    // Fail closed when configured — avoid ChatGPT spend without a known pass
    options.logger.info(`CHATGPT_SKIPPED_BY_PRESCREEN=${label}`);
    options.logger.info("PRESCREEN_STATUS=ERROR");
    options.logger.info("PRESCREEN_REASON_CODE=PRESCREEN_LOOKUP_FAILED");
    return {
      allowed: false,
      skipped: true,
      reasonCode: "PRESCREEN_LOOKUP_FAILED",
      status: "ERROR",
      message: gate.error,
    };
  }

  if (!gate.row) {
    options.logger.info(`CHATGPT_SKIPPED_BY_PRESCREEN=${label}`);
    options.logger.info("PRESCREEN_STATUS=NOT_RUN");
    options.logger.info("PRESCREEN_REASON_CODE=MISSING_PRESCREEN_ROW");
    return {
      allowed: false,
      skipped: true,
      reasonCode: "MISSING_PRESCREEN_ROW",
      status: "NOT_RUN",
      message: "No tender row found for pre-screen gate",
    };
  }

  const status = gate.row.prescreen_status;
  const eligible = gate.row.chatgpt_eligible === true;
  const passed = status === "PASSED" && eligible;

  if (!passed) {
    options.logger.info(`CHATGPT_SKIPPED_BY_PRESCREEN=${label}`);
    options.logger.info(`PRESCREEN_STATUS=${status ?? "null"}`);
    options.logger.info(
      `PRESCREEN_REASON_CODE=${gate.row.prescreen_reason_code ?? "null"}`,
    );
    return {
      allowed: false,
      skipped: true,
      reasonCode: gate.row.prescreen_reason_code,
      status,
      message: `Pre-screen status=${status} eligible=${eligible}`,
    };
  }

  return {
    allowed: true,
    skipped: false,
    reasonCode: gate.row.prescreen_reason_code,
    status,
    message: null,
  };
}

/** Pure helper for tests — decide skip without DB. */
export function shouldSkipChatgptForPrescreenDecision(options: {
  enabled: boolean;
  status: string | null;
  chatgptEligible: boolean | null;
}): boolean {
  if (!options.enabled) {
    return false;
  }
  return !(options.status === "PASSED" && options.chatgptEligible === true);
}
