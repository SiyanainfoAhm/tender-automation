import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import {
  derivePaymentStatus,
  deriveProjectHealth,
  paymentOutstandingBalance,
  type MarkTenderWonInput,
  type WonDocumentCategory,
  type WonMilestoneStatus,
  type WonPaymentMode,
  type WonProject,
  type WonProjectDetail,
  type WonProjectDocument,
  type WonProjectListItem,
  type WonProjectMilestone,
  type WonProjectPayment,
  type WonProjectPaymentReceipt,
  type WonProjectSummary,
} from "@/lib/won-projects";
import {
  parseExecutionStatus,
  parseMilestoneStatus,
  parsePaymentStatus,
  isPbgStatus,
} from "@/lib/wonTenderStatuses";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function mapProject(row: Record<string, unknown>): WonProject {
  const tender = (row.tender || row.agenttender_tenders || {}) as Record<
    string,
    unknown
  >;
  const manager = (row.manager || row.agenttender_users || {}) as Record<
    string,
    unknown
  >;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    tenderId: String(row.tender_id),
    projectCode: String(row.project_code || ""),
    executionStatus:
      parseExecutionStatus(String(row.execution_status)) ?? "awarded",
    awardDate: String(row.award_date).slice(0, 10),
    finalAwardValue: num(row.final_award_value),
    poNumber: str(row.po_number),
    poDate: row.po_date ? String(row.po_date).slice(0, 10) : null,
    contractNumber: str(row.contract_number),
    contractDescription: str(row.contract_description),
    contractStartDate: row.contract_start_date
      ? String(row.contract_start_date).slice(0, 10)
      : null,
    contractEndDate: row.contract_end_date
      ? String(row.contract_end_date).slice(0, 10)
      : null,
    clientDepartment: str(row.client_department),
    projectManagerId: str(row.project_manager_id),
    projectManagerName: str(manager.full_name) || str(manager.email),
    pbgApplicable: Boolean(row.pbg_applicable),
    pbgNumber: str(row.pbg_number),
    pbgAmount: row.pbg_amount == null ? null : num(row.pbg_amount),
    pbgIssueDate: row.pbg_issue_date
      ? String(row.pbg_issue_date).slice(0, 10)
      : null,
    pbgExpiryDate: row.pbg_expiry_date
      ? String(row.pbg_expiry_date).slice(0, 10)
      : null,
    pbgBank: str(row.pbg_bank),
    pbgStatus: (() => {
      const raw = str(row.pbg_status);
      return raw && isPbgStatus(raw) ? raw : null;
    })(),
    jiraProjectKey: str(row.jira_project_key),
    jiraUrl: str(row.jira_url),
    repositoryUrl: str(row.repository_url),
    deploymentUrl: str(row.deployment_url),
    stagingUrl: str(row.staging_url),
    productionUrl: str(row.production_url),
    developmentNotes: str(row.development_notes),
    notes: str(row.notes),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    tenderTitle: String(tender.title || row.tender_title || "Untitled tender"),
    organization: str(tender.organization) || str(row.organization),
    location: str(tender.city) || str(row.location),
    portal: str(tender.source_portal) || str(row.portal),
    referenceNo: str(tender.reference_no) || str(row.reference_no),
    category: str(tender.project_category) || str(row.category),
    tenderValue:
      tender.tender_value == null && row.tender_value == null
        ? null
        : num(tender.tender_value ?? row.tender_value),
  };
}

function mapMilestone(
  row: Record<string, unknown>,
  ownerName: string | null = null,
): WonProjectMilestone {
  return {
    id: String(row.id),
    wonProjectId: String(row.won_project_id),
    title: String(row.title || ""),
    description: str(row.description),
    dueDate: String(row.due_date).slice(0, 10),
    milestoneValue:
      row.milestone_value == null ? null : num(row.milestone_value),
    paymentLinked: Boolean(row.payment_linked),
    status: parseMilestoneStatus(String(row.status)) ?? "not_started",
    ownerId: str(row.owner_id),
    ownerName,
    completedAt: row.completed_at
      ? String(row.completed_at).slice(0, 10)
      : null,
    notes: str(row.notes),
    sortOrder: num(row.sort_order),
  };
}

