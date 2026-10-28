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
export async function request(url: string, init: RequestInit = {}, timeout=90000): Promise<Response> {
  return await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});
}
