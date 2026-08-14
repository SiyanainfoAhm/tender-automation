import { TemplatesClient } from "@/components/templates/templates-client";
import {
  canManageBidProfileTemplates,
} from "@/lib/company/types";
import { requirePermission } from "@/server/auth/permissions";
import { getCompanyById } from "@/server/repositories/companyRepository";
import { listBidProfileTemplates } from "@/server/repositories/bidProfileTemplateRepository";

export default async function TemplatesPage() {
  const session = await requirePermission("tenders.view");
  const [templates, company] = await Promise.all([
    listBidProfileTemplates(session.companyId),
    getCompanyById(session.companyId),
  ]);

  return (
    <TemplatesClient
      templates={templates}
      canManage={canManageBidProfileTemplates(session.user.role)}
      companyName={company?.name || ""}
      companyAddress={company?.businessLocation || ""}
    />
  );
}
