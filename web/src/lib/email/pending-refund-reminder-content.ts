import { escapeHtml } from "@/lib/email/escape-html";
import {
  BID_FEE_TYPE_LABELS,
  type BidFeeRecord,
  type BidFeeType,
} from "@/lib/bid-fees";
import { normalizeAppUrl } from "@/lib/email/tenderflow-invite-content";

export type PendingRefundReminderEmailContent = {
  toEmail: string;
  subject: string;
  body: string;
};

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
}

function feeTypeLabel(feeType: BidFeeType | string): string {
  return (
    BID_FEE_TYPE_LABELS[feeType as BidFeeType] ||
    String(feeType).replaceAll("_", " ")
  );
}

export function buildPendingRefundReminderEmail(input: {
  toEmail: string;
  recipientName: string;
  companyName?: string | null;
  fees: BidFeeRecord[];
  appUrl: string;
}): PendingRefundReminderEmailContent {
  const safeUrl = normalizeAppUrl(input.appUrl);
  const bidFeesUrl = `${safeUrl}/bid-fees`;
  const count = input.fees.length;
  const total = input.fees.reduce((sum, fee) => sum + fee.amount, 0);
  const currency = input.fees[0]?.currency || "INR";

  const rows = input.fees
    .map((fee) => {
      const tender =
        fee.tenderReference ||
        fee.tenderSourceId ||
        fee.tenderTitle ||
        fee.tenderId;
      return `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(String(tender))}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(fee.tenderTitle || "—")}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(feeTypeLabel(fee.feeType))}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatAmount(fee.amount, fee.currency || currency))}</td>
    </tr>`;
    })
    .join("");

  const companyLine = input.companyName
    ? `<p>Company: <strong>${escapeHtml(input.companyName)}</strong></p>`
    : "";

  const body = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
  <p>Hello ${escapeHtml(input.recipientName)},</p>
  <p>This is a reminder that <strong>${count}</strong> refundable fee${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} still marked <strong>Pending Refund</strong> (total ${escapeHtml(formatAmount(total, currency))}).</p>
  ${companyLine}
  <table style="width:100%;max-width:720px;border-collapse:collapse;margin:20px 0;">
    <thead>
      <tr>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;background:#f9fafb;">Tender</th>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;background:#f9fafb;">Title</th>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;background:#f9fafb;">Fee type</th>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;background:#f9fafb;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p>
    Review and update refund status in TenderFlow:
    <a href="${escapeHtml(bidFeesUrl)}">${escapeHtml(bidFeesUrl)}</a>
  </p>
  <p>Regards,<br />TenderFlow</p>
</div>
`.trim();

  return {
    toEmail: input.toEmail,
    subject: `Pending refund reminder: ${count} fee${count === 1 ? "" : "s"} outstanding`,
    body,
  };
}