function mapReceipt(row: Record<string, unknown>): WonProjectPaymentReceipt {
  return {
    id: String(row.id),
    paymentId: String(row.payment_id),
    amount: num(row.amount),
    receivedDate: String(row.received_date).slice(0, 10),
    paymentMode: String(row.payment_mode) as WonPaymentMode,
    transactionReference: str(row.transaction_reference),
    notes: str(row.notes),
    createdAt: String(row.created_at || ""),
  };
}

function mapPayment(
  row: Record<string, unknown>,
  receipts: WonProjectPaymentReceipt[] = [],
  milestoneTitle: string | null = null,
): WonProjectPayment {
  const amount = num(row.amount);
  const receivedAmount =
    receipts.length > 0
      ? receipts.reduce((sum, r) => sum + r.amount, 0)
      : num(row.received_amount);
  const dueDate = String(row.due_date).slice(0, 10);
  const explicit = parsePaymentStatus(str(row.status));
  const derivedStatus = derivePaymentStatus({
    amount,
    receivedAmount,
    dueDate,
    explicitStatus: explicit,
  });
  return {
    id: String(row.id),
    wonProjectId: String(row.won_project_id),
    milestoneId: str(row.milestone_id),
    milestoneTitle,
    title: String(row.title || ""),
    invoiceNumber: str(row.invoice_number),
    invoiceDate: row.invoice_date
      ? String(row.invoice_date).slice(0, 10)
      : null,
    amount,
    dueDate,
    receivedAmount,
    receivedDate: row.received_date
      ? String(row.received_date).slice(0, 10)
      : null,
    paymentMode: str(row.payment_mode) as WonPaymentMode | null,
    transactionReference: str(row.transaction_reference),
    status: explicit || derivedStatus,
    derivedStatus,
    balance: paymentOutstandingBalance({
      amount,
      receivedAmount,
      status: derivedStatus,
    }),
    notes: str(row.notes),
    receipts,
  };
}

function mapDocument(
  row: Record<string, unknown>,
  createdByName: string | null = null,
): WonProjectDocument {
  return {
    id: String(row.id),
    wonProjectId: String(row.won_project_id),
    milestoneId: str(row.milestone_id),
    paymentId: str(row.payment_id),
    tenderDocumentId: str(row.tender_document_id),
    title: String(row.title || ""),
    category: String(row.category) as WonDocumentCategory,
    fileName: String(row.file_name || ""),
    originalName: str(row.original_name),
    mimeType: str(row.mime_type),
    fileSizeBytes:
      row.file_size_bytes == null ? null : num(row.file_size_bytes),
    storageUrl: str(row.storage_url),
    documentDate: row.document_date
      ? String(row.document_date).slice(0, 10)
      : null,
    description: str(row.description),
    createdBy: str(row.created_by),
    createdByName,
    createdAt: String(row.created_at || ""),
  };
}

