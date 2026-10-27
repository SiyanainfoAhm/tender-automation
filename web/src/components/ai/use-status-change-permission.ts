'use client';
import {useEffect,useState} from 'react';
export function useStatusChangePermission(enabled=true){
 const [allowed,setAllowed]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  const abort=new AbortController();
  void (async()=>{try{const r=await fetch('/api/ask-ai/status-change?capability=1',{cache:'no-store',signal:abort.signal});const data=await r.json();if(!abort.signal.aborted)setAllowed(r.ok&&data.can_change_status===true);}catch{if(!abort.signal.aborted)setAllowed(false);}})();
  return ()=>abort.abort();
 },[enabled]);
 return allowed;
}
