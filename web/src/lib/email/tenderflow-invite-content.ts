import { escapeHtml } from "@/lib/email/escape-html";

export type TenderFlowInviteMode = "initial" | "resend";

export type TenderFlowInviteEmailInput = {
  mode: TenderFlowInviteMode;
  name: string;
  email: string;
  temporaryPassword: string;
};

export type TenderFlowInviteEmailContent = {
  toEmail: string;
  subject: string;
  body: string;
};

export function normalizeAppUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function buildTenderFlowInviteEmail(
  input: TenderFlowInviteEmailInput,
  appUrl: string,
): TenderFlowInviteEmailContent {
  const safeUrl = normalizeAppUrl(appUrl);
  const isResend = input.mode === "resend";
  const intro = isResend
    ? "Your TenderFlow invitation has been resent. A new temporary password has been generated for your account."
    : "Your TenderFlow account has been created.";

  const body = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
  <p>Hello ${escapeHtml(input.name)},</p>
  <p>${intro}</p>
  <p>You can access TenderFlow using the credentials below.</p>
  <table style="width:100%;max-width:520px;border-collapse:collapse;margin:20px 0;">
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">Application</td>
      <td style="padding:10px;border:1px solid #e5e7eb;">
        <a href="${escapeHtml(safeUrl)}">${escapeHtml(safeUrl)}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">Login Email</td>
      <td style="padding:10px;border:1px solid #e5e7eb;">${escapeHtml(input.email)}</td>
    </tr>
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">Temporary Password</td>
      <td style="padding:10px;border:1px solid #e5e7eb;font-family:monospace;font-weight:600;">${escapeHtml(input.temporaryPassword)}</td>
    </tr>
  </table>
  ${isResend ? "<p>Any previous temporary password is no longer valid.</p>" : ""}
  <p>Please sign in using the link above.</p>
  <p>For security, please change your temporary password after your first login.</p>
  <p>Regards,<br />Siyana Info Solutions Pvt. Ltd.</p>
</div>
`.trim();

  return {
    toEmail: input.email,
    subject: isResend
      ? "Your TenderFlow invitation has been resent"
      : "TenderFlow account invitation",
    body,
  };
}
