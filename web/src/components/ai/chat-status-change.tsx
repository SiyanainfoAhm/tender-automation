'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {chatStatusLabel,type ChatStatusState,type StatusTenderOption} from '@/lib/ai/status-change';
import type {TenderStatus} from '@/lib/tender-status';
import {invalidateTenderListCaches} from '@/lib/tenders/list-cache';
import {MarkAsWonDialog} from '@/components/won-tenders/mark-as-won-dialog';

export function ChatStatusChange({tenderId,candidates=[],onDismiss}:{tenderId?:string;candidates?:StatusTenderOption[];onDismiss:()=>void}){
 const router=useRouter();
 const group=useId();
 const [target,setTarget]=useState(tenderId||'');
 const [options,setOptions]=useState(candidates);
 const [search,setSearch]=useState('');
 const [snapshot,setSnapshot]=useState<ChatStatusState|null>(null);
 const [selected,setSelected]=useState<TenderStatus|''>('');
 const [reason,setReason]=useState('');
 const [loading,setLoading]=useState(true);
 const [searching,setSearching]=useState(false);
 const [saving,setSaving]=useState(false);
 const [denied,setDenied]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [complete,setComplete]=useState(false);
 const [wonOpen,setWonOpen]=useState(false);
 const [attempt,setAttempt]=useState(0);
 const locked=useRef(false);
 useEffect(()=>{
  const abort=new AbortController();setLoading(true);setSnapshot(null);setSelected('');setError('');setDenied(false);setMessage('');setComplete(false);
  void(async()=>{try{
   const r=await fetch(target?`/api/ask-ai/status-change?tender_id=${encodeURIComponent(target)}`:'/api/ask-ai/status-change?capability=1',{cache:'no-store',signal:abort.signal});
   const data=await r.json();if(abort.signal.aborted)return;
   if(!r.ok){setDenied(r.status===401||r.status===403);throw new Error(data.error||'Could not load status choices.');}
   if(!target&&data.can_change_status!==true){setDenied(true);throw new Error('You do not have permission to change tender status.');}
   if(target)setSnapshot(data.tender);
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Unable to load statuses.');}finally{if(!abort.signal.aborted)setLoading(false);}})();
  return()=>abort.abort();
 },[target,attempt]);
 async function find(){
  if(search.trim().length<3||searching)return;
  setSearching(true);setError('');
  try{
   const r=await fetch(`/api/ask-ai/status-change?q=${encodeURIComponent(search.trim())}`,{cache:'no-store'});const data=await r.json();
   if(!r.ok)throw new Error(data.error||'Tender search failed.');
   setOptions(data.tenders||[]);if(!data.tenders?.length)setError('No matching tenders. Try the title or tender ID.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to find tenders.');}finally{setSearching(false);}
 }
 function refresh(){invalidateTenderListCaches('chat-status-changed');router.refresh();}
 async function change(){
  if(locked.current||!snapshot||!selected||!reason.trim()||complete)return;
  locked.current=true;setSaving(true);setError('');
  try{
   const r=await fetch('/api/ask-ai/status-change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tender_id:snapshot.id,status:selected,expected_status:snapshot.current_status,reason:reason.trim(),confirm:true})});
   const data=await r.json();if(!r.ok)throw new Error(data.error||'Status change failed.');
   if(data.requires_award_details){setWonOpen(true);return;}
   setComplete(true);setMessage(data.message||`Status changed to ${chatStatusLabel(selected)}.`);refresh();
  }catch(e){setError(e instanceof Error?e.message:'Unable to change the status.');}finally{locked.current=false;setSaving(false);}
 }
 return <section aria-label="Change tender status" className="min-w-0 rounded-xl border border-primary/20 bg-primary-50/40 p-4 text-sm">
  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Change tender status</p><p className="mt-1 text-text-secondary">Choose a status below. Nothing changes until you click Change Status.</p></div><button type="button" disabled={saving} onClick={onDismiss} aria-label="Dismiss status change" className="min-h-10 shrink-0 rounded-lg px-2 text-xs hover:bg-white">{complete?'Done':'Cancel'}</button></div>
  {loading?<p role="status" className="mt-3 text-text-muted">Checking permissions and current status…</p>:null}
  {error?<p role="alert" className="mt-3 text-red-700">{error}</p>:null}
  {!loading&&!denied&&!complete?<>
   {!tenderId?<div className="mt-3 space-y-2">
    <label className="block text-xs font-medium" htmlFor={`${group}-search`}>Find the tender</label>
    <div className="flex gap-2"><input id={`${group}-search`} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title or tender ID" disabled={saving} className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-white px-3 text-base"/><button type="button" onClick={()=>void find()} disabled={saving||searching||search.trim().length<3} className="min-h-11 rounded-lg border border-border bg-white px-3 text-xs disabled:opacity-50">{searching?'Searching…':'Find tender'}</button></div>
    <label className="block text-xs font-medium" htmlFor={`${group}-tender`}>Tender to change</label>
    <select id={`${group}-tender`} value={target} disabled={saving} onChange={e=>{setReason('');setTarget(e.target.value);}} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-white px-2 text-sm"><option value="">Select a tender</option>{options.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
   </div>:null}
   {snapshot?<>
    <p className="mt-4 break-words font-semibold">{snapshot.title}</p><p className="mt-1 text-xs text-text-muted">Current: {snapshot.display_status?chatStatusLabel(snapshot.display_status):'Not evaluated'}</p>
    <fieldset className="mt-3"><legend className="mb-2 text-xs font-medium">Available statuses</legend><div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">{snapshot.options.map(option=><label key={option.value} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg border p-2 text-xs ${!option.allowed?'cursor-not-allowed border-border opacity-45':selected===option.value?'border-primary bg-primary-50':'border-border bg-white'}`}><input type="radio" name={group} value={option.value} checked={selected===option.value} disabled={!option.allowed||saving} onChange={()=>setSelected(option.value)}/><span className="min-w-0 break-words">{option.label}{option.value===snapshot.display_status?' · Current':''}</span></label>)}</div></fieldset>
    {snapshot.options.some(o=>!o.allowed)?<p className="mt-2 text-xs text-text-muted">Disabled statuses are restricted by the existing submission and outcome rules.</p>:null}
    <label htmlFor={`${group}-reason`} className="mb-1 mt-3 block text-xs font-medium">Comment (required)</label><textarea id={`${group}-reason`} value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} disabled={saving} rows={2} placeholder="Why are you changing the status?" className="w-full rounded-lg border border-border bg-white p-2 text-base"/>
    {selected==='WON'?<p className="mb-2 text-xs text-text-muted">Won continues to the existing award-details form before the status is saved.</p>:null}
    <button type="button" disabled={saving||!selected||!reason.trim()||selected===snapshot.display_status} onClick={()=>void change()} className="mt-2 min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving?'Changing…':'Change Status'}</button>
   </>:null}
   {error?<button type="button" onClick={()=>setAttempt(n=>n+1)} className="ml-2 min-h-11 px-2 text-xs underline">Reload status choices</button>:null}
  </>:null}
  {complete?<p role="status" className="mt-3 font-medium text-primary-700">{message}</p>:null}
  {snapshot?<MarkAsWonDialog open={wonOpen} onOpenChange={setWonOpen} tenderId={snapshot.id} tenderTitle={snapshot.title} defaultAwardValue={snapshot.tender_value} initialNotes={reason} onSuccess={()=>{setComplete(true);setMessage('Tender marked as Won.');refresh();}}/>:null}
 </section>;
}
