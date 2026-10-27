import { createClient } from "npm:@supabase/supabase-js@2.57.4";
export const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const env = (name: string) => Deno.env.get(name)?.trim() || "";
export function serviceKey(): string {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY") || Object.values(JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"))[0];
  if (!key) throw Error("Supabase service credentials unavailable");
  return String(key);
}
export function admin() { return createClient(env("SUPABASE_URL"), serviceKey(), {auth:{persistSession:false}}); }
export function authorized(req: Request): boolean { return req.headers.get("Authorization") === `Bearer ${serviceKey()}`; }
export async function checked<T>(result: PromiseLike<{data:T;error:any}>): Promise<T> { const {data,error}=await result; if(error)throw Error(error.message);return data; }
export const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]+\n/g,"\n").trim();
export const substantive = (s: string) => s.replace(/--- PAGE \d+ ---|-- \d+ of \d+ --/g,"").replace(/\s/g,"").length;
export async function sha(s: string) { const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,"0")).join(""); }
export async function request(url: string, init: RequestInit = {}, timeout=90000): Promise<Response> {
  return await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});
}
export const billingFailure=(message:string)=>/no credits remaining|insufficient_quota|billing_hard_limit|exceeded your current quota|ACCOUNT_BILLING_PAUSED/i.test(message);
export async function billingBlocked(sb:any){const row=await checked(sb.from("agenttender_ingestion_runtime").select("blocked_until").eq("service","openai").maybeSingle());return row?.blocked_until&&Date.parse(row.blocked_until)>Date.now();}
export async function pauseBilling(sb:any,message:string){await checked(sb.from("agenttender_ingestion_runtime").upsert({service:"openai",blocked_until:new Date(Date.now()+6*3600000).toISOString(),last_error:message,updated_at:new Date().toISOString()},{onConflict:"service"}));}
export type Piece = {content:string;page_number:number|null;page_start:number|null;page_end:number|null};
export function chunks(text: string): Piece[] {
  text=clean(text); const matches=[...text.matchAll(/(?:--- PAGE (\d+) ---|-- (\d+) of \d+ --)/g)];
  const pages: Array<{page:number|null;text:string}>=[];
  if(!matches.length)pages.push({page:null,text});
  else {
    if(substantive(text.slice(0,matches[0].index))>20)pages.push({page:null,text:text.slice(0,matches[0].index)});
    matches.forEach((m,i)=>pages.push({page:Number(m[1]||m[2]),text:text.slice(m.index!+m[0].length,matches[i+1]?.index??text.length)}));
  }
  const out:Piece[]=[];
  for(const p of pages){const s=clean(p.text);if(substantive(s)<=20)continue;let start=0;
    while(start<s.length){let end=Math.min(start+3500,s.length);if(end<s.length){const cut=Math.max(s.lastIndexOf("\n",end),s.lastIndexOf(". ",end));if(cut>start+2300)end=cut+1;}
      const content=s.slice(start,end).trim();if(substantive(content)>20)out.push({content,page_number:p.page,page_start:p.page,page_end:p.page});
      if(end===s.length)break;start=Math.max(start+1,end-300);
    }
  }return out;
}