function enrichListItem(
  project: WonProject,
  milestones: WonProjectMilestone[],
  payments: WonProjectPayment[],
): WonProjectListItem {
  const milestonesCompleted = milestones.filter(
    (m) => m.status === "completed",
  ).length;
  const milestonesTotal = milestones.length;
  const paymentsReceived = payments.reduce(
    (sum, p) => sum + (p.derivedStatus === "cancelled" ? 0 : p.receivedAmount),
    0,
  );
  const paymentsExpected = payments.reduce(
    (sum, p) => sum + (p.derivedStatus === "cancelled" ? 0 : p.amount),
    0,
  );
  const overdueAmount = payments.reduce((sum, p) => {
    if (p.derivedStatus !== "overdue") return sum;
    return sum + p.balance;
  }, 0);
  const outstandingAmount = Math.max(
    0,
    project.finalAwardValue - paymentsReceived,
  );
  const nextOpen = milestones
    .filter((m) => m.status !== "completed")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return {
    ...project,
    health: deriveProjectHealth({
      executionStatus: project.executionStatus,
      milestones,
      payments,
    }),
    milestonesCompleted,
    milestonesTotal,
    milestoneProgressPercent:
      milestonesTotal === 0
        ? 0
        : Math.round((milestonesCompleted / milestonesTotal) * 100),
    paymentsReceived,
    paymentsExpected,
    paymentProgressPercent:
      paymentsExpected <= 0
        ? 0
        : Math.min(100, Math.round((paymentsReceived / paymentsExpected) * 100)),
    overdueAmount,
    outstandingAmount,
    nextMilestoneDueDate: nextOpen?.dueDate || null,
  };
}

const PROJECT_SELECT = `
  *,
  tender:agenttender_tenders!tender_id (
    title, organization, city, source_portal, reference_no, project_category, tender_value
  ),
  manager:agenttender_users!project_manager_id (
    full_name, email
  )
`;

export async function countWonProjects(companyId: string): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_won_projects")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function getWonProjectByTenderId(
  tenderId: string,
  companyId: string,
): Promise<WonProject | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_projects")
    .select(PROJECT_SELECT)
    .eq("tender_id", tenderId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapProject(data as Record<string, unknown>);
}

export async function markTenderWon(options: {
  companyId: string;
  userId: string;
  input: MarkTenderWonInput;
}): Promise<{
  wonProjectId: string;
  projectCode: string;
  alreadyExisted: boolean;
}> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("agenttender_mark_tender_won", {
    p_tender_id: options.input.tenderId,
    p_company_id: options.companyId,
    p_user_id: options.userId,
    p_award_date: options.input.awardDate,
    p_final_award_value: options.input.finalAwardValue,
    p_po_number: options.input.poNumber || null,
    p_po_date: options.input.poDate || null,
    p_contract_number: options.input.contractNumber || null,
    p_contract_start_date: options.input.contractStartDate || null,
    p_contract_end_date: options.input.contractEndDate || null,
    p_client_department: options.input.clientDepartment || null,
    p_project_manager_id: options.input.projectManagerId || null,
    p_pbg_applicable: Boolean(options.input.pbgApplicable),
    p_pbg_amount: options.input.pbgAmount ?? null,
    p_pbg_expiry_date: options.input.pbgExpiryDate || null,
    p_notes: options.input.notes || null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.won_project_id) {
    throw new Error("Mark as Won did not return a project id.");
  }
  return {
    wonProjectId: String(row.won_project_id),
    projectCode: String(row.project_code || ""),
    alreadyExisted: Boolean(row.already_existed),
  };
}

async function loadMilestonesForProjects(
  projectIds: string[],
): Promise<Map<string, WonProjectMilestone[]>> {
  const map = new Map<string, WonProjectMilestone[]>();
  if (projectIds.length === 0) return map;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_milestones")
    .select("*")
    .in("won_project_id", projectIds)
    .order("sort_order", { ascending: true })
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);

  const ownerIds = [
    ...new Set(
      (data || [])
        .map((r) => str((r as Record<string, unknown>).owner_id))
        .filter(Boolean) as string[],
    ),
  ];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: users } = await supabase
      .from("agenttender_users")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const u of users || []) {
      ownerNames.set(
        String(u.id),
        String(u.full_name || u.email || "").trim() || "User",
      );
    }
  }

  for (const row of data || []) {
    const rec = row as Record<string, unknown>;
    const projectId = String(rec.won_project_id);
    const list = map.get(projectId) || [];
    list.push(
      mapMilestone(
        rec,
        rec.owner_id ? ownerNames.get(String(rec.owner_id)) || null : null,
      ),
    );
    map.set(projectId, list);
  }
  return map;
}

