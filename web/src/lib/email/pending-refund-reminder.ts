import "server-only";

import { sendPowerAutomateEmail, type SendEmailResult } from "@/lib/email/power-automate-email";
import { buildPendingRefundReminderEmail } from "@/lib/email/pending-refund-reminder-content";
import type { BidFeeRecord } from "@/lib/bid-fees";

function getAppUrl(): string | undefined {
  return process.env.TENDERFLOW_APP_URL?.trim() || undefined;
}

export async function sendPendingRefundReminderEmail(input: {
  toEmail: string;
  recipientName: string;
  companyName?: string | null;
  fees: BidFeeRecord[];
}): Promise<SendEmailResult> {
  const appUrl = getAppUrl();
  if (!appUrl) {
    return {
      ok: false,
      error:
        "TenderFlow application URL is not configured. Set TENDERFLOW_APP_URL.",
    };
  }
  if (input.fees.length === 0) {
    return { ok: false, error: "No pending refund fees to include." };
  }

  const payload = buildPendingRefundReminderEmail({
    ...input,
    appUrl,
  });
  return sendPowerAutomateEmail(payload);
}
