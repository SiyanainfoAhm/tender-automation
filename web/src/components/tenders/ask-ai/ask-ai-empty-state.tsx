"use client";
import type {TenderSmartQuestion} from "@/lib/ai/tender-chat-ui";

export function AskAiQuickActions({questions=[],disabled,onSelect,compact=false}:{
 questions?:TenderSmartQuestion[];disabled?:boolean;onSelect:(question:TenderSmartQuestion)=>void;compact?:boolean;
}) {
 if(!questions.length)return null;
 return <div aria-label="Tender quick questions" className={compact?"flex flex-wrap gap-2":"grid min-w-0 grid-cols-2 gap-2"}>
  {questions.map((q,i)=><button key={q.category} type="button" disabled={disabled} title={q.question} onClick={()=>onSelect(q)}
   className={compact?"min-h-11 max-w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-text-secondary hover:border-primary hover:bg-primary-50 disabled:opacity-50":"flex min-h-16 min-w-0 items-start gap-2 rounded-xl border border-border bg-white p-3 text-left text-sm font-medium leading-5 text-text-primary transition-colors hover:border-primary hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"}>
   {!compact?<span aria-hidden="true" className="shrink-0 text-xs font-normal text-text-muted">{String(i+1).padStart(2,'0')}</span>:null}
   <span className="break-words">{q.label}</span>
  </button>)}
 </div>;
}
export function AskAiEmptyState(props:Parameters<typeof AskAiQuickActions>[0]) {
 return <div data-testid="ask-ai-empty-state" className="mx-auto max-w-3xl py-3">
  <span className="inline-flex rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">Your tender intelligence assistant</span>
  <h3 className="mt-4 font-heading text-xl font-semibold text-text-primary">How can I help with this tender?</h3>
  <p className="mb-5 mt-2 text-sm leading-6 text-text-muted">Explore eligibility, documents and deadlines using this tender’s evidence and your company’s records.</p>
  <AskAiQuickActions {...props}/>
 </div>;
}
