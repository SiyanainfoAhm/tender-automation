"use client";

import Link from "next/link";
import * as React from "react";
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileText,
  FolderOpen,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

type Tender = {
  id: string;
  title: string;
  organization: string | null;
  reference_no: string | null;
  closing_date: string | null;
};

type Props = { tenders: Tender[] };

const companyDocs = [
  ["Company PAN Certificate", "Matched", "PAN_Certificate.pdf"],
  ["GST Registration Certificate", "Matched", "GST_Certificate.pdf"],
  ["Last 3 Years Turnover Certificates", "Matched", "Turnover_2023_2024_2025.pdf"],
  ["Experience Certificates (3 projects)", "Matched", "Experience_1.pdf (+2 more)"],
  ["Net Worth Certificate", "Not Found", "-"],
  ["EMD Deposit Proof", "Not Found", "-"],
  ["Company Profile", "Matched", "Company_Profile.pdf"],
  ["CA Certificate", "Not Found", "-"],
];
const aiDocs = [
  ["Cover Letter", "Generated", "Cover_Letter.docx"],
  ["Technical Proposal", "Generated", "Technical_Proposal.docx"],
  ["Tender Undertaking", "Pending", "-"],
  ["Bidder Declaration", "Pending", "-"],
  ["Compliance Statement", "Pending", "-"],
];
const manualTasks = [
  ["Pay Tender Fee", "Completed"],
  ["Pay EMD", "Completed"],
  ["Get Documents Notarized", "Pending"],
  ["Sign and Stamp All Documents", "Pending"],
  ["Upload Final Bid on Portal", "Pending"],
  ["Submit Bid Before Deadline", "Pending"],
];

