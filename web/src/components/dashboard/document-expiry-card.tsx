import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompanySession } from "@/server/auth/company-access";
import { listExpiringDocuments } from "@/server/repositories/documentRepository";

export async function DashboardDocumentExpiryCard() {
  try {
    const session = await requireCompanySession();
    const docs = await listExpiringDocuments({
      companyId: session.companyId,
    });
    if (docs.length === 0) return null;

    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">
                {docs.length} document{docs.length === 1 ? "" : "s"} expiring
                soon
              </p>
              <p className="text-xs text-text-muted">
                Based on your company document expiry dates
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {docs.slice(0, 6).map((d) => (
                  <Badge key={d.id} variant="warning">
                    {d.certificateType || d.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Link
            href="/documents"
            className="text-sm font-medium text-primary hover:text-primary-hover"
          >
            View documents
          </Link>
        </CardContent>
      </Card>
    );
  } catch {
    return null;
  }
}
