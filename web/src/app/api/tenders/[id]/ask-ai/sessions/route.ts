import { NextResponse } from "next/server";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { CompanyAccessError } from "@/server/auth/company-access";
import { createChatSession, listChatSessions } from "@/server/ai/chat-history";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const session=await requirePermissionStrict("tenders.view"); const {id:tenderId}=await context.params; const url=new URL(request.url); const offset=Math.max(0,Number(url.searchParams.get("offset"))||0); const search=url.searchParams.get("search")||""; return NextResponse.json(await listChatSessions({companyId:session.companyId,userId:session.user.id,tenderId},offset,20,search)); }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Unable to load conversations."},{status:error instanceof CompanyAccessError?403:500}); }
}
export async function POST(request: Request, context: Context) {
  try { const session=await requirePermissionStrict("tenders.view"); const {id:tenderId}=await context.params; const body=await request.json(); if(typeof body.question!=="string" || !body.question.trim()) return NextResponse.json({error:"A question is required."},{status:400}); const created=await createChatSession({companyId:session.companyId,userId:session.user.id,tenderId},body.question,typeof body.action==="string"?body.action:null); return NextResponse.json({session:created},{status:201}); }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Unable to create conversation."},{status:error instanceof CompanyAccessError?403:500}); }
}
