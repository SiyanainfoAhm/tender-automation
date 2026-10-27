import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.4";
const model=new Supabase.ai.Session("gte-small");
const errorText=(e:any)=>String(e?.message||e?.error_description||(e instanceof Error?e.message:typeof e==='object'?JSON.stringify(e):e)).slice(0,2000);
const split=(s:string)=>{const maxPart=1800;const out:string[]=[];const words=s.match(/\S+\s*/g)||[];let buf="";for(const w of words){if(buf.length+w.length>maxPart&&buf){out.push(buf.trim());buf="";}if(w.length>maxPart){for(let i=0;i<w.length;i+=maxPart)out.push(w.slice(i,i+maxPart));}else buf+=w;}if(buf.trim())out.push(buf.trim());return out};
const asVector=(v:any):number[]|null=>{if(Array.isArray(v))return v as number[];if(typeof v==="string"){try{const p=JSON.parse(v);return Array.isArray(p)?p:null;}catch{return null;}}return null;};
Deno.serve(async req=>{try{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY");
 if(!key||req.headers.get("Authorization")!=="Bearer "+key)return Response.json({error:"Unauthorized"},{status:401});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false}});
 const body=await req.json().catch(()=>({})),limit=Math.min(10,Math.max(1,Number(body.limit)||2));
 const shard=Math.min(4,Math.max(0,Number(body.shard)||0));
 const scope=body.scope==="company"?"company":"tender";
 const tenderId=body.tender_id?String(body.tender_id):null;
 const chunkId=body.chunk_id?String(body.chunk_id):null;
 if(chunkId&&!/^[0-9a-f-]{36}$/i.test(chunkId))return Response.json({error:"Invalid chunk_id"},{status:400});
 if(tenderId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenderId))return Response.json({error:"Invalid tender_id"},{status:400});
 // Single-tender calls get a compute budget (~3 model runs fit in one worker instance): large chunks are embedded over several calls (resumable).
 let runsLeft=1; // One model run per invocation; persisted parts resume next time without repeating completed work.
 const {data:rows,error}=chunkId?await db.from("agenttender_ai_document_chunks").select("id,content,content_hash").eq("id",chunkId).eq("tender_id",tenderId).eq("source_type","TENDER_DOCUMENT").eq("is_active",true).is("embedding_local",null).limit(1):tenderId?await db.from("agenttender_ai_document_chunks").select("id,content,content_hash").eq("tender_id",tenderId).eq("source_type","TENDER_DOCUMENT").eq("is_active",true).is("embedding_local",null).order("id").limit(limit):scope==="company"?await db.rpc("agenttender_local_embedding_candidates_scoped",{p_limit:limit,p_scope:scope}):await db.rpc("agenttender_local_embedding_candidates_sharded",{p_limit:limit,p_shard:shard});if(error)throw error;
 let done=0,partial=0,partsEmbedded=0;const errors:any[]=[];
 for(const c of rows||[]){let chunkLease=null;try{
  if(runsLeft<=0)break;
  const {data:lease,error:leaseError}=await db.rpc("agenttender_claim_embedding_chunk",{p_chunk:c.id});if(leaseError)throw leaseError;if(!lease)continue;chunkLease=lease;
  const {data:queue}=await db.from('agenttender_embedding_queue').select('status,available_at,claimed_at').eq('chunk_id',c.id).maybeSingle();
  if(queue&&(queue.status==='failed'||queue.available_at>new Date().toISOString()||(queue.status==='processing'&&queue.claimed_at>new Date(Date.now()-180000).toISOString())))continue;
  const report=await db.rpc('agenttender_embedding_attempt_result',{p_chunk:c.id,p_state:'processing'});if(report.error)throw report.error;
  const parts=split(c.content);if(!parts.length)throw Error('EMPTY_CHUNK');
  const {data:existing,error:xe}=await db.from("agenttender_local_embedding_parts").select("part_index,content_hash,embedding").eq("chunk_id",c.id);if(xe)throw xe;
  let have=new Map<number,number[]>();let stale=false;
  for(const e of existing||[]){const v=asVector(e.embedding);if(e.content_hash!==c.content_hash||e.part_index>=parts.length||!v||v.length!==384){stale=true;break;}have.set(e.part_index,v);}
  if(stale){const {error:de}=await db.from("agenttender_local_embedding_parts").delete().eq("chunk_id",c.id);if(de)throw de;have=new Map();}
  for(let i=0;i<parts.length;i++){
   if(have.has(i))continue;
   if(runsLeft<=0)break;
   const v=await model.run(parts[i],{mean_pool:true,normalize:true});if(!Array.isArray(v)||v.length!==384)throw Error("Model output dimension mismatch");
   const {error:ie}=await db.from("agenttender_local_embedding_parts").insert({chunk_id:c.id,part_index:i,content_hash:c.content_hash,content:parts[i],embedding:v});if(ie)throw ie;
   have.set(i,v as number[]);runsLeft--;partsEmbedded++;
  }
  if(have.size<parts.length){const {error}=await db.rpc('agenttender_embedding_attempt_result',{p_chunk:c.id,p_state:'partial'});if(error)throw error;partial++;continue;}
  const mean=Array(384).fill(0);for(let i=0;i<parts.length;i++){const v=have.get(i)!;for(let k=0;k<384;k++)mean[k]+=v[k];}const norm=Math.hypot(...mean)||1;const avg=mean.map(x=>x/norm);
  const {data:updated,error:ue}=await db.from("agenttender_ai_document_chunks").update({embedding_local:avg}).eq("id",c.id).eq("content_hash",c.content_hash).eq("is_active",true).is("embedding_local",null).select("id");if(ue)throw ue;if(!updated?.length)throw Error("Chunk changed during embedding");done++;const completedReport=await db.rpc('agenttender_embedding_attempt_result',{p_chunk:c.id,p_state:'completed'});if(completedReport.error)throw completedReport.error;
 }catch(e){errors.push({chunk_id:c.id,error:errorText(e).slice(0,300)});await db.rpc("agenttender_embedding_attempt_result",{p_chunk:c.id,p_state:"error",p_error:errorText(e).slice(0,1000)});}finally{if(chunkLease){const {error:releaseError}=await db.rpc("agenttender_release_embedding_chunk",{p_chunk:c.id,p_token:chunkLease});if(releaseError)errors.push({chunk_id:c.id,error:"LEASE_RELEASE:"+releaseError.message});}}}
 return Response.json({scope:tenderId?"single_tender":scope,tender_id:tenderId,claimed:(rows||[]).length,completed:done,partial,parts_embedded:partsEmbedded,failed:errors.length,errors});
}catch(e){return Response.json({error:errorText(e)},{status:500})}});
