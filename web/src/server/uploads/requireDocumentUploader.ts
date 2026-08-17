import "server-only";

import { NextResponse } from "next/server";

import { canManageCompanyDocuments } from "@/lib/company/types";
import { getSession, type AuthSession } from "@/server/auth/session";

export type DocumentUploaderSession = AuthSession & { companyId: string };

export async function requireDocumentUploader(): Promise<
  { session: DocumentUploaderSession; error?: undefined } | { session?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      ),
    };
  }
  if (!session.user.companyId) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error: "Your account is not linked to a company.",
        },
        { status: 403 },
      ),
    };
  }
  if (!canManageCompanyDocuments(session.user.role)) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error: "You do not have permission to manage company documents.",
        },
        { status: 403 },
      ),
    };
  }
  return {
    session: { ...session, companyId: session.user.companyId },
  };
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}
