import "server-only";

import { sendPendingRefundReminderEmail } from "@/lib/email/pending-refund-reminder";
import { getCompanyById } from "@/server/repositories/companyRepository";
import { listBidFees } from "@/server/repositories/bidFeeRepository";
import { listUsers } from "@/server/repositories/userRepository";
import { getServerSupabase } from "@/lib/db/server";

export type PendingRefundReminderSendResult = {
  ok: boolean;
  feeCount: number;
  recipientCount: number;
  sent: number;
  failed: number;
  skipped?: boolean;
  error?: string;
  companyId: string;
};

const REMINDER_ROLES = new Set(["ADMIN", "BID_MANAGER"]);

export async function sendCompanyPendingRefundReminders(
  companyId: string,
): Promise<PendingRefundReminderSendResult> {
  const fees = await listBidFees({
    companyId,
    status: "pending_refund",
  });

  if (fees.length === 0) {
    return {
      ok: true,
      companyId,
      feeCount: 0,
      recipientCount: 0,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const [users, company] = await Promise.all([
    listUsers({ companyId }),
    getCompanyById(companyId),
  ]);

  const recipients = users.filter(
    (user) =>
      user.isActive &&
      REMINDER_ROLES.has(user.role) &&
      Boolean(user.email?.trim()),
  );

  if (recipients.length === 0) {
    return {
      ok: false,
      companyId,
      feeCount: fees.length,
      recipientCount: 0,
      sent: 0,
      failed: 0,
      error: "No active Admin or Bid Manager recipients found.",
    };
  }

  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const recipient of recipients) {
    const result = await sendPendingRefundReminderEmail({
      toEmail: recipient.email,
      recipientName: recipient.fullName || recipient.email,
      companyName: company?.name ?? null,
      fees,
    });
    if (result.ok) sent += 1;
    else {
      failed += 1;
      lastError = result.error;
    }
  }

  return {
    ok: failed === 0,
    companyId,
    feeCount: fees.length,
    recipientCount: recipients.length,
    sent,
    failed,
    error: lastError,
  };
}

/** Cron helper: remind every company that has pending_refund fees. */
export async function sendAllCompaniesPendingRefundReminders(): Promise<{
  companies: number;
  results: PendingRefundReminderSendResult[];
}> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_fees")
    .select("company_id")
    .eq("status", "pending_refund");
  if (error) throw new Error(error.message);

  const companyIds = [
    ...new Set(
      (data || [])
        .map((row) => String((row as { company_id?: string }).company_id || ""))
        .filter(Boolean),
    ),
  ];

  const results: PendingRefundReminderSendResult[] = [];
  for (const companyId of companyIds) {
    results.push(await sendCompanyPendingRefundReminders(companyId));
  }

  return { companies: companyIds.length, results };
}
