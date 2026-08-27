/**
 * Build subject/body for daily Tender247 screening notification emails.
 * Body is HTML with inline styles (Outlook / Power Automate safe).
 */
import { PHASE1_STATUS_DISPLAY } from "../runScreening/phase1Statuses.js";
import type { Phase1ScreeningStatus } from "../runScreening/phase1Statuses.js";

export type ScreeningNotifyKind =
  | "success"
  | "failure"
  | "mismatch"
  | "no_tenders";

export type ProjectNumberGroup = {
  status: Phase1ScreeningStatus;
  ids: string[];
};

export type ScreeningNotifyInput = {
  dateIso: string;
  kind: ScreeningNotifyKind;
  /** Fresh(N) count shown on Tender247 web (null if unavailable). */
  webTenderCount: number | null;
  /** Rows in the Tender247 / uploaded daily Excel. */
  excelRowCount: number;
  /** Screened workbook row count (usually same as excel after GPT). */
  screenedRowCount?: number;
  counts: Record<Phase1ScreeningStatus, number>;
  /** Actionable / shortlist project numbers by status. */
  projectNumbers?: ProjectNumberGroup[];
  errorMessage?: string | null;
  screenedWorkbookPath?: string | null;
  downloadRoot?: string | null;
};

const FONT =
  "Segoe UI, Calibri, Helvetica, Arial, sans-serif";

const STATUS_COLORS: Record<
  Phase1ScreeningStatus,
  { bg: string; text: string; border: string }
