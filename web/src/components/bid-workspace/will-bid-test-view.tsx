"use client";

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
  MapPin,
  MoreHorizontal,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

const tenders = [
  { id: "105584500", source: "Tender247", title: "NGS Data Analysis Platform", organisation: "Sanjay Gandhi Post Graduate Institute of Medical Sciences", place: "Lucknow, Uttar Pradesh", due: "14 Nov 2026", days: "19 Days Left", progress: 50 },
  { id: "GEM/2026/B/1234567", source: "GeM", title: "Web Portal Development & Maintenance", organisation: "Ministry of Education", place: "New Delhi, Delhi", due: "20 Nov 2026", days: "25 Days Left", progress: 30 },
  { id: "EPROC/2026/7890", source: "eProcure", title: "IT Infrastructure Support Services", organisation: "Government of Maharashtra", place: "Mumbai, Maharashtra", due: "10 Nov 2026", days: "15 Days Left", progress: 20 },
  { id: "NP/2026/4567", source: "nProcure", title: "eGovernance Portal Enhancement", organisation: "NIC, Government of India", place: "New Delhi, Delhi", due: "18 Nov 2026", days: "23 Days Left", progress: 70 },
  { id: "105567890", source: "Tender247", title: "Digital Learning Content Development", organisation: "State Council of Educational Research", place: "Bhopal, Madhya Pradesh", due: "25 Nov 2026", days: "30 Days Left", progress: 10 },
  { id: "GEM/2026/B/9876543", source: "GeM", title: "Hospital Management System", organisation: "AIIMS", place: "New Delhi, Delhi", due: "30 Nov 2026", days: "35 Days Left", progress: 0 },
  { id: "EPROC/2026/1122", source: "eProcure", title: "Data Center Support Services", organisation: "Power Grid Corporation", place: "Gurugram, Haryana", due: "22 Nov 2026", days: "27 Days Left", progress: 15 },
];

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
  ["Pay Tender Fee", "Completed", "10 Nov 2026"],
  ["Pay EMD", "Completed", "12 Nov 2026"],
  ["Get Documents Notarized", "Pending", "13 Nov 2026"],
  ["Sign and Stamp All Documents", "Pending", "14 Nov 2026"],
  ["Upload Final Bid on Portal", "Pending", "14 Nov 2026"],
  ["Submit Bid Before Deadline", "Pending", "14 Nov 2026"],
];

