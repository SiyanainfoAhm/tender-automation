'use client';

import {useEffect,useRef,useState} from 'react';
import {MessageSquare,Minus} from 'lucide-react';
import {GlobalChat} from './global-chat';

export function GlobalChatLauncher() {
 const [open,setOpen]=useState(false);
 const [started,setStarted]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 const panel=useRef<HTMLElement>(null);
 const close=()=>{setOpen(false);button.current?.focus();};
 useEffect(()=>{
  if(open)panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
 },[open]);
 return <>
  {started?<section ref={panel} hidden={!open} role="dialog" aria-modal="false" aria-labelledby="floating-ai-title" id="global-ai-panel"
   onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}
   className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-40 h-[min(700px,calc(100dvh-7rem-env(safe-area-inset-bottom)))] w-[calc(100vw-1.5rem)] max-w-[560px] overflow-hidden rounded-2xl border border-border bg-white shadow-2xl sm:right-6">
   <div className="flex h-11 items-center justify-between border-b border-border bg-primary-50 px-3">
    <h2 id="floating-ai-title" className="text-sm font-semibold text-primary-700">Global AI assistant</h2>
    <button type="button" aria-label="Minimize Ask AI" onClick={close} className="flex size-10 items-center justify-center rounded-lg text-text-secondary hover:bg-white"><Minus className="size-5" aria-hidden="true"/></button>
   </div>
   <div className="h-[calc(100%_-_2.75rem)] min-h-0"><GlobalChat embedded/></div>
  </section>:null}
  <button ref={button} type="button" aria-label={open?'Close global Ask AI':'Open global Ask AI'} aria-expanded={open} aria-controls={started?'global-ai-panel':undefined}
   onClick={()=>{if(open)close();else{setStarted(true);setOpen(true);}}}
   className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:right-6">
   <MessageSquare className="size-6" aria-hidden="true"/>
  </button>
 </>;
}

