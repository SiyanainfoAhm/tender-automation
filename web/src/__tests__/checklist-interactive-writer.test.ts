import {describe,expect,it,vi} from "vitest";
import {interactiveChecklistDraft} from "../../../supabase/functions/agenttender-bid-draft-generator/interactive";
const id="11111111-1111-4111-8111-111111111111";
const body={company_id:id,workspace_id:id,item_id:id,system_prompt:"Return the required draft schema",user_prompt:"Improve the testing plan"};
function database(data:unknown) {const filters:unknown[][]=[];const q={select:()=>q,eq:(...args:unknown[])=>{filters.push(args);return q;},maybeSingle:async()=>({data,error:null})};return {db:{from:vi.fn(()=>q)},filters};}
describe("existing V2 writer interactive operation",()=>{
  it("validates company/workspace/item then returns structured content without writes",async()=>{
    const {db,filters}=database({id});const ai=vi.fn().mockResolvedValue({data:{document_title:"Plan",sections:[]},provider:"DEEPSEEK",model:"deepseek-chat"});
    const response=await interactiveChecklistDraft(db,body,ai);
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,provider:"DEEPSEEK",model:"deepseek-chat"});
    expect(filters).toEqual([["id",id],["workspace_id",id],["company_id",id],["is_archived",false]]);
    expect(db.from).toHaveBeenCalledTimes(1);expect(ai).toHaveBeenCalledTimes(1);
  });
  it("rejects nonexistent/company-mismatched records before calling AI",async()=>{
    const {db}=database(null);const ai=vi.fn();expect((await interactiveChecklistDraft(db,body,ai)).status).toBe(404);expect(ai).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs and excessive prompt sizes",async()=>{
    const {db}=database({id});const ai=vi.fn();
    expect((await interactiveChecklistDraft(db,{...body,company_id:"wrong"},ai)).status).toBe(400);
    expect((await interactiveChecklistDraft(db,{...body,user_prompt:"x".repeat(180001)},ai)).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();expect(ai).not.toHaveBeenCalled();
  });
});