async function loadPaymentsForProjects(
  projectIds: string[],
): Promise<Map<string, WonProjectPayment[]>> {
  const map = new Map<string, WonProjectPayment[]>();
  if (projectIds.length === 0) return map;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_payments")
    .select("*")
    .in("won_project_id", projectIds)
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);

  const paymentIds = (data || []).map((r) => String((r as { id: string }).id));
  const receiptsByPayment = new Map<string, WonProjectPaymentReceipt[]>();
  if (paymentIds.length > 0) {
    const { data: receipts, error: receiptError } = await supabase
      .from("agenttender_won_project_payment_receipts")
      .select("*")
      .in("payment_id", paymentIds)
      .order("received_date", { ascending: true });
    if (receiptError) throw new Error(receiptError.message);
    for (const row of receipts || []) {
      const rec = row as Record<string, unknown>;
      const pid = String(rec.payment_id);
      const list = receiptsByPayment.get(pid) || [];
      list.push(mapReceipt(rec));
      receiptsByPayment.set(pid, list);
    }
  }

  const milestoneIds = [
    ...new Set(
      (data || [])
        .map((r) => str((r as Record<string, unknown>).milestone_id))
        .filter(Boolean) as string[],
    ),
  ];
  const milestoneTitles = new Map<string, string>();
  if (milestoneIds.length > 0) {
    const { data: milestones } = await supabase
      .from("agenttender_won_project_milestones")
      .select("id, title")
      .in("id", milestoneIds);
    for (const m of milestones || []) {
      milestoneTitles.set(String(m.id), String(m.title || ""));
    }
  }

  for (const row of data || []) {
    const rec = row as Record<string, unknown>;
    const projectId = String(rec.won_project_id);
    const list = map.get(projectId) || [];
    const id = String(rec.id);
    list.push(
      mapPayment(
        rec,
        receiptsByPayment.get(id) || [],
        rec.milestone_id
          ? milestoneTitles.get(String(rec.milestone_id)) || null
          : null,
      ),
    );
    map.set(projectId, list);
  }
  return map;
}

export async function listWonProjects(
  companyId: string,
): Promise<WonProjectListItem[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_projects")
    .select(PROJECT_SELECT)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const projects = (data || []).map((row) =>
    mapProject(row as Record<string, unknown>),
  );
  const ids = projects.map((p) => p.id);
  const [milestonesMap, paymentsMap] = await Promise.all([
    loadMilestonesForProjects(ids),
    loadPaymentsForProjects(ids),
  ]);

  return projects.map((project) =>
    enrichListItem(
      project,
      milestonesMap.get(project.id) || [],
      paymentsMap.get(project.id) || [],
    ),
  );
}

export function summarizeWonProjects(
  projects: WonProjectListItem[],
): WonProjectSummary {
  return {
    totalProjects: projects.length,
    activeExecution: projects.filter((p) =>
      p.executionStatus === "awarded" || p.executionStatus === "in_execution",
    ).length,
    completed: projects.filter((p) => p.executionStatus === "completed")
      .length,
    contractValue: projects.reduce((sum, p) => sum + p.finalAwardValue, 0),
    paymentsReceived: projects.reduce((sum, p) => sum + p.paymentsReceived, 0),
    paymentOverdue: projects.reduce((sum, p) => sum + p.overdueAmount, 0),
  };
}

export async function getWonProjectDetail(
  projectId: string,
  companyId: string,
): Promise<WonProjectDetail | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const project = mapProject(data as Record<string, unknown>);
  const [milestonesMap, paymentsMap, documents] = await Promise.all([
    loadMilestonesForProjects([project.id]),
    loadPaymentsForProjects([project.id]),
    listWonProjectDocuments(project.id, companyId),
  ]);
  const milestones = milestonesMap.get(project.id) || [];
  const payments = paymentsMap.get(project.id) || [];
  return {
    ...enrichListItem(project, milestones, payments),
    milestones,
    payments,
    documents,
  };
}

