import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {activeRules,screen,qualificationDecision} from "../agenttender-orch-v2-chat/policy.mjs";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
Deno.serve(async req=>{try{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 if(!KEY||req.headers.get("Authorization")!=="Bearer "+KEY)return Response.json({error:"Unauthorized"},{status:401});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,KEY,{auth:{persistSession:false}});
 const b=await req.json().catch(()=>({}));const rules=await activeRules(db);
 if(b.action==='qualification_policy_probe')return Response.json({ok:true,recommendation:qualificationDecision(b.assessment||{}),changed_business_statuses:0});
 if(b.action==='policy_probe')return Response.json({ok:true,rules,screen:screen(b.tender||{},rules),changed_business_statuses:0});
 const {data:routes,error:re}=await db.from('agenttender_tender_route_assignments').select('tender_id').eq('route','ORCHESTRATOR');if(re)throw re;
 const excluded=new Set((routes||[]).map(r=>r.tender_id));
 let q=db.from('agenttender_tenders').select('id,source_tender_id,title,description,emd_amount').eq('source_region','INDIAN').eq('qualification_status','VERIFY').is('prescreen_status',null).order('id').limit(Math.min(100,Math.max(1,Number(b.limit)||25)));
 if(b.tender_id)q=q.eq('id',b.tender_id);
 const {data,error}=await q;if(error)throw error;const results=[];
 for(const t of (data||[]).filter(t=>!excluded.has(t.id))){const result=screen(t,rules);results.push({id:t.source_tender_id,...result});
  if(b.dry_run!==true){
   const {error:e}=await db.from('agenttender_tenders').update({prescreen_status:'NEEDS_DOCUMENTS',prescreen_reason:'Approved rule candidates require RFP and exemption verification',prescreened_at:new Date().toISOString()}).eq('id',t.id).eq('qualification_status','VERIFY').is('prescreen_status',null);if(e)throw e;
   const {error:qe}=await db.from('agenttender_processing_queue').upsert({tender_id:t.id,status:'WAITING_DOCUMENT',last_error:'Acquire original RFP evidence for approved rules'},{onConflict:'tender_id',ignoreDuplicates:true});if(qe)throw qe;
  }
 }
 return Response.json({ok:true,dry_run:b.dry_run===true,checked:results.length,no_go:0,results,worker_version:'rules-approved-policy-v1',changed_business_statuses:0});
}catch(e){return Response.json({error:e.message||String(e)},{status:500});}});
