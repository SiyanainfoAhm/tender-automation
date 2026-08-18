import "server-only";

export type PowerAutomateEmailPayload = {
  toEmail: string;
  subject: string;
  body: string;
};

export type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string };

function getWebhookUrl(): string | undefined {
  return process.env.POWER_AUTOMATE_EMAIL_URL?.trim() || undefined;
}

export async function sendPowerAutomateEmail(
  payload: PowerAutomateEmailPayload,
): Promise<SendEmailResult> {
  const hookUrl = getWebhookUrl();

  if (!hookUrl) {
    return {
      ok: false,
      error:
        "TenderFlow email webhook is not configured. Set POWER_AUTOMATE_EMAIL_URL.",
    };
  }

  try {
    const response = await fetch(hookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      console.error("[TenderFlow invite] Power Automate failed", {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText.slice(0, 1000),
      });
      return {
        ok: false,
        error: responseText || `Email webhook failed (${response.status}).`,
      };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      "[TenderFlow invite] Power Automate request error",
      error instanceof Error ? error.message : "Unknown error",
    );
    return {
      ok: false,
      error: "Unable to contact the email service.",
    };
  }
}
