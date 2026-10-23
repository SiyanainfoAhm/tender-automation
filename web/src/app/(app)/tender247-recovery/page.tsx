import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/db/adminClient";
import { requireRole } from "@/server/auth/session";
import { canManuallyRetry, recoveryFilter, recoveryPage } from "@/server/tender247/recoveryAdmin";

const statuses = ["", "SOURCE_EMPTY", "SOURCE_INVALID", "SOURCE_UNAVAILABLE", "RETRY_PENDING", "UPLOAD_FAILED", "INTERNAL_FAILED", "COMPLETED", "RECONCILED"];

/** Administrative, server-rendered recovery audit. URLs/tokens are never
 * selected; this is intentionally backed by the existing recovery queue. */
export default async function Tender247RecoveryPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const session = await requireRole("ADMIN");
  const params = await searchParams; const status = recoveryFilter(params.status);
  const page = recoveryPage(params.page); const pageSize = 25; const db = createAdminSupabaseClient();
  let query = db.from("agenttender_tender247_recovery_work_items").select("id,run_id,tender247_tender_id,external_document_id,display_filename,status,attempt_count,last_attempt_at,retry_eligible_at,last_error,evidence,sharepoint_drive_item_id,sharepoint_storage_url,agenttender_pipeline_runs!inner(company_id)", { count: "exact" }).eq("work_type", "DOCUMENT").eq("agenttender_pipeline_runs.company_id", session.user.companyId || "__no_company__").order("last_attempt_at", { ascending: false });
  if (status) query = query.eq("status", status); const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(`Unable to load Tender247 recovery work: ${error.message}`);
  const rows = data || []; const totals = rows.reduce((a, row) => ({ ...a, [row.status]: (a[row.status] || 0) + 1 }), {} as Record<string, number>);
  return <main className="mx-auto max-w-7xl space-y-6 p-6"><h1 className="text-2xl font-semibold">Tender247 recovery</h1>
    <p className="text-sm text-muted-foreground">Visible page: {rows.length} items; source blocked {((totals.SOURCE_EMPTY || 0) + (totals.SOURCE_INVALID || 0) + (totals.SOURCE_UNAVAILABLE || 0))}; retry pending {totals.RETRY_PENDING || 0}; upload failed {totals.UPLOAD_FAILED || 0}; internal failed {totals.INTERNAL_FAILED || 0}.</p>
    <form className="flex gap-2" action="/tender247-recovery"><select name="status" defaultValue={status} className="rounded border p-2"><option value="">All outcomes</option>{statuses.slice(1).map(value => <option key={value}>{value}</option>)}</select><button className="rounded bg-primary px-3 py-2 text-primary-foreground">Filter</button></form>
    <div className="overflow-x-auto rounded border"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Tender</th><th>Document</th><th>Outcome</th><th>Attempts</th><th>Last checked</th><th>Next retry</th><th>SharePoint</th><th>Diagnostic</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b align-top"><td>{row.tender247_tender_id}</td><td>{row.display_filename || "Document"}</td><td>{row.status}</td><td>{row.attempt_count}</td><td>{row.last_attempt_at ? new Date(row.last_attempt_at).toLocaleString() : "—"}</td><td>{row.retry_eligible_at ? new Date(row.retry_eligible_at).toLocaleString() : "Manual"}</td><td>{row.sharepoint_drive_item_id ? "Complete" : "Not complete"}</td><td className="max-w-xs break-words">{row.last_error || "—"}</td><td>{canManuallyRetry(row.status) && <form action={retryTender247RecoveryWork}><input type="hidden" name="id" value={row.id}/><button className="rounded border px-2 py-1">Retry</button></form>}</td></tr>)}</tbody></table></div>
    <nav className="flex gap-3"><a href={`/tender247-recovery?status=${encodeURIComponent(status)}&page=${Math.max(1, page - 1)}`}>Previous</a><span>Page {page} of {Math.max(1, Math.ceil((count || 0) / pageSize))}</span><a href={`/tender247-recovery?status=${encodeURIComponent(status)}&page=${page + 1}`}>Next</a></nav>
  </main>;
}

export async function retryTender247RecoveryWork(formData: FormData) {
  "use server";
  const session = await requireRole("ADMIN"); const id = String(formData.get("id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid recovery work item.");
  const db = createAdminSupabaseClient();
  const { data: owned, error: ownershipError } = await db.from("agenttender_tender247_recovery_work_items").select("id,status,agenttender_pipeline_runs!inner(company_id)").eq("id", id).eq("agenttender_pipeline_runs.company_id", session.user.companyId || "__no_company__").maybeSingle();
  if (ownershipError || !owned || !canManuallyRetry(owned.status)) throw new Error("Recovery work item was not found.");
  const { error } = await db.from("agenttender_tender247_recovery_work_items").update({ status: "RETRY_PENDING", retry_eligible_at: new Date().toISOString() }).eq("id", id).eq("work_type", "DOCUMENT");
  if (error) throw new Error(error.message); revalidatePath("/tender247-recovery");
}