function fmtDate(value: string | null) {
  if (!value) return "No deadline";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function daysLeft(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const n = Math.ceil((d.getTime() - Date.now()) / 86400000);
  return Number.isFinite(n) ? `${Math.max(0, n)} Days Left` : "";
}
function ProgressBar({ value }: { value: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} /></div>;
}
function StatusPill({ status }: { status: string }) {
  const cls = status === "Matched" || status === "Generated" || status === "Completed" ? "bg-emerald-100 text-emerald-700" : status === "Not Found" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}
function ActionLink({ href, children, accent = false }: { href: string; children: React.ReactNode; accent?: boolean }) {
  return <Link href={href} className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-medium ${accent ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{children}</Link>;
}
function SectionHeader({ icon, title, meta, href, action }: { icon: React.ReactNode; title: string; meta: string; href: string; action: string }) {
  return <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5"><div className="flex items-center gap-2">{icon}<span className="text-sm font-semibold">{title}</span><span className="text-xs text-slate-500">{meta}</span></div><Link href={href} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">{action}<ChevronDown className="size-3.5" /></Link></div>;
}

export function WillBidTestView({ tenders }: Props) {
  const [selectedId, setSelectedId] = React.useState(tenders[0]?.id ?? "");
  const [query, setQuery] = React.useState("");
  const selected = tenders.find((t) => t.id === selectedId) ?? tenders[0];
  const filtered = tenders.filter((t) => `${t.title} ${t.organization ?? ""} ${t.reference_no ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  if (!selected) return <div className="rounded-xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">No Will Bid tenders</h1><p className="mt-2 text-sm text-slate-500">Move a tender to GO / Will Bid to use this workspace.</p></div>;

  const workspaceHref = `/tenders/${selected.id}/bid-workspace`;
  const detailHref = `/tenders/${selected.id}`;
  const documentsHref = `/tenders/${selected.id}?tab=documents`;
  const aiSummaryHref = `/tenders/${selected.id}?tab=documents&focus=ai-summary`;
  const progress = 50;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold text-slate-950">Will Bid Workspace</h1><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{tenders.length} Tenders</span></div><p className="mt-1 text-sm text-slate-500">Manage your Will Bid tenders and complete their checklists</p></div><Link href="/will-bid" className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100">Live view</Link></div>

    <div className="grid min-h-[760px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="border-r border-slate-200 bg-slate-50/50 p-3">
        <div className="relative mb-3"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Will Bid tenders..." className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-400" /></div>
        <div className="space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-205px)]">{filtered.map((item) => { const active = item.id === selected.id; return <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left transition ${active ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 truncate text-xs text-slate-500">ID: {item.reference_no || item.id}</p></div><ChevronRight className="mt-1 size-4 shrink-0 text-slate-500" /></div><p className="mt-2 truncate text-xs text-slate-600">{item.organization || "—"}</p><div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600"><CalendarDays className="size-3.5" />{fmtDate(item.closing_date)} {daysLeft(item.closing_date) && `· ${daysLeft(item.closing_date)}`}</div><div className="mt-3 flex items-center gap-3"><ProgressBar value={progress} /><span className="w-8 text-right text-xs font-medium text-slate-700">{progress}%</span></div></button>; })}</div>
      </aside>

      <section className="min-w-0 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 lg:px-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-slate-950">{selected.title}</h2><span className="text-xs text-slate-500">ID: {selected.reference_no || selected.id}</span><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Will Bid</span></div><p className="mt-1 text-sm text-slate-600">{selected.organization || "—"}</p><div className="mt-2 flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="size-3.5" />{fmtDate(selected.closing_date)} {daysLeft(selected.closing_date) && `(${daysLeft(selected.closing_date)})`}</div></div><ActionLink href={detailHref}>View Tender</ActionLink></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-5 text-sm"><Link href={workspaceHref} className="border-b-2 border-emerald-500 px-2 py-2 font-semibold text-emerald-700">Checklist</Link><Link href={detailHref} className="px-2 py-2 text-slate-600 hover:text-slate-950">Tender Details</Link><Link href={aiSummaryHref} className="px-2 py-2 text-slate-600 hover:text-slate-950">AI Summary</Link><Link href={documentsHref} className="px-2 py-2 text-slate-600 hover:text-slate-950">Documents</Link><Link href={detailHref} className="inline-flex items-center gap-1.5 px-2 py-2 text-slate-600 hover:text-slate-950"><Bot className="size-4" />Chat with AI</Link></div><div className="flex min-w-[220px] items-center gap-3"><div className="flex-1"><p className="mb-1 text-right text-[11px] text-slate-500">Overall Progress</p><ProgressBar value={progress} /></div><span className="text-xs font-medium text-slate-700">{progress}%</span></div></div></div>

        <div className="space-y-3 p-3 lg:p-4">
          <div className="grid gap-3 md:grid-cols-3"><Link href={workspaceHref} className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 hover:bg-sky-50"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-sky-100 text-sky-600"><FolderOpen className="size-5" /></div><div><p className="text-sm font-semibold">Company Docs</p><p className="text-xs text-slate-500">Use existing company documents</p></div></div></Link><Link href={workspaceHref} className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 hover:bg-violet-50"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-violet-100 text-violet-600"><Sparkles className="size-5" /></div><div><p className="text-sm font-semibold">AI Draft</p><p className="text-xs text-slate-500">Generate with AI</p></div></div></Link><Link href={workspaceHref} className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 hover:bg-orange-50"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-orange-100 text-orange-600"><UserRound className="size-5" /></div><div><p className="text-sm font-semibold">Manual</p><p className="text-xs text-slate-500">Action required by user</p></div></div></Link></div>

          <div className="overflow-hidden rounded-xl border border-sky-200"><SectionHeader icon={<FolderOpen className="size-4 text-sky-600" />} title="Company Docs" meta="" href={workspaceHref} action="Match Documents" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Document Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Matched File</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{companyDocs.map((row, i) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2"><span className={`grid size-4 place-items-center rounded border ${row[1] === "Matched" ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{row[1] === "Matched" ? <Check className="size-3" /> : null}</span></td><td className="px-3 py-2 font-medium text-slate-700">{i + 1}. {row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2 text-slate-500"><span className="inline-flex items-center gap-1"><FileText className="size-3.5" />{row[2]}</span></td><td className="px-3 py-2"><ActionLink href={workspaceHref} accent={row[1] !== "Matched"}>{row[1] === "Matched" ? "View" : "Find Match"}</ActionLink></td></tr>)}</tbody></table></div></div>

          <div className="overflow-hidden rounded-xl border border-violet-200"><SectionHeader icon={<Sparkles className="size-4 text-violet-600" />} title="AI Draft" meta="" href={workspaceHref} action="Generate Remaining" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Document Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Generated File</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{aiDocs.map((row, i) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium text-slate-700">{row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2 text-slate-500">{row[2]}</td><td className="px-3 py-2"><ActionLink href={workspaceHref}>{row[1] === "Generated" ? "View" : "Generate"}</ActionLink></td></tr>)}</tbody></table></div></div>

          <div className="overflow-hidden rounded-xl border border-orange-200"><SectionHeader icon={<FileCheck2 className="size-4 text-orange-600" />} title="Manual" meta="" href={workspaceHref} action="Mark as Complete" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Task Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{manualTasks.map((row, i) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium text-slate-700">{row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2"><ActionLink href={workspaceHref}>{row[1] === "Completed" ? "View" : "Mark Complete"}</ActionLink></td></tr>)}</tbody></table></div></div>
        </div>
      </section>
    </div>
  </div>;
}
