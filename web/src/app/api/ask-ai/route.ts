import { NextResponse } from 'next/server';
import { getSession, getCurrentSessionToken } from '@/server/auth/session';
import { requirePermissionStrict } from '@/server/auth/permissions';
import { CompanyAccessError } from '@/server/auth/company-access';

export const maxDuration = 120;
export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({error:'Request origin denied.'},{status:403});
  }
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({error:'Your session has expired. Please sign in again.'},{status:401});
    if (session.user.mustChangePassword) return NextResponse.json({error:'Please change your password before continuing.'},{status:403});
    await requirePermissionStrict('tenders.view');
    const token = await getCurrentSessionToken();
    if (!token) return NextResponse.json({error:'Please sign in again.'},{status:401});
    const body = await request.json().catch(()=>null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'Invalid question.'},{status:400});
    const url = process.env.SUPABASE_URL?.replace(/\/$/,'');
    if (!url) throw new Error('Missing chat configuration');
    const response = await fetch(`${url}/functions/v1/agenttender-orch-v2-global-chat`, {
      method:'POST', headers:{'Content-Type':'application/json','x-agenttender-session':token},
      body:JSON.stringify({message:body.message,session_id:body.session_id,operation:body.operation||'chat'}),
      cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(110000)]),
    });
    const result = await response.json().catch(()=>null);
    if (!result) throw new Error('Invalid upstream response');
    return NextResponse.json(result,{status:response.status,headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    if(error instanceof CompanyAccessError) return NextResponse.json({error:error.message},{status:403});
    console.error('[Global Ask AI]',error instanceof Error?error.message:'unavailable');
    return NextResponse.json({error:'Ask AI is temporarily unavailable. Please try again.'},{status:503});
  }
}
