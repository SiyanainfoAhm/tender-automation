/**
 * Send post-screening Power Automate notification after GPT Excel + Supabase upsert.
 */
import type { Logger } from "../logger.js";
import type { Phase1ScreeningStatus } from "../runScreening/phase1Statuses.js";
import { readRunWorkbook } from "../runScreening/runWorkbook.js";
import {
  buildScreeningNotifyEmail,
  hasWebExcelCountMismatch,
  type ProjectNumberGroup,
  type ScreeningNotifyKind,
} from "./buildScreeningNotifyEmail.js";
import { sendPowerAutomatePipelineEmail } from "./powerAutomateEmail.js";

export type NotifyAfterScreeningInput = {
  dateIso: string;
  dateFolder: string;
  webTenderCount: number | null;
  excelRowCount: number;
  screenedRowCount: number;
  counts: Record<Phase1ScreeningStatus, number>;
  screenedWorkbookPath: string | null;
  /** When screening/upsert failed before a complete workbook existed. */
  errorMessage?: string | null;
  logger?: Logger;
};

function collectProjectNumbers(
  screenedWorkbookPath: string | null,
): ProjectNumberGroup[] {
  if (!screenedWorkbookPath) return [];
  try {
    const rows = readRunWorkbook(screenedWorkbookPath);
    const byStatus = new Map<Phase1ScreeningStatus, string[]>();
    for (const row of rows) {
      const status = row.screeningStatus;
      if (!status || status === "NO_GO") continue;
      const id = row.tender247Id || row.canonicalId;
      if (!id) continue;
      const list = byStatus.get(status) || [];
      list.push(id.startsWith("T247-") || id.startsWith("BA-") ? id : id);
      byStatus.set(status, list);
    }
    const order: Phase1ScreeningStatus[] = [
      "GO",
      "CONDITIONAL_GO",
      "VERIFY",
      "PARTNER_BID",
    ];
    return order
      .filter((s) => (byStatus.get(s) || []).length > 0)
      .map((status) => ({
        status,
        ids: [...new Set(byStatus.get(status) || [])],
      }));
  } catch {
    return [];
  }
}

function resolveKind(input: NotifyAfterScreeningInput): ScreeningNotifyKind {
  if (input.errorMessage) return "failure";
  if (input.excelRowCount === 0 && (input.webTenderCount ?? 0) === 0) {
    return "no_tenders";
  }
  if (
    hasWebExcelCountMismatch({
      webTenderCount: input.webTenderCount,
      excelRowCount: input.excelRowCount,
    })
  ) {
    return "mismatch";
  }
  return "success";
}

export async function notifyAfterScreeningAndUpsert(
  input: NotifyAfterScreeningInput,
): Promise<{ kind: ScreeningNotifyKind; emailOk: boolean; error?: string }> {
  const kind = resolveKind(input);
  const projectNumbers =
    kind === "failure" ? [] : collectProjectNumbers(input.screenedWorkbookPath);

  const email = buildScreeningNotifyEmail({
    dateIso: input.dateIso,
    kind,
    webTenderCount: input.webTenderCount,
    excelRowCount: input.excelRowCount,
    screenedRowCount: input.screenedRowCount,
    counts: input.counts,
    projectNumbers,
    errorMessage: input.errorMessage,
    screenedWorkbookPath: input.screenedWorkbookPath,
    downloadRoot: input.dateFolder,
  });

  input.logger?.info(`NOTIFY_EMAIL_KIND=${kind}`);
  input.logger?.info(`NOTIFY_EMAIL_SUBJECT=${email.subject}`);
  console.log(`NOTIFY_EMAIL_KIND=${kind}`);
  console.log(`NOTIFY_EMAIL_SUBJECT=${email.subject}`);

  const result = await sendPowerAutomatePipelineEmail(email);
  if (result.ok) {
    input.logger?.info("NOTIFY_EMAIL_SENT=true");
    console.log("NOTIFY_EMAIL_SENT=true");
    return { kind, emailOk: true };
  }

  const msg = result.error;
  if (result.skipped) {
    input.logger?.warn(`NOTIFY_EMAIL_SKIPPED=${msg}`);
    console.log(`NOTIFY_EMAIL_SKIPPED=${msg}`);
  } else {
    input.logger?.error(`NOTIFY_EMAIL_FAILED=${msg}`);
    console.error(`NOTIFY_EMAIL_FAILED=${msg}`);
  }
  return { kind, emailOk: false, error: msg };
}
