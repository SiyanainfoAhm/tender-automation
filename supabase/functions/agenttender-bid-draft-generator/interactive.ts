// Internal content-only operation. The existing handler authenticates the service
// credential before calling this. Next.js resolves the human session/permissions.
export async function interactiveChecklistDraft(db:any, body:any, ai:any) {
  const validId=(id:any)=>typeof id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (![body.company_id,body.workspace_id,body.item_id].every(validId) ||
      typeof body.system_prompt!=="string" || typeof body.user_prompt!=="string" ||
      !body.system_prompt.trim() || !body.user_prompt.trim() ||
      body.system_prompt.length+body.user_prompt.length>180000) {
    return Response.json({ok:false,error:"Invalid document request"},{status:400});
  }
  const {data:item,error}=await db.from("agenttender_bid_checklist_items").select("id")
    .eq("id",body.item_id).eq("workspace_id",body.workspace_id)
    .eq("company_id",body.company_id).eq("is_archived",false).maybeSingle();
  if(error) return Response.json({ok:false,error:"Unable to verify checklist item"},{status:503});
  if(!item) return Response.json({ok:false,error:"Checklist item not found"},{status:404});
  const result=await ai([
    {role:"system",content:body.system_prompt},
    {role:"user",content:body.user_prompt},
  ]);
  // Never run the scheduled pipeline, signing or any DB writes for this action.
  return Response.json({ok:true,document:result.data,provider:result.provider,model:result.model});
}

/** Leave scheduled writing/review settings unchanged; reserve output for the
 * complete document in interactive revisions, rather than hidden reasoning. */
export function writerRequestSettings(provider:string, defaultMax:number, interactive=false) {
  return {
    max_tokens: interactive ? 24000 : defaultMax,
    ...(interactive && provider === "DEEPSEEK" ? {thinking:{type:"disabled"}} : {}),
  };
}
