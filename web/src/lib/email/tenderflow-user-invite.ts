import "server-only";

import { sendPowerAutomateEmail, type SendEmailResult } from "@/lib/email/power-automate-email";
import {
  buildTenderFlowInviteEmail,
  type TenderFlowInviteEmailInput,
} from "@/lib/email/tenderflow-invite-content";

function getAppUrl(): string | undefined {
  return process.env.TENDERFLOW_APP_URL?.trim() || undefined;
}

export async function sendTenderFlowUserInvite(
  input: TenderFlowInviteEmailInput,
): Promise<SendEmailResult> {
  const appUrl = getAppUrl();
  if (!appUrl) {
    return {
      ok: false,
      error:
        "TenderFlow application URL is not configured. Set TENDERFLOW_APP_URL.",
    };
  }

  const payload = buildTenderFlowInviteEmail(input, appUrl);
  return sendPowerAutomateEmail(payload);
}
