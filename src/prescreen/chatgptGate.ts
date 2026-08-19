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
export const PHASE1_IGNORED_QUALIFICATION_PRESCREEN_REASONS = [
  "AMBIGUOUS_SCOPE",
  "EMD_ABOVE_LIMIT",
  "TENDER_VALUE_ABOVE_LIMIT",
  "MISSING_REQUIRED_SUMMARY",
  "NON_IT_SCOPE",
  "INSUFFICIENT_LEAD_TIME",
  "CLOSING_DATE_EXPIRED",
  "CLOSING_DATE_TODAY",
] as const;

/**
 * Phase-1 VERIFY / MAY_BID / WILL_BID is the business screen.
 * Individual qualification must not re-apply company preference rules.
 */
export function isPhase1IgnoredQualificationPrescreenReason(
  reasonCode: string | null | undefined,
): boolean {
  const code = String(reasonCode || "").trim().toUpperCase();
  return (PHASE1_IGNORED_QUALIFICATION_PRESCREEN_REASONS as readonly string[]).includes(
    code,
  );
}

export async function assertPrescreenAllowsChatgpt(options: {
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
  logger: { info: (msg: string) => void; warn?: (msg: string) => void };
  /**
   * GPT-ready tenders already survived crawl screening. Missing/error
   * prescreen rows must not silently drop them from the queue.
   */
  allowMissingPrescreenRow?: boolean;
  /**
   * Phase-1 workbook already admitted this tender (VERIFY / MAY_BID / WILL_BID).
   * Business prescreen reasons must not skip individual qualification.
   */
  phase1Admitted?: boolean;
}): Promise<ChatgptPrescreenGateResult> {
  const label =
    options.sourcePortal === "TENDER247"
      ? `T247-${options.sourceTenderId}`
      : options.sourceTenderId.toUpperCase().startsWith("BA-")
        ? options.sourceTenderId
        : `BA-${options.sourceTenderId}`;

  if (options.phase1Admitted) {
    options.logger.info(`CHATGPT_PHASE1_ADMITTED=${label}`);
    options.logger.info("CHATGPT_BUSINESS_PRESCREEN_IGNORED=true");
    return {
      allowed: true,
      skipped: false,
      reasonCode: null,
      status: "PHASE1_ADMITTED",
      message: "Phase-1 workbook is authoritative for business screening",
    };
  }

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

  const gate = await getTenderPrescreenGate({
    sourcePortal: options.sourcePortal,
    sourceTenderId: options.sourceTenderId,
  });

  if (!gate.ok) {
    if (options.allowMissingPrescreenRow) {
      options.logger.warn?.(
        `CHATGPT_PRESCREEN_LOOKUP_FAILED_ALLOW_READY=${label} ${gate.error}`,
      );
      return {
        allowed: true,
        skipped: false,
        reasonCode: "PRESCREEN_LOOKUP_FAILED",
        status: "ERROR",
        message: gate.error,
      };
    }
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
    if (options.allowMissingPrescreenRow) {
      options.logger.info(`CHATGPT_PRESCREEN_ROW_MISSING_ALLOW_READY=${label}`);
      return {
        allowed: true,
        skipped: false,
        reasonCode: "MISSING_PRESCREEN_ROW",
        status: "NOT_RUN",
        message: "No tender row found for pre-screen gate; GPT-ready allowed",
      };
    }
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
  const explicitBlock = isExplicitPrescreenChatgptBlock({
    status,
    chatgptEligible: gate.row.chatgpt_eligible,
  });

  if (explicitBlock) {
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

  if (!passed && options.allowMissingPrescreenRow) {
    options.logger.info(
      `CHATGPT_PRESCREEN_NON_PASSED_ALLOW_READY=${label} status=${status ?? "null"}`,
    );
    return {
      allowed: true,
      skipped: false,
      reasonCode: gate.row.prescreen_reason_code ?? "MISSING_PASSED_ROW",
      status,
      message: "GPT-ready allowed without stored PASSED row",
    };
  }

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

/** Rejected / manual-review rows must never open ChatGPT. */
export function isExplicitPrescreenChatgptBlock(options: {
  status: string | null;
  chatgptEligible: boolean | null;
}): boolean {
  const status = String(options.status || "").toUpperCase();
  if (status === "REJECTED" || status === "MANUAL_REVIEW") {
    return true;
  }
  return status === "PASSED" && options.chatgptEligible === false;
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
