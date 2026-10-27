import {NextResponse} from 'next/server';
import {getSession} from '@/server/auth/session';
import {requirePermissionStrict,sessionHasPermission} from '@/server/auth/permissions';
import {CompanyAccessError} from '@/server/auth/company-access';
import {getServerSupabase} from '@/lib/db/server';
import {getTenderById,escapePostgrestSearchTerm} from '@/server/repositories/tenderRepository';
import {updateTenderStatusAction} from '@/server/actions/tender-update';
import {TENDER_STATUSES,tenderDetailStatusChoices,resolveDisplayedDetailStatus,type TenderStatus} from '@/lib/tender-status';
import {chatStatusLabel} from '@/lib/ai/status-change';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class StatusError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function principal(){
 const session=await getSession();
 if(!session)throw new StatusError('Please sign in again.',401);
 if(session.user.mustChangePassword)throw new StatusError('Please change your password first.',403);
 return session;
}
async function stateFor(id:string,companyId:string){
 if(!uuid.test(id))throw new StatusError('Select a valid tender.',400);
 const data=await getTenderById(id);
 if(!data)throw new StatusError('Tender not found.',404);
 // Company-specific submission state constrains transitions even when a
 // legacy shared qualification label still says GO. Fail closed on errors.
 const {data:workspace,error}=await getServerSupabase().from('agenttender_bid_workspaces').select('submission_status').eq('company_id',companyId).eq('tender_id',id).maybeSingle();
 if(error)throw new Error('Workspace lookup failed');
 const current=(data.tender.qualification_status||null) as TenderStatus|null;
 const submitted=workspace?.submission_status==='submitted';
 const display=resolveDisplayedDetailStatus({qualificationStatus:current,submitted});
 const allowed=tenderDetailStatusChoices({currentStatus:display,submitted});
 return {id,title:data.tender.title,current_status:current,display_status:display,tender_value:data.tender.tender_value,
  options:TENDER_STATUSES.map(value=>({value,label:chatStatusLabel(value),allowed:allowed.includes(value)}))};
}
function failure(error:unknown){
 if(error instanceof StatusError)return json({error:error.message},error.status);
 if(error instanceof CompanyAccessError)return json({error:'You do not have permission to change tender status.'},403);
 console.error('[Chat status change]',error instanceof Error?error.message:'unavailable');
 return json({error:'Unable to process the status change. Please try again.'},503);
}
export async function GET(request:Request){
 try{
  const existing=await principal();
  const params=new URL(request.url).searchParams;
  if(params.get('capability')==='1'){
   const session=await requirePermissionStrict('tenders.view');
   return json({can_change_status:sessionHasPermission(session,'tenders.edit')});
  }
  const session=await requirePermissionStrict('tenders.edit');
  if(!existing.user.companyId||session.companyId!==existing.user.companyId)throw new StatusError('Company access denied.',403);
  const id=params.get('tender_id');
  if(id)return json({tender:await stateFor(id,session.companyId)});
  const query=escapePostgrestSearchTerm((params.get('q')||'').slice(0,160));
  if(query.length<3)return json({error:'Enter at least three characters to find a tender.'},400);
  // Tender metadata is shared by authenticated tender users in this app.
  // No company documents, workspaces, or other users' private data are searched.
  let search=getServerSupabase().from('agenttender_tenders').select('id,title');
  search=uuid.test(query)?search.eq('id',query):search.or(`title.ilike.%${query}%,source_tender_id.ilike.%${query}%`);
  const {data,error}=await search.order('title').limit(20);
  if(error)throw new Error('Tender search failed');
  return json({tenders:data||[]});
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return json({error:'Request origin denied.'},403);
 try{
  await principal();
  const session=await requirePermissionStrict('tenders.edit');
  const body=await request.json().catch(()=>null);
  if(!body||body.confirm!==true)return json({error:'Click Change Status to confirm this action.'},400);
  if(typeof body.tender_id!=='string'||typeof body.status!=='string'||!TENDER_STATUSES.includes(body.status))return json({error:'Select a valid tender and status.'},400);
  if(!Object.prototype.hasOwnProperty.call(body,'expected_status'))return json({error:'Refresh the status choices before confirming.'},400);
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!reason||reason.length>2000)return json({error:'Enter a comment of up to 2,000 characters.'},400);
  const tender=await stateFor(body.tender_id,session.companyId);
  if(body.expected_status!==tender.current_status)return json({error:'This tender changed since the choices were shown. Reload the choices before trying again.'},409);
  if(!tender.options.some(item=>item.value===body.status&&item.allowed))return json({error:'That transition is not allowed for this tender’s current lifecycle.'},409);
  if(body.status===tender.current_status)return json({ok:true,unchanged:true,status:tender.current_status,message:'The tender already has this status.'});
  if(body.status==='WON')return json({ok:true,requires_award_details:true});
  // This is the same human/session-validated, audited action as tender details.
  // The model never calls this route and cannot supply an actor or company.
  const result=await updateTenderStatusAction({tenderId:tender.id,status:body.status,reason});
  if(!result.ok)return json({error:result.error},409);
  return json({ok:true,status:body.status,message:`${tender.title}: status changed to ${chatStatusLabel(body.status)}.`});
 }catch(error){return failure(error);}
}
