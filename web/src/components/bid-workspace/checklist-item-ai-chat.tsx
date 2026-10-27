"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { resolveGenerationPolicy } from "@/lib/bid-checklist";
import type { ChecklistDocumentMode } from "@/lib/ai/checklist-document-chat";
import { generateChecklistDocumentAction } from "@/server/actions/bid-workspace";
import type { ChecklistItemRow, ChecklistLinkedDocument } from "@/server/repositories/bidChecklistRepository";

type Message = {role:"user"|"assistant"; text:string; href?:string; fileName?:string; warnings?:string[]};
const MODES: Record<ChecklistDocumentMode,string> = {
  modify:"Modify attachment", regenerate:"Regenerate", recreate:"Recreate from RFP",
};

/** A task chat scoped to exactly one checklist requirement and its linked files. */
export function ChecklistItemAiChat({tenderId,item,disabled=false,onSaved}: {
  tenderId:string; item:ChecklistItemRow; disabled?:boolean; onSaved?:()=>void;
}) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [mode,setMode]=useState<ChecklistDocumentMode>(item.documents.length ? "modify" : "recreate");
  const [sourceKey,setSourceKey]=useState("");
  const [drafts,setDrafts]=useState<ChecklistLinkedDocument[]>([]);
  const [messages,setMessages]=useState<Message[]>([]);
  const [prompt,setPrompt]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const lock=useRef(false);
  const endRef=useRef<HTMLDivElement>(null);
  const attachments=[...drafts,...item.documents.filter(doc=>!drafts.some(d=>d.id===doc.id))].filter(doc=>doc.hasFile);
  const keyOf=(doc:ChecklistLinkedDocument)=>`${doc.source}:${doc.id}`;
  const selected=attachments.find(doc=>keyOf(doc)===(sourceKey || (attachments[0] ? keyOf(attachments[0]) : "")));
  const policy=resolveGenerationPolicy({requirementKey:item.requirementKey,requirementName:item.requirementName,generationAllowed:item.generationAllowed});
  const allowed=policy==="GENERATABLE"||policy==="GENERATABLE_DRAFT_ONLY";
  const sourceRequired=mode==="modify";

  async function send() {
    const instruction=prompt.trim();
    if(lock.current||disabled||!allowed||!instruction||(sourceRequired&&!selected)) return;
    lock.current=true; setBusy(true); setError(null);
    setMessages(previous=>[...previous,{role:"user",text:`${MODES[mode]}${selected&&mode!=="recreate" ? ` · ${selected.fileName||selected.title}` : ""}\n${instruction}`}]);
    try {
      const result=await generateChecklistDocumentAction({
        tenderId,requirementId:item.id,customInstructions:instruction,
        documentChat:{mode,sourceDocument:mode!=="recreate"&&selected ? {id:selected.id,source:selected.source}:undefined},
      });
      if(!result.ok) {setError(result.error); return;}
      const href=`/api/bid-workspace/documents/${result.documentId}`;
      const draft:ChecklistLinkedDocument={id:result.documentId,title:result.title,fileName:result.fileName,
        status:"drafting",versionLabel:result.versionLabel,source:"TENDER",hasFile:true,downloadHref:href,matchedBy:"AI"};
      setDrafts(previous=>[draft,...previous]); setSourceKey(keyOf(draft)); setMode("modify"); setPrompt("");
      setMessages(previous=>[...previous,{role:"assistant",text:"Saved a new draft attachment. Review the document before using it in your bid. Your previous files are preserved.",href,fileName:result.fileName,
        warnings:[...result.missingInformation,...result.warnings]}]);
      onSaved?.(); router.refresh();
      endRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"});
    } catch {setError("Unable to complete this request. Check your connection and try again. Your original attachment is preserved.");}
    finally {setBusy(false);lock.current=false;}
  }

  return <>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>setOpen(true)}
      aria-label={`Ask AI about checklist item ${item.requirementName}`} className="gap-1.5">
      <Sparkles className="size-3.5"/> Ask AI
    </Button>
    <Dialog open={open} onOpenChange={value=>{if(!lock.current)setOpen(value);}}>
      <DialogContent className="flex h-[min(90dvh,780px)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b p-4 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2"><Bot className="size-5 text-emerald-600"/> Checklist AI</DialogTitle>
          <DialogDescription className="break-words">{item.requirementName}</DialogDescription>
        </DialogHeader>
        <div role="log" aria-label="Checklist document conversation" aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            Tell me what to change in this item’s attached document, or create a fresh version from the RFP. Each successful request saves a new Word draft in this checklist item. Follow-up edits use the latest draft. Word layout is rebuilt; review formatting before submission.
          </div>
          {!allowed ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This requirement needs genuine external evidence or a manual action. AI cannot recreate or alter certificates, payment proofs, signed evidence, or submission actions. Use Select or Upload to attach the correct document.</p> : null}
          {messages.map((message,index)=><div key={index} className={`min-w-0 rounded-xl p-3 text-sm leading-6 ${message.role==="user"?"ml-5 bg-emerald-50":"mr-5 border bg-white"}`}>
            <p className="mb-1 text-xs font-semibold text-slate-500">{message.role==="user"?"You":"Checklist AI"}</p>
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
            {message.href ? <a className="mt-2 block break-all font-medium text-emerald-700 underline" href={message.href} target="_blank" rel="noreferrer">Open draft: {message.fileName}</a> : null}
            {message.warnings?.length ? <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><p className="font-semibold">Review required</p><ul className="list-disc pl-4">{message.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></div> : null}
          </div>)}
          {busy ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin"/> Reading evidence and preparing your draft…</p> : null}
          {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <div ref={endRef}/>
        </div>
        <div className="shrink-0 space-y-3 border-t bg-white p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Action
              <select aria-label="Document AI action" value={mode} disabled={busy||disabled||!allowed} onChange={event=>setMode(event.target.value as ChecklistDocumentMode)} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm">
                {Object.entries(MODES).map(([value,label])=><option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            {mode!=="recreate" ? <label className="min-w-0 text-xs font-medium text-slate-600">Attachment
              <select aria-label="Attachment to edit" value={selected?keyOf(selected):""} disabled={busy||disabled||!allowed} onChange={event=>setSourceKey(event.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm">
                {!attachments.length ? <option value="">No attachment available</option> : null}
                {attachments.map(doc=><option key={keyOf(doc)} value={keyOf(doc)}>{doc.fileName||doc.title}</option>)}
              </select>
            </label> : null}
          </div>
          {allowed&&!messages.length ? <div className="flex flex-wrap gap-1.5">{["Make this more detailed and specific to the RFP.","Improve the wording while preserving all facts.","Add a clause-wise compliance table."].map(text=><button key={text} type="button" disabled={busy||disabled} className="rounded-full border px-2.5 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50" onClick={()=>setPrompt(text)}>{text}</button>)}</div> : null}
          <form onSubmit={event=>{event.preventDefault();void send();}} className="space-y-2">
            <Textarea aria-label="Instructions for checklist document" value={prompt} maxLength={6000} disabled={busy||disabled||!allowed} onChange={event=>setPrompt(event.target.value)} placeholder="E.g. Keep the company details, expand the implementation plan, and add a testing schedule…" rows={3} className="max-h-32 min-h-20 resize-none"/>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-slate-500">New unsigned Word draft · Original files preserved</p>
              <Button type="submit" disabled={busy||disabled||!allowed||!prompt.trim()||(sourceRequired&&!selected)} className="gap-2">{busy?<Loader2 className="size-4 animate-spin"/>:<Send className="size-4"/>}{busy?"Working…":"Send & save draft"}</Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