function ProgressBar({ value }: { value: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} /></div>;
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "Matched" || status === "Generated" || status === "Completed" ? "bg-emerald-100 text-emerald-700" : status === "Not Found" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

function SectionHeader({ icon, title, meta, action }: { icon: React.ReactNode; title: string; meta: string; action: string }) {
  return <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5"><div className="flex items-center gap-2">{icon}<span className="text-sm font-semibold">{title}</span><span className="text-xs text-slate-500">{meta}</span></div><button className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">{action}<ChevronDown className="size-3.5" /></button></div>;
}

export function WillBidTestView() {
  const [selectedId, setSelectedId] = React.useState(tenders[0].id);
  const [query, setQuery] = React.useState("");
  const selected = tenders.find((item) => item.id === selectedId) ?? tenders[0];
  const filtered = tenders.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight text-slate-950">Will Bid Workspace</h1><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">7 Tenders</span></div><p className="mt-1 text-sm text-slate-500">Manage your Will Bid tenders and complete their checklists</p></div><span className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">Test view</span></div>
    <div className="grid min-h-[760px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="border-r border-slate-200 bg-slate-50/50 p-3"><div className="relative mb-3"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Will Bid tenders..." className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-emerald-400" /></div><div className="space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-205px)]">{filtered.map((item) => { const active = item.id === selectedId; return <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left transition ${active ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-500"><span className="mr-2 rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">{item.source}</span>ID: {item.id}</p></div><ChevronRight className="mt-1 size-4 shrink-0 text-slate-500" /></div><p className="mt-2 truncate text-xs text-slate-600">{item.organisation}</p><div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="size-3.5" />{item.place}</div><div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><CalendarDays className="size-3.5" />{item.due}<span>·</span>{item.days}</div><div className="mt-3 flex items-center gap-3"><ProgressBar value={item.progress} /><span className="w-8 text-right text-xs font-medium text-slate-700">{item.progress}%</span></div></button>; })}</div></aside>
      <section className="min-w-0 bg-white"><div className="border-b border-slate-200 px-4 py-4 lg:px-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-slate-950">{selected.title}</h2><span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">{selected.source}</span><span className="text-xs text-slate-500">ID: {selected.id}</span><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Will Bid</span></div><p className="mt-1 text-sm text-slate-600">{selected.organisation}</p><div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{selected.place}</span><span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{selected.due} ({selected.days})</span></div></div><div className="flex items-center gap-2"><button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">View Tender</button><button className="grid size-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-500"><MoreHorizontal className="size-4" /></button></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-5 text-sm"><button className="border-b-2 border-emerald-500 px-2 py-2 font-semibold text-emerald-700">Checklist</button><button className="px-2 py-2 text-slate-600">Tender Details</button><button className="px-2 py-2 text-slate-600">AI Summary</button><button className="px-2 py-2 text-slate-600">Documents</button><button className="inline-flex items-center gap-1.5 px-2 py-2 text-slate-600"><Bot className="size-4" />Chat with AI</button></div><div className="flex min-w-[220px] items-center gap-3"><div className="flex-1"><p className="mb-1 text-right text-[11px] text-slate-500">Overall Progress</p><ProgressBar value={selected.progress} /></div><span className="text-xs font-medium text-slate-700">{selected.progress}%</span></div></div></div>
      <div className="space-y-3 p-3 lg:p-4"><div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-sky-100 text-sky-600"><FolderOpen className="size-5" /></div><div><p className="text-sm font-semibold">Company Docs</p><p className="text-xs text-slate-500">Use existing company documents</p></div><span className="ml-auto rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">6/8</span></div></div><div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-violet-100 text-violet-600"><Sparkles className="size-5" /></div><div><p className="text-sm font-semibold">AI Draft</p><p className="text-xs text-slate-500">Generate with AI</p></div><span className="ml-auto rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">3/5</span></div></div><div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-orange-100 text-orange-600"><UserRound className="size-5" /></div><div><p className="text-sm font-semibold">Manual</p><p className="text-xs text-slate-500">Action required by user</p></div><span className="ml-auto rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">2/6</span></div></div></div>
      <div className="overflow-hidden rounded-xl border border-sky-200"><SectionHeader icon={<FolderOpen className="size-4 text-sky-600" />} title="Company Docs" meta="(6/8 completed)" action="Match Documents" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Document Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Matched File</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{companyDocs.map((row, index) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2"><span className={`grid size-4 place-items-center rounded border ${row[1] === "Matched" ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{row[1] === "Matched" ? <Check className="size-3" /> : null}</span></td><td className="px-3 py-2 font-medium text-slate-700">{index + 1}. {row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2 text-slate-500"><span className="inline-flex items-center gap-1"><FileText className="size-3.5" />{row[2]}</span></td><td className="px-3 py-2"><button className={`rounded-md border px-2.5 py-1 ${row[1] === "Matched" ? "border-slate-200" : "border-emerald-200 text-emerald-700"}`}>{row[1] === "Matched" ? "View" : "Find Match"}</button></td></tr>)}</tbody></table></div></div>
      <div className="overflow-hidden rounded-xl border border-violet-200"><SectionHeader icon={<Sparkles className="size-4 text-violet-600" />} title="AI Draft" meta="(3/5 completed)" action="Generate Remaining" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Document Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Generated File</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{aiDocs.map((row, index) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2"><span className={`grid size-4 place-items-center rounded border ${row[1] === "Generated" ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{row[1] === "Generated" ? <Check className="size-3" /> : null}</span></td><td className="px-3 py-2 font-medium text-slate-700">{index + 1}. {row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2 text-slate-500">{row[2]}</td><td className="px-3 py-2"><button className={`rounded-md px-2.5 py-1 ${row[1] === "Generated" ? "border border-slate-200" : "bg-violet-100 text-violet-700"}`}>{row[1] === "Generated" ? "View" : "Generate"}</button></td></tr>)}</tbody></table></div></div>
      <div className="overflow-hidden rounded-xl border border-orange-200"><SectionHeader icon={<FileCheck2 className="size-4 text-orange-600" />} title="Manual" meta="(2/6 completed)" action="Mark as Complete" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Task Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Due Date</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody>{manualTasks.map((row, index) => <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2"><span className={`grid size-4 place-items-center rounded border ${row[1] === "Completed" ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{row[1] === "Completed" ? <Check className="size-3" /> : null}</span></td><td className="px-3 py-2 font-medium text-slate-700">{index + 1}. {row[0]}</td><td className="px-3 py-2"><StatusPill status={row[1]} /></td><td className="px-3 py-2 text-slate-500">{row[2]}</td><td className="px-3 py-2"><button className="rounded-md border border-slate-200 px-2.5 py-1">{row[1] === "Completed" ? "View Receipt" : "Mark Complete"}</button></td></tr>)}</tbody></table></div></div>
      </div></section>
    </div>
  </div>;
}
