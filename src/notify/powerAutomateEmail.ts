/**
 * Power Automate email webhook for pipeline notifications.
 * Configure POWER_AUTOMATE_EMAIL_URL in .env — payload is dynamic subject + body only.
 * Set POWER_AUTOMATE_EMAIL_ENABLED=true to send (default: false / off).
 *
 * Power Automate trigger schema: src/notify/powerAutomateEmail.schema.json
 * Flow: HTTP request received → Send an email (V2)
 *   Subject = triggerBody()?['subject']
 *   Body    = triggerBody()?['body']   (Is HTML = Yes)
 */
export type PowerAutomatePipelineEmailPayload = {
  subject: string;
  body: string;
};

export type SendPipelineEmailResult =
  | { ok: true }
  | { ok: false; error: string; skipped?: boolean };

/** Build the exact JSON body posted to Power Automate (dynamic fields only). */
export function buildPowerAutomateEmailJson(
  payload: PowerAutomatePipelineEmailPayload,
): { subject: string; body: string } {
  const subject = String(payload.subject ?? "").trim();
  const body = String(payload.body ?? "").trim();
  if (!subject) {
    throw new Error("Power Automate email subject must be a non-empty string");
  }
  if (!body) {
    throw new Error("Power Automate email body must be a non-empty string");
  }
  return { subject, body };
}

export function getPowerAutomateEmailUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    env.POWER_AUTOMATE_EMAIL_URL?.trim() ||
    env.POWER_AUTOMATE_WEBHOOK_URL?.trim() ||
    undefined
  );
}

/** Email send is off unless POWER_AUTOMATE_EMAIL_ENABLED=true (1/yes/on also accepted). */
export function isPowerAutomateEmailEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.POWER_AUTOMATE_EMAIL_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export async function sendPowerAutomatePipelineEmail(
  payload: PowerAutomatePipelineEmailPayload,
  options?: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch },
): Promise<SendPipelineEmailResult> {
  const env = options?.env ?? process.env;
  if (!isPowerAutomateEmailEnabled(env)) {
    return {
      ok: false,
      skipped: true,
      error:
        "POWER_AUTOMATE_EMAIL_ENABLED is false — email notification skipped",
    };
  }
  const hookUrl = getPowerAutomateEmailUrl(env);
  if (!hookUrl) {
    return {
      ok: false,
      skipped: true,
      error:
        "POWER_AUTOMATE_EMAIL_URL is not configured — email notification skipped",
    };
  }

  let jsonBody: { subject: string; body: string };
  try {
    jsonBody = buildPowerAutomateEmailJson(payload);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid email payload",
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonBody),
      redirect: "follow",
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      return {
        ok: false,
        error:
          responseText.slice(0, 500) ||
          `Power Automate webhook failed (${response.status})`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to contact Power Automate webhook",
    };
  }
}
