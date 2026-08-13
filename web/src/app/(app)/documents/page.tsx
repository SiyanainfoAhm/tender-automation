import { DocumentsClient } from "@/components/documents/documents-client";
import { canManageCompanyDocuments } from "@/lib/company/types";
import { roleHasPermission } from "@/lib/rbac/permissions";
import { requireCompanyOrRedirect } from "@/server/auth/company-access";
import {
  countCompanyDocuments,
  countCompanyExperience,
  listCompanyDocuments,
  listCompanyExperience,
} from "@/server/repositories/documentRepository";

export default async function DocumentsPage() {
  const session = await requireCompanyOrRedirect();
  const [documents, experience, documentCount, experienceCount] =
    await Promise.all([
      listCompanyDocuments({ companyId: session.companyId }),
      listCompanyExperience(session.companyId),
      countCompanyDocuments(session.companyId),
      countCompanyExperience(session.companyId),
    ]);

  return (
    <DocumentsClient
      canUpload={canManageCompanyDocuments(session.user.role)}
      canDelete={roleHasPermission(session.user.role, "documents.delete")}
      documents={documents}
      experience={experience}
      documentCount={documentCount}
      experienceCount={experienceCount}
    />
  );
}
