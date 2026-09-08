import "server-only";

import {
  sendPowerAutomateEmail,
  type SendEmailResult,
} from "@/lib/email/power-automate-email";
import {
  buildPasswordResetUrl,
  buildTenderFlowPasswordResetEmail,
  type TenderFlowPasswordResetEmailInput,
} from "@/lib/email/tenderflow-password-reset-content";

function getAppUrl(): string | undefined {
  return process.env.TENDERFLOW_APP_URL?.trim() || undefined;
}

/**
 * Prefer a dedicated reset webhook when configured; otherwise reuse the
 * shared Power Automate email URL. Fill either env var when the flow is ready.
 */
function getPasswordResetWebhookUrl(): string | undefined {
  return (
    process.env.POWER_AUTOMATE_PASSWORD_RESET_EMAIL_URL?.trim() ||
    process.env.POWER_AUTOMATE_EMAIL_URL?.trim() ||
    undefined
  );
}

export async function sendTenderFlowPasswordResetEmail(
  input: Omit<TenderFlowPasswordResetEmailInput, "resetUrl"> & {
    rawToken: string;
  },
): Promise<SendEmailResult & { resetUrl?: string }> {
  const appUrl = getAppUrl();
  if (!appUrl) {
    return {
      ok: false,
      error:
        "TenderFlow application URL is not configured. Set TENDERFLOW_APP_URL.",
    };
  }

  const hookUrl = getPasswordResetWebhookUrl();
  if (!hookUrl) {
    return {
      ok: false,
      error:
        "TenderFlow email webhook is not configured. Set POWER_AUTOMATE_PASSWORD_RESET_EMAIL_URL or POWER_AUTOMATE_EMAIL_URL.",
    };
  }

  const resetUrl = buildPasswordResetUrl(appUrl, input.rawToken);
  const payload = buildTenderFlowPasswordResetEmail({
    name: input.name,
    email: input.email,
    resetUrl,
    expiresAt: input.expiresAt,
  });

  const result = await sendPowerAutomateEmail(payload, { webhookUrl: hookUrl });
  return result.ok ? { ok: true, resetUrl } : { ...result, resetUrl };
}
