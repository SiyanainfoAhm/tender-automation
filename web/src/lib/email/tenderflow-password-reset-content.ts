import { escapeHtml } from "@/lib/email/escape-html";
import { normalizeAppUrl } from "@/lib/email/tenderflow-invite-content";

export type TenderFlowPasswordResetEmailInput = {
  name: string;
  email: string;
  resetUrl: string;
  expiresAt: Date;
};

export type TenderFlowPasswordResetEmailContent = {
  toEmail: string;
  subject: string;
  body: string;
};

export function buildTenderFlowPasswordResetEmail(
  input: TenderFlowPasswordResetEmailInput,
): TenderFlowPasswordResetEmailContent {
  const expiresLabel = input.expiresAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const body = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
  <p>Hello ${escapeHtml(input.name)},</p>
  <p>We received a request to reset your TenderFlow password.</p>
  <p>
    <a href="${escapeHtml(input.resetUrl)}"
       style="display:inline-block;padding:10px 16px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
      Reset your password
    </a>
  </p>
  <p>Or copy and paste this link into your browser:</p>
  <p style="word-break:break-all;">
    <a href="${escapeHtml(input.resetUrl)}">${escapeHtml(input.resetUrl)}</a>
  </p>
  <p>This link expires at ${escapeHtml(expiresLabel)} (IST) and can be used only once.</p>
  <p>If you did not request a password reset, you can safely ignore this email.</p>
  <p>Regards,<br />Siyana Info Solutions Pvt. Ltd.</p>
</div>
`.trim();

  return {
    toEmail: input.email,
    subject: "Reset your TenderFlow password",
    body,
  };
}

export function buildPasswordResetUrl(appUrl: string, rawToken: string): string {
  const base = normalizeAppUrl(appUrl);
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}