export async function updateWonProject(
  projectId: string,
  companyId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_projects")
    .update({ ...patch, updated_by: userId })
    .eq("id", projectId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function createMilestone(options: {
  companyId: string;
  userId: string;
  wonProjectId: string;
  title: string;
  description?: string | null;
  dueDate: string;
  milestoneValue?: number | null;
  paymentLinked?: boolean;
  status?: WonMilestoneStatus;
  ownerId?: string | null;
  completedAt?: string | null;
  notes?: string | null;
}): Promise<string> {
  const supabase = getServerSupabase();
  const { data: maxRow } = await supabase
    .from("agenttender_won_project_milestones")
    .select("sort_order")
    .eq("won_project_id", options.wonProjectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = num(maxRow?.sort_order) + 1;
  const status = parseMilestoneStatus(options.status) ?? "not_started";
  const completedAt =
    status === "completed"
      ? options.completedAt || new Date().toISOString().slice(0, 10)
      : null;
  const { data, error } = await supabase
    .from("agenttender_won_project_milestones")
    .insert({
      company_id: options.companyId,
      won_project_id: options.wonProjectId,
      title: options.title.trim(),
      description: options.description || null,
      due_date: options.dueDate,
      milestone_value: options.milestoneValue ?? null,
      payment_linked: Boolean(options.paymentLinked),
      status,
      owner_id: options.ownerId || null,
      completed_at: completedAt,
      notes: options.notes || null,
      sort_order: sortOrder,
      created_by: options.userId,
      updated_by: options.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function updateMilestone(options: {
  companyId: string;
  userId: string;
  milestoneId: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_project_milestones")
    .update({ ...options.patch, updated_by: options.userId })
    .eq("id", options.milestoneId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

export async function deleteMilestone(
  milestoneId: string,
  companyId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_project_milestones")
    .delete()
    .eq("id", milestoneId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function createPayment(options: {
  companyId: string;
  userId: string;
  wonProjectId: string;
  title: string;
  milestoneId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount: number;
  dueDate: string;
  paymentMode?: WonPaymentMode | null;
  transactionReference?: string | null;
  notes?: string | null;
}): Promise<string> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_payments")
    .insert({
      company_id: options.companyId,
      won_project_id: options.wonProjectId,
      milestone_id: options.milestoneId || null,
      title: options.title.trim(),
      invoice_number: options.invoiceNumber || null,
      invoice_date: options.invoiceDate || null,
      amount: options.amount,
      due_date: options.dueDate,
      received_amount: 0,
      payment_mode: options.paymentMode || null,
      transaction_reference: options.transactionReference || null,
      status: "pending",
      notes: options.notes || null,
      created_by: options.userId,
      updated_by: options.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function updatePayment(options: {
  companyId: string;
  userId: string;
  paymentId: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_project_payments")
    .update({ ...options.patch, updated_by: options.userId })
    .eq("id", options.paymentId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

export async function deletePayment(
  paymentId: string,
  companyId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_project_payments")
    .delete()
    .eq("id", paymentId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function addPaymentReceipt(options: {
  companyId: string;
  userId: string;
  paymentId: string;
  amount: number;
  receivedDate: string;
  paymentMode: WonPaymentMode;
  transactionReference?: string | null;
  notes?: string | null;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { data: payment, error: payError } = await supabase
    .from("agenttender_won_project_payments")
    .select("id, amount, received_amount, status, company_id")
    .eq("id", options.paymentId)
    .eq("company_id", options.companyId)
    .single();
  if (payError) throw new Error(payError.message);
  if (payment.status === "cancelled") {
    throw new Error("Cannot record payment on a cancelled invoice.");
  }

  const { error: insertError } = await supabase
    .from("agenttender_won_project_payment_receipts")
    .insert({
      company_id: options.companyId,
      payment_id: options.paymentId,
      amount: options.amount,
      received_date: options.receivedDate,
      payment_mode: options.paymentMode,
      transaction_reference: options.transactionReference || null,
      notes: options.notes || null,
      created_by: options.userId,
    });
  if (insertError) throw new Error(insertError.message);

  const { data: receipts, error: sumError } = await supabase
    .from("agenttender_won_project_payment_receipts")
    .select("amount")
    .eq("payment_id", options.paymentId);
  if (sumError) throw new Error(sumError.message);
  const receivedAmount = (receipts || []).reduce(
    (sum, r) => sum + num(r.amount),
    0,
  );
  const amount = num(payment.amount);
  if (receivedAmount > amount + 0.009) {
    throw new Error("Received total cannot exceed invoice amount.");
  }
  const derived = derivePaymentStatus({
    amount,
    receivedAmount,
    dueDate: String(
      (
        await supabase
          .from("agenttender_won_project_payments")
          .select("due_date")
          .eq("id", options.paymentId)
          .single()
      ).data?.due_date || "",
    ).slice(0, 10),
  });

  const { error: updateError } = await supabase
    .from("agenttender_won_project_payments")
    .update({
      received_amount: receivedAmount,
      received_date: options.receivedDate,
      payment_mode: options.paymentMode,
      transaction_reference: options.transactionReference || null,
      status: derived,
      updated_by: options.userId,
    })
    .eq("id", options.paymentId)
    .eq("company_id", options.companyId);
  if (updateError) throw new Error(updateError.message);
}

export async function listWonProjectDocuments(
  wonProjectId: string,
  companyId: string,
): Promise<WonProjectDocument[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_documents")
    .select("*")
    .eq("won_project_id", wonProjectId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const userIds = [
    ...new Set(
      (data || [])
        .map((r) => str((r as Record<string, unknown>).created_by))
        .filter(Boolean) as string[],
    ),
  ];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("agenttender_users")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const u of users || []) {
      names.set(
        String(u.id),
        String(u.full_name || u.email || "").trim() || "User",
      );
    }
  }

  return (data || []).map((row) => {
    const rec = row as Record<string, unknown>;
    return mapDocument(
      rec,
      rec.created_by ? names.get(String(rec.created_by)) || null : null,
    );
  });
}

export async function insertWonProjectDocument(options: {
  companyId: string;
  userId: string;
  wonProjectId: string;
  title: string;
  category: WonDocumentCategory;
  fileName: string;
  originalName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  storageUrl?: string | null;
  storageProvider?: string;
  tenderDocumentId?: string | null;
  documentDate?: string | null;
  description?: string | null;
  milestoneId?: string | null;
  paymentId?: string | null;
}): Promise<string> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_documents")
    .insert({
      company_id: options.companyId,
      won_project_id: options.wonProjectId,
      title: options.title.trim(),
      category: options.category,
      file_name: options.fileName,
      original_name: options.originalName || options.fileName,
      mime_type: options.mimeType || null,
      file_size_bytes: options.fileSizeBytes ?? null,
      storage_provider: options.storageProvider || "sharepoint",
      storage_url: options.storageUrl || null,
      tender_document_id: options.tenderDocumentId || null,
      document_date: options.documentDate || null,
      description: options.description || null,
      milestone_id: options.milestoneId || null,
      payment_id: options.paymentId || null,
      created_by: options.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function deleteWonProjectDocument(
  documentId: string,
  companyId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_won_project_documents")
    .delete()
    .eq("id", documentId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function getWonProjectDocument(
  documentId: string,
  companyId: string,
): Promise<WonProjectDocument | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_won_project_documents")
    .select("*")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapDocument(data as Record<string, unknown>);
}
