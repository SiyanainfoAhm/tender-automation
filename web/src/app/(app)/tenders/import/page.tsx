import { requirePermission } from "@/server/auth/permissions";
import {
  getImportSourceSummaries,
  getRecentIngestionHistory,
} from "@/server/repositories/tenderImportRepository";

import { ImportTendersClient } from "./import-tenders-client";

export default async function ImportTendersPage() {
  await requirePermission("tenders.import");
  const [sources, history] = await Promise.all([
    getImportSourceSummaries(),
    getRecentIngestionHistory(),
  ]);

  return <ImportTendersClient sources={sources} history={history} />;
}
