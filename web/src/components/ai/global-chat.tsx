'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {ChatStatusChange} from './chat-status-change';
import {useStatusChangePermission} from './use-status-change-permission';
import {isStatusChangeRequest,tenderIdFromCommand,type StatusTenderOption} from '@/lib/ai/status-change';
import { GLOBAL_QUESTIONS, type GlobalMessage, type GlobalPresentation } from '@/lib/ai/global-chat';

type Session = {id:string;title:string;last_message_at:string};
type Payload = {error?:string;sessions?:Session[];messages?:GlobalMessage[];session_id?:string;answer?:string;presentation?:GlobalPresentation};
type StreamUpdate={type:string;message?:string;summary?:string;details?:string};
async function call(body:Record<string,unknown>,onUpdate?:(event:StreamUpdate)=>void):Promise<Payload> {
 const r=await fetch('/api/ask-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(r.ok&&r.headers?.get('content-type')?.includes('text/event-stream')&&r.body){
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',result:Payload|undefined;
  const consume=(line:string)=>{
   if(!line.startsWith('data:'))return;
   const event=JSON.parse(line.slice(5)) as StreamUpdate&Payload;
   if(event.type==='error')throw new Error(event.message||'The response was interrupted. Please try again.');
   if(event.type==='done')result=event;
   else onUpdate?.(event);
  };
  try{
   while(true){const next=await reader.read();buffer+=decoder.decode(next.value,{stream:!next.done});let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(next.done)break;}
   if(buffer.trim())consume(buffer);
   if(!result)throw new Error('The response was interrupted. Please try again.');
   return result;
  }finally{reader.releaseLock();}
 }
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(data.error||(r.status===401?'Your session has expired. Please sign in again.':'Ask AI is unavailable. Please try again.'));
 return data;
}
function Markdown({text}:{text:string}) {
 return <div className="space-y-3 break-words text-sm leading-7 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_th]:border-b [&_th]:p-2 [&_td]:border-b [&_td]:p-2 [&_h2]:font-semibold [&_h3]:font-semibold"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({children})=><span>{children}</span>,img:()=>null,
  table:({children})=><div className="max-w-full overflow-x-auto"><table className="w-full text-left">{children}</table></div>,
 }}>{text}</ReactMarkdown></div>;
}
export function GlobalChat({embedded=false}:{embedded?:boolean}={}) {
 const canChangeStatus=useStatusChangePermission();
 const [statusRequest,setStatusRequest]=useState<{id:string;tenderId?:string;candidates:StatusTenderOption[]}|null>(null);
 const [sessions,setSessions]=useState<Session[]>([]);
 const [sessionId,setSessionId]=useState<string|null>(null);
 const [messages,setMessages]=useState<GlobalMessage[]>([]);
 const [input,setInput]=useState('');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState('Checking live records…');
 const [partial,setPartial]=useState<{summary:string;details:string}|null>(null);
 const [loading,setLoading]=useState(false);
 const [historyOpen,setHistoryOpen]=useState(false);
 const [error,setError]=useState('');
 const [historyError,setHistoryError]=useState('');
 const end=useRef<HTMLDivElement>(null);
 const pending=useRef(false);
 const loadVersion=useRef(0);
 const refresh=useCallback(async()=>{
  try{const data=await call({operation:'sessions'});setSessions(data.sessions||[]);setHistoryError('');}
  catch(e){setHistoryError(e instanceof Error?e.message:'Unable to load history.');}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'end'});},[messages,busy,statusRequest,partial]);
 async function openSession(id:string) {
  if(pending.current)return;
  const version=++loadVersion.current;
  setLoading(true);setError('');setHistoryOpen(false);
  try{const data=await call({operation:'messages',session_id:id});if(version!==loadVersion.current)return;setStatusRequest(null);setSessionId(id);setMessages(data.messages||[]);}
  catch(e){if(version===loadVersion.current)setError(e instanceof Error?e.message:'Could not load this conversation.');}
  finally{if(version===loadVersion.current)setLoading(false);}
 }
 function newChat(){if(pending.current)return;loadVersion.current++;setLoading(false);setStatusRequest(null);setSessionId(null);setMessages([]);setError('');setInput('');setHistoryOpen(false);}
 function requestStatus(question='') {
  const references=[...messages].reverse().find(m=>m.presentation?.references?.length)?.presentation?.references||[];
  setStatusRequest({id:crypto.randomUUID(),tenderId:tenderIdFromCommand(question),candidates:references.map(t=>({id:t.id,title:t.title}))});
 }
 async function send(question:string) {
  const text=question.trim();if(!text||pending.current||loading)return;
  if(isStatusChangeRequest(text)){requestStatus(text);setInput('');return;}
  pending.current=true;setBusy(true);setPartial(null);setProgress('Connecting to your tender assistant…');setError('');setInput('');
  const userMessage:GlobalMessage={id:crypto.randomUUID(),role:'user',content:text};
  setMessages(prev=>[...prev,userMessage]);
  try{
   const data=await call({message:text,session_id:sessionId,stream:true},event=>{
    if(event.type==='status'&&event.message)setProgress(event.message);
    if(event.type==='partial')setPartial({summary:event.summary||'',details:event.details||''});
   });
   if(!data.answer||!data.session_id)throw new Error('No answer was returned. Please try again.');
   setSessionId(data.session_id);
   setMessages(prev=>[...prev,{id:crypto.randomUUID(),role:'assistant',content:data.answer!,presentation:data.presentation}]);
   void refresh();
  }catch(e){setError(e instanceof Error?e.message:'Unable to answer.');setInput(text);setMessages(prev=>prev.filter(m=>m.id!==userMessage.id));}
  finally{pending.current=false;setBusy(false);setPartial(null);}
 }
 const disabled=busy||loading;
 return <section aria-label="Global Ask AI" className={embedded ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white" : "flex h-[calc(100dvh-12rem)] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm lg:h-[calc(100dvh-9rem)]"}>
  <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
   <div><h1 className="font-heading text-lg font-semibold text-text-primary">Ask AI</h1><p className="text-xs text-text-muted">Across Indian and global tenders · VBDC V2</p></div>
   <button type="button" className={`min-h-11 rounded-lg border border-border px-3 text-sm ${embedded?'':'lg:hidden'}`} aria-expanded={historyOpen} onClick={()=>setHistoryOpen(!historyOpen)}>History</button>
   <button type="button" disabled={disabled} onClick={newChat} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:opacity-50">New Chat</button>
  </header>
  <div className="relative flex min-h-0 flex-1">
   <aside aria-label="Conversation history" className={`${historyOpen?'absolute inset-y-0 left-0 z-20 flex w-[min(280px,90%)] shadow-xl':'hidden'} shrink-0 flex-col border-r border-border bg-surface-secondary ${embedded?'':'lg:static lg:flex lg:w-60 lg:shadow-none'}`}>
    <div className="flex items-center justify-between p-4"><h2 className="text-sm font-semibold">Conversations</h2><button type="button" className={`min-h-11 px-2 ${embedded?'':'lg:hidden'}`} onClick={()=>setHistoryOpen(false)} aria-label="Close history">Close</button></div>
    <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
     {historyError?<div className="p-2 text-xs text-red-700">{historyError}<button type="button" className="block min-h-11 underline" onClick={()=>void refresh()}>Retry history</button></div>:null}
     {!sessions.length&&!historyError?<p className="p-2 text-xs text-text-muted">Your conversations will appear here.</p>:null}
     {sessions.map(s=><button key={s.id} type="button" disabled={disabled} onClick={()=>void openSession(s.id)} aria-current={sessionId===s.id?'page':undefined} className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${sessionId===s.id?'bg-primary-50 text-primary-700':'hover:bg-white'}`}><span className="line-clamp-2 break-words">{s.title}</span></button>)}
    </div>
   </aside>
   <div className="flex min-w-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6" aria-live="polite" aria-busy={disabled}>
     <div className="mx-auto max-w-3xl space-y-6">
      {loading?<p role="status" className="text-sm text-text-muted">Loading conversation…</p>:!messages.length&&!statusRequest?<div className="py-3 sm:py-6">
       <div className="mb-6"><span className="mb-3 inline-flex rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">Your tender intelligence assistant</span><h2 className="font-heading text-2xl font-semibold">What should we explore?</h2><p className="mt-2 text-sm text-text-muted">Ask across the database using live records and your company’s evidence.</p></div>
       <div className="grid min-w-0 gap-2 sm:grid-cols-2">{GLOBAL_QUESTIONS.map((q,i)=><button key={q} type="button" onClick={()=>void send(q)} disabled={disabled} className="flex min-h-16 min-w-0 items-start gap-3 rounded-xl border border-border p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary-50 disabled:opacity-50"><span aria-hidden="true" className="shrink-0 text-xs text-text-muted">{String(i+1).padStart(2,'0')}</span><span className="break-words">{q}</span></button>)}</div>
      </div>:messages.map(m=><article key={m.id} aria-label={m.role==='user'?'Your question':'AI answer'} className={m.role==='user'?'ml-auto w-fit max-w-[90%] rounded-2xl bg-primary-50 px-4 py-3':'min-w-0'}>
       {m.role==='user'?<p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>:m.presentation?<>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-700">Short answer</p><Markdown text={m.presentation.summary}/>
        <div className="mt-4 border-t border-border pt-3"><h3 className="text-sm font-semibold">Detailed analysis</h3><Markdown text={m.presentation.details}/></div>
        {m.presentation.documents?.length?<div className="mt-4 grid gap-2 sm:grid-cols-2">{m.presentation.documents.map(d=><a key={d.id} href={`/api/documents/${encodeURIComponent(d.id)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-border p-3 text-sm hover:bg-surface-secondary"><span className="block break-words font-medium">{d.title}</span><span className="text-xs text-text-muted">{[d.financial_year,d.verification_status].filter(Boolean).join(' · ')}</span></a>)}</div>:null}
        {m.presentation.references.length?<div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">{m.presentation.references.map(t=><Link key={t.id} href={`/tenders/${encodeURIComponent(t.id)}`} className="min-w-0 rounded-lg border border-border p-3 text-sm hover:bg-surface-secondary"><span className="block break-words font-medium">{t.title}</span><span className="mt-1 block break-all text-xs text-text-muted">{t.id}</span><span className="text-xs text-primary-700">{t.status.replace(/_/g,' ')}</span></Link>)}</div>:null}
        <div className="mt-4 flex flex-wrap gap-2">{m.presentation.followups.map(q=><button key={q} type="button" disabled={disabled} onClick={()=>void send(q)} className="min-h-11 max-w-full rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-primary-50 disabled:opacity-50">{q}</button>)}</div>
       </>:<Markdown text={m.content}/>}</article>)}
      {busy&&partial&&(partial.summary||partial.details)?<article aria-label="AI answer in progress" className="min-w-0">
       {partial.summary?<><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-700">Short answer</p><Markdown text={partial.summary}/></>:null}
       {partial.details?<div className="mt-4 border-t border-border pt-3"><h3 className="text-sm font-semibold">Detailed analysis</h3><Markdown text={partial.details}/></div>:null}
      </article>:null}
      {busy?<div role="status" className="flex items-center gap-2 text-sm text-text-muted"><span aria-hidden="true" className="animate-pulse">● ● ●</span>{progress}</div>:null}
      {statusRequest?<ChatStatusChange key={statusRequest.id} tenderId={statusRequest.tenderId} candidates={statusRequest.candidates} onDismiss={()=>setStatusRequest(null)}/>:null}
      <div ref={end}/>
     </div>
    </div>
    <footer className="shrink-0 border-t border-border bg-white p-3 sm:px-6">
     <div className="mx-auto max-w-3xl">
      {canChangeStatus?<button type="button" disabled={disabled} onClick={()=>requestStatus()} className="mb-2 min-h-10 rounded-lg border border-border px-3 text-xs text-primary-700 disabled:opacity-50">Change tender status</button>:null}
      {error?<p role="alert" className="mb-2 text-sm text-red-700">{error} {error.toLowerCase().includes('sign in')?<Link className="underline" href="/login?next=%2Fask-ai">Sign in</Link>:null}</p>:null}
      <form className="flex min-w-0 items-end gap-2" onSubmit={e=>{e.preventDefault();void send(input);}}>
       <textarea aria-label="Ask a question about your tenders" placeholder="Ask about tenders, deadlines, PQ or missing documents…" value={input} maxLength={4000} disabled={disabled} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(input);}}} rows={2} className="min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-border p-3 text-base outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"/>
       <button type="submit" disabled={disabled||!input.trim()} className="min-h-12 shrink-0 rounded-xl bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{busy?'Working…':'Send'}</button>
      </form>
      <p className="mt-2 text-center text-[10px] text-text-muted">Status changes require confirmation · Verify mandatory requirements against original tender documents.</p>
     </div>
    </footer>
   </div>
  </div>
 </section>;
}
