import "server-only";

import { redirect } from "next/navigation";
import {
  canEditCompanyProfile,
  canEditBidPreferences,
  canManageCompanyDocuments,
} from "@/lib/company/types";
import { requireSession, type AuthSession } from "@/server/auth/session";

export class CompanyAccessError extends Error {
  readonly code: "NO_COMPANY" | "FORBIDDEN";
  constructor(code: "NO_COMPANY" | "FORBIDDEN", message: string) {
    super(message);
    this.code = code;
    this.name = "CompanyAccessError";
  }
}

/** Resolve company from session — never trust client-provided company_id. */
export async function requireCompanySession(): Promise<
  AuthSession & { companyId: string }
> {
  const session = await requireSession();
  if (!session.user.companyId) {
    throw new CompanyAccessError(
      "NO_COMPANY",
      "Your account is not linked to a company.",
    );
  }
  return { ...session, companyId: session.user.companyId };
}

export async function requireCompanyAdminSession(): Promise<
  AuthSession & { companyId: string }
> {
  const session = await requireCompanySession();
  if (!canEditCompanyProfile(session.user.role)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      "You do not have permission to edit company profile.",
    );
  }
  return session;
}

export async function requireBidPreferencesEditor(): Promise<
  AuthSession & { companyId: string }
> {
  const session = await requireCompanySession();
  if (!canEditBidPreferences(session.user.role)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      "You do not have permission to edit bid preferences.",
    );
  }
  return session;
}

export async function requireCompanyDocumentManager(): Promise<
  AuthSession & { companyId: string }
> {
  const session = await requireCompanySession();
  if (!canManageCompanyDocuments(session.user.role)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      "You do not have permission to manage company documents.",
    );
  }
  return session;
}

export function assertSameCompany(
  resourceCompanyId: string,
  userCompanyId: string,
): void {
  if (resourceCompanyId !== userCompanyId) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      "You cannot access another company's records.",
    );
  }
}

export async function requireCompanyOrRedirect(): Promise<
  AuthSession & { companyId: string }
> {
  try {
    return await requireCompanySession();
  } catch {
    redirect("/dashboard");
  }
}
