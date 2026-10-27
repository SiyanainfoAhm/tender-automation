"use client";
import {Send,Square} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";

export function AskAiComposer({value,onChange,onSend,onStop,busy,disabled}:{
 value:string;onChange:(value:string)=>void;onSend:()=>void;onStop:()=>void;busy:boolean;disabled?:boolean;
}) {
 return <form className="shrink-0 border-t border-border bg-white p-3 sm:px-4" data-testid="ask-ai-composer"
  onSubmit={event=>{event.preventDefault();if(busy){onStop();return;}onSend();}}>
  <div className="flex min-w-0 items-end gap-2">
   <Textarea value={value} onChange={event=>onChange(event.target.value)}
    onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!busy&&value.trim())onSend();}}}
    placeholder="Ask about this tender…" disabled={disabled||busy} rows={2}
    className="min-h-12 max-h-28 min-w-0 flex-1 resize-none rounded-xl border-border px-3 py-3 text-base text-text-primary shadow-none placeholder:text-text-muted focus-visible:ring-primary"
    aria-label="Ask AI message"/>
   {busy?<Button type="button" variant="outline" className="h-12 shrink-0 gap-1.5 rounded-xl px-3" onClick={onStop} aria-label="Stop generating" data-testid="ask-ai-stop"><Square className="size-3 fill-current" aria-hidden/>Stop</Button>
    :<Button type="submit" className="h-12 shrink-0 gap-1.5 rounded-xl bg-primary px-4 text-sm text-white hover:bg-primary/90" disabled={!value.trim()||disabled} aria-label="Send question" data-testid="ask-ai-send"><Send className="size-4" aria-hidden/>Send</Button>}
  </div>
  <p className="mt-2 text-center text-[10px] text-text-muted">Answers use this tender’s documents and your company’s evidence.</p>
 </form>;
}
