"use client";

import { useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string; warnings?: string[]; sources?: Array<{ fileName: string; pageCount: number | null; unavailable?: boolean }> };
const SUGGESTIONS = ["Assess Tender", "Check Eligibility", "Check Similar Experience", "Check Turnover", "Check Government Experience", "Check Required Documents", "Check EMD/MSME", "Identify Risks", "Summarize Tender"];

function AnswerContent({ content }: { content: string }) {
  return <div className="space-y-2 text-sm leading-relaxed text-slate-800">{content.split("\n").map((line, index) => {
    if (line.startsWith("### ")) return <h4 key={index} className="pt-2 text-sm font-semibold">{line.slice(4)}</h4>;
    if (line.startsWith("## ")) return <h3 key={index} className="pt-2 text-base font-semibold">{line.slice(3)}</h3>;
    if (line.startsWith("# ")) return <h2 key={index} className="pt-2 text-lg font-semibold">{line.slice(2)}</h2>;
    if (/^[-*] /.test(line)) return <p key={index} className="pl-3 before:mr-2 before:content-['•']">{line.slice(2)}</p>;
    if (!line.trim()) return <div key={index} className="h-1" />;
    return <p key={index} className={line.includes("|") ? "overflow-x-auto whitespace-pre font-mono text-xs" : ""}>{line}</p>;
  })}</div>;
}

export function TenderAskAiDrawer({ tenderId, tenderTitle, compact = false }: { tenderId: string; tenderTitle: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  async function ask(message: string) {
    const text = message.trim(); if (!text || pending) return;
    const conversation = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]); setInput(""); setPending(true);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/ask-ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, conversation }) });
      const data = await response.json().catch(() => null) as { answer?: string; warnings?: string[]; sources?: Message["sources"]; error?: string } | null;
      if (!response.ok || !data?.answer) throw new Error(data?.error || "Unable to assess this tender.");
      setMessages((current) => [...current, { role: "assistant", content: data.answer!, warnings: data.warnings, sources: data.sources }]);
    } catch (error) { setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Unable to assess this tender." }]); }
    finally { setPending(false); }
  }
  return <>
    <Button type="button" variant="outline" size={compact ? "icon" : "sm"} className={compact ? "size-8" : "h-8 gap-1.5 text-xs"} onClick={() => setOpen(true)} aria-label={`Ask AI about ${tenderTitle}`}><Sparkles className="size-3.5" />{compact ? null : " Ask AI"}</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="flex w-full flex-col border-l border-slate-200 bg-white p-0 sm:max-w-xl">
      <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left"><SheetTitle className="flex items-center gap-2 text-slate-950"><span className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-white"><Bot className="size-4" /></span>Ask AI</SheetTitle><SheetDescription className="line-clamp-2 text-slate-500">Grounded assessment for {tenderTitle}</SheetDescription></SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 px-5 py-5">
        {messages.length === 0 ? <div className="mx-auto max-w-md pt-10"><div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white"><Sparkles className="size-5" /></div><h3 className="text-xl font-semibold text-slate-950">How can I help with this tender?</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">Ask about actual tender documents and your company profile. Documents are retrieved only when you ask.</p><div className="mt-6 grid gap-2 sm:grid-cols-2">{SUGGESTIONS.map((suggestion) => <Button key={suggestion} type="button" variant="outline" size="sm" className={cn("h-auto min-h-10 justify-start rounded-lg border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 shadow-sm hover:bg-slate-50", suggestion === "Assess Tender" && "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:text-white")} disabled={pending} onClick={() => void ask(suggestion)}>{suggestion}</Button>)}</div></div> : messages.map((message, index) => <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}><div className={cn("max-w-[88%] rounded-2xl px-4 py-3", message.role === "user" ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white shadow-sm")}>{message.role === "user" ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">{message.content}</p> : <><AnswerContent content={message.content} />{message.warnings?.length ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{message.warnings.join(" ")}</div> : null}{message.sources?.length ? <p className="mt-3 text-xs text-slate-500">Sources reviewed: {message.sources.map((source) => `${source.fileName}${source.unavailable ? " (unavailable)" : ""}`).join(", ")}</p> : null}</>}</div></div>)}
        {pending ? <div className="flex items-center gap-2 text-sm text-slate-500"><span className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-white"><Loader2 className="size-3.5 animate-spin" /></span>Analyzing tender documents and company evidence…</div> : null}
      </div>
      <form className="bg-white px-4 pb-5 pt-3" onSubmit={(event) => { event.preventDefault(); void ask(input); }}><div className="flex items-end gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-slate-300"><Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(input); } }} placeholder="Message Ask AI…" disabled={pending} rows={1} className="min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-sm text-white shadow-none placeholder:text-slate-400 focus-visible:ring-0" /><Button type="submit" size="icon" className="size-9 shrink-0 rounded-xl bg-white text-slate-900 hover:bg-slate-200" disabled={pending || !input.trim()} aria-label="Send question"><Send className="size-4" /></Button></div><p className="mt-2 text-center text-[11px] text-slate-400">Ask AI uses the tender record, linked documents, and available company evidence.</p></form>
    </SheetContent></Sheet>
  </>;
}