> = {
  GO: { bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" },
  CONDITIONAL_GO: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  VERIFY: { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
  PARTNER_BID: { bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" },
  NO_GO: { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" },
};

const KIND_THEME: Record<
  ScreeningNotifyKind,
  { accent: string; headerBg: string; badgeBg: string; badgeText: string; label: string }
> = {
  success: {
    accent: "#0f766e",
    headerBg: "#0f766e",
    badgeBg: "#ccfbf1",
    badgeText: "#115e59",
    label: "COMPLETE",
  },
  failure: {
    accent: "#b91c1c",
    headerBg: "#b91c1c",
    badgeBg: "#fee2e2",
    badgeText: "#991b1b",
    label: "FAILED",
  },
  mismatch: {
    accent: "#c2410c",
    headerBg: "#c2410c",
    badgeBg: "#ffedd5",
    badgeText: "#9a3412",
    label: "MISMATCH",
  },
  no_tenders: {
    accent: "#334155",
    headerBg: "#334155",
    badgeBg: "#e2e8f0",
    badgeText: "#1e293b",
    label: "NO TENDERS",
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCountLine(counts: Record<Phase1ScreeningStatus, number>): string {
  return (
    `Will Bid: ${counts.GO ?? 0}, ` +
    `May Bid: ${counts.CONDITIONAL_GO ?? 0}, ` +
    `Verify: ${counts.VERIFY ?? 0}, ` +
    `Partnership: ${counts.PARTNER_BID ?? 0}, ` +
    `No Bid: ${counts.NO_GO ?? 0}`
  );
}

function metaRow(label: string, value: string): string {
  return (
    `<tr>` +
    `<td style="padding:10px 14px;font-family:${FONT};font-size:13px;color:#64748b;width:42%;border-bottom:1px solid #e2e8f0;vertical-align:top;">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 14px;font-family:${FONT};font-size:13px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;vertical-align:top;">${value}</td>` +
    `</tr>`
  );
}

function statusBadge(status: Phase1ScreeningStatus, count: number): string {
  const colors = STATUS_COLORS[status];
  const label = PHASE1_STATUS_DISPLAY[status] || status;
  return (
    `<td style="padding:6px;width:20%;">` +
    `<div style="background:${colors.bg};border:1px solid ${colors.border};border-radius:8px;padding:12px 8px;text-align:center;">` +
    `<div style="font-family:${FONT};font-size:22px;font-weight:700;color:${colors.text};line-height:1.1;">${count}</div>` +
    `<div style="font-family:${FONT};font-size:11px;font-weight:600;color:${colors.text};margin-top:6px;letter-spacing:0.02em;">${escapeHtml(label)}</div>` +
    `</div>` +
    `</td>`
  );
}

function statusCountCards(counts: Record<Phase1ScreeningStatus, number>): string {
  const order: Phase1ScreeningStatus[] = [
    "GO",
    "CONDITIONAL_GO",
    "VERIFY",
    "PARTNER_BID",
    "NO_GO",
  ];
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">` +
    `<tr>` +
    order.map((s) => statusBadge(s, counts[s] ?? 0)).join("") +
    `</tr>` +
    `</table>` +
    `<p style="margin:0 0 4px 0;font-family:${FONT};font-size:12px;color:#64748b;">` +
    `<strong style="color:#334155;">Status counts:</strong> ${escapeHtml(formatCountLine(counts))}` +
    `</p>`
  );
}

function projectNumbersHtml(groups: ProjectNumberGroup[] | undefined): string {
  if (!groups || groups.length === 0) {
    return (
      `<p style="margin:0;font-family:${FONT};font-size:13px;color:#94a3b8;font-style:italic;">` +
      `No project numbers listed.` +
      `</p>`
    );
  }
  const parts: string[] = [];
  for (const group of groups) {
    if (group.ids.length === 0) continue;
    const label = PHASE1_STATUS_DISPLAY[group.status] || group.status;
    const colors = STATUS_COLORS[group.status] || STATUS_COLORS.NO_GO;
    const chips = group.ids
      .map(
        (id) =>
          `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;background:#ffffff;border:1px solid ${colors.border};border-radius:999px;font-family:${FONT};font-size:12px;font-weight:600;color:${colors.text};">${escapeHtml(id)}</span>`,
      )
      .join("");
    parts.push(
      `<div style="margin:0 0 12px 0;padding:12px 14px;background:${colors.bg};border:1px solid ${colors.border};border-radius:8px;">` +
        `<div style="font-family:${FONT};font-size:13px;font-weight:700;color:${colors.text};margin:0 0 8px 0;">` +
        `${escapeHtml(label)} (${group.ids.length})` +
        `</div>` +
        `<div>${chips}</div>` +
        `</div>`,
    );
  }
  return parts.length > 0
    ? parts.join("")
    : `<p style="margin:0;font-family:${FONT};font-size:13px;color:#94a3b8;font-style:italic;">No project numbers listed.</p>`;
}

function sectionTitle(text: string): string {
  return (
    `<h3 style="margin:0 0 12px 0;font-family:${FONT};font-size:14px;font-weight:700;color:#0f172a;letter-spacing:0.04em;text-transform:uppercase;">` +
    `${escapeHtml(text)}` +
    `</h3>`
  );
}

function wrapEmail(opts: {
  kind: ScreeningNotifyKind;
  title: string;
  subtitle?: string;
  alertHtml?: string;
  metaRows: string[];
  extraHtml?: string;
}): string {
  const theme = KIND_THEME[opts.kind];
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f1f5f9;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">` +
    // header
    `<tr><td style="background:${theme.headerBg};padding:22px 28px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.12em;color:rgba(255,255,255,0.85);text-transform:uppercase;">Tender247 · Daily Screening</td>` +
    `<td align="right">` +
    `<span style="display:inline-block;padding:4px 10px;background:${theme.badgeBg};color:${theme.badgeText};font-family:${FONT};font-size:11px;font-weight:700;border-radius:999px;letter-spacing:0.06em;">${theme.label}</span>` +
    `</td></tr></table>` +
    `<h1 style="margin:12px 0 0 0;font-family:${FONT};font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">${escapeHtml(opts.title)}</h1>` +
    (opts.subtitle
      ? `<p style="margin:8px 0 0 0;font-family:${FONT};font-size:14px;color:rgba(255,255,255,0.9);">${escapeHtml(opts.subtitle)}</p>`
      : "") +
    `</td></tr>` +
    // body
    `<tr><td style="padding:24px 28px 8px 28px;">` +
    (opts.alertHtml || "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px 0;">` +
    opts.metaRows.join("") +
    `</table>` +
    (opts.extraHtml || "") +
    `</td></tr>` +
    // footer
    `<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;">` +
    `<p style="margin:0;font-family:${FONT};font-size:11px;color:#94a3b8;line-height:1.5;">` +
    `Automated notice from tender-automation · Power Automate delivery` +
    `</p>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

export function hasWebExcelCountMismatch(input: {
  webTenderCount: number | null;
  excelRowCount: number;
}): boolean {
  if (input.webTenderCount == null) return false;
  return input.webTenderCount !== input.excelRowCount;
}

export function buildScreeningNotifyEmail(input: ScreeningNotifyInput): {
  subject: string;
  body: string;
} {
  const date = input.dateIso;
  const mismatch = hasWebExcelCountMismatch(input);
  const webLabel =
    input.webTenderCount == null ? "N/A" : String(input.webTenderCount);

  if (input.kind === "failure") {
    const subject = `[Tender247] FAILED — ${date}`;
    const body = wrapEmail({
      kind: "failure",
      title: "Tender247 daily run failed",
      subtitle: date,
      alertHtml:
        `<div style="margin:0 0 18px 0;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:8px;">` +
        `<p style="margin:0;font-family:${FONT};font-size:13px;color:#7f1d1d;"><strong>Error:</strong> ${escapeHtml(input.errorMessage || "Unknown error")}</p>` +
        `</div>`,
      metaRows: [
        metaRow("Date", escapeHtml(date)),
        metaRow("Tender247 web count (Fresh)", escapeHtml(webLabel)),
        metaRow("Excel rows", String(input.excelRowCount)),
        ...(input.downloadRoot
          ? [metaRow("Download folder", escapeHtml(input.downloadRoot))]
          : []),
      ],
    });
    return { subject, body };
  }

  if (input.kind === "no_tenders") {
    const subject = `[Tender247] No tenders found — ${date}`;
    const body = wrapEmail({
      kind: "no_tenders",
      title: "No tenders found for today",
      subtitle: date,
      alertHtml:
        `<p style="margin:0 0 18px 0;font-family:${FONT};font-size:14px;color:#475569;line-height:1.5;">` +
        `No tenders were available to screen for this date.` +
        `</p>`,
      metaRows: [
        metaRow("Date", escapeHtml(date)),
        metaRow("Tender247 web count (Fresh)", escapeHtml(webLabel)),
        metaRow("Excel rows", String(input.excelRowCount)),
      ],
    });
    return { subject, body };
  }

  if (input.kind === "mismatch" || (input.kind === "success" && mismatch)) {
    const subject = `[Tender247] COUNT MISMATCH — ${date} (web ${webLabel} vs Excel ${input.excelRowCount})`;
    const body = wrapEmail({
      kind: "mismatch",
      title: "Tender247 web count does not match Excel",
      subtitle: `Web Fresh ${webLabel} vs Excel ${input.excelRowCount}`,
      alertHtml:
        `<div style="margin:0 0 18px 0;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #c2410c;border-radius:8px;">` +
        `<p style="margin:0;font-family:${FONT};font-size:13px;color:#9a3412;">` +
        `<strong>Action needed:</strong> Fresh count on Tender247 does not match the downloaded Excel row count.` +
        `</p>` +
        `</div>`,
      metaRows: [
        metaRow("Date", escapeHtml(date)),
        metaRow("Tender247 web (Fresh)", escapeHtml(webLabel)),
        metaRow("Downloaded / input Excel rows", String(input.excelRowCount)),
        ...(input.screenedRowCount != null
          ? [metaRow("Screened Excel rows", String(input.screenedRowCount))]
          : []),
        ...(input.screenedWorkbookPath
          ? [metaRow("Screened workbook", escapeHtml(input.screenedWorkbookPath))]
          : []),
        ...(input.downloadRoot
          ? [metaRow("Download folder", escapeHtml(input.downloadRoot))]
          : []),
      ],
      extraHtml:
        sectionTitle("Screening status") +
        statusCountCards(input.counts) +
        `<div style="margin-top:20px;">` +
        sectionTitle("Project numbers") +
        projectNumbersHtml(input.projectNumbers) +
        `</div>`,
    });
    return { subject, body };
  }

  // success
  const subject = `[Tender247] Screening complete — ${date} (${input.excelRowCount} tenders)`;
  const body = wrapEmail({
    kind: "success",
    title: "Tender247 daily screening complete",
    subtitle: `${input.excelRowCount} tenders · ${date}`,
    metaRows: [
      metaRow("Date", escapeHtml(date)),
      metaRow("Tender247 web count (Fresh)", escapeHtml(webLabel)),
      metaRow("Excel rows", String(input.excelRowCount)),
      ...(input.screenedRowCount != null
        ? [metaRow("Screened Excel rows", String(input.screenedRowCount))]
        : []),
      ...(input.screenedWorkbookPath
        ? [metaRow("Screened workbook", escapeHtml(input.screenedWorkbookPath))]
        : []),
      ...(input.downloadRoot
        ? [metaRow("Download folder", escapeHtml(input.downloadRoot))]
        : []),
    ],
    extraHtml:
      sectionTitle("Status counts") +
      statusCountCards(input.counts) +
      // keep legacy list for plain-text / scrapers that expect <li>
      `<ul style="margin:12px 0 20px 0;padding:0 0 0 18px;font-family:${FONT};font-size:13px;color:#334155;line-height:1.7;">` +
      `<li>Will Bid: ${input.counts.GO ?? 0}</li>` +
      `<li>May Bid: ${input.counts.CONDITIONAL_GO ?? 0}</li>` +
      `<li>Verify: ${input.counts.VERIFY ?? 0}</li>` +
      `<li>Partnership: ${input.counts.PARTNER_BID ?? 0}</li>` +
      `<li>No Bid: ${input.counts.NO_GO ?? 0}</li>` +
      `</ul>` +
      sectionTitle("Project numbers (shortlist)") +
      projectNumbersHtml(input.projectNumbers),
  });
  return { subject, body };
}
