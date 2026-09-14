"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { SourceBadge } from "@/components/status/source-badge";
import {
  ExecutionStatusBadge,
  HealthStatusBadge,
  MilestoneStatusBadge,
  PaymentStatusBadge,
} from "@/components/won-tenders/won-project-badges";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import {
  WON_DOCUMENT_CATEGORIES,
  WON_DOCUMENT_CATEGORY_LABELS,
  WON_EXECUTION_STATUSES,
  WON_EXECUTION_STATUS_LABELS,
  WON_MILESTONE_STATUSES,
  WON_MILESTONE_STATUS_LABELS,
  WON_PAYMENT_MODES,
  WON_PAYMENT_MODE_LABELS,
  type WonDocumentCategory,
  type WonExecutionStatus,
  type WonMilestoneStatus,
  type WonPaymentMode,
  type WonProjectDetail,
  type WonProjectMilestone,
  type WonProjectPayment,
} from "@/lib/won-projects";
import { uploadTenderDocumentDirectToAzure } from "@/lib/uploads/directAzureUpload";
import { documentUploadAcceptAttr } from "@/lib/uploads/validation";
import { cn } from "@/lib/utils";
import {
  deleteWonMilestoneAction,
  deleteWonPaymentAction,
  deleteWonProjectDocumentAction,
  recordWonPaymentReceivedAction,
  saveWonMilestoneAction,
  saveWonPaymentAction,
  updateWonProjectAction,
  uploadWonProjectDocumentAction,
} from "@/server/actions/won-projects";

type TeamMemberOption = { id: string; fullName: string };

type WonProjectDetailClientProps = {
  project: WonProjectDetail;
  teamMembers: TeamMemberOption[];
  canEdit: boolean;
};

function portalSource(portal: string | null): TenderSource {
  const upper = (portal || "").toUpperCase();
  if (upper === "BIDASSIST") return "BIDASSIST";
  if (upper === "MANUAL") return "MANUAL";
  return "TENDER247";
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
      <Label className="text-xs text-foreground-500">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

export function WonProjectDetailClient({
  project,
  teamMembers,
  canEdit,
}: WonProjectDetailClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [overview, setOverview] = useState({
    executionStatus: project.executionStatus,
    awardDate: project.awardDate,
    finalAwardValue: String(project.finalAwardValue),
    poNumber: project.poNumber || "",
    poDate: project.poDate || "",
    contractNumber: project.contractNumber || "",
    contractStartDate: project.contractStartDate || "",
    contractEndDate: project.contractEndDate || "",
    clientDepartment: project.clientDepartment || "",
    projectManagerId: project.projectManagerId || "",
    pbgApplicable: project.pbgApplicable,
    pbgNumber: project.pbgNumber || "",
    pbgAmount: project.pbgAmount != null ? String(project.pbgAmount) : "",
    pbgIssueDate: project.pbgIssueDate || "",
    pbgExpiryDate: project.pbgExpiryDate || "",
    pbgBank: project.pbgBank || "",
    pbgStatus: project.pbgStatus || "",
    notes: project.notes || "",
  });

  const [dev, setDev] = useState({
    jiraProjectKey: project.jiraProjectKey || "",
    jiraUrl: project.jiraUrl || "",
    repositoryUrl: project.repositoryUrl || "",
    deploymentUrl: project.deploymentUrl || "",
    stagingUrl: project.stagingUrl || "",
    productionUrl: project.productionUrl || "",
    developmentNotes: project.developmentNotes || "",
  });

  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] =
    useState<WonProjectMilestone | null>(null);
  const [milestoneForm, setMilestoneForm] = useState({
    title: "",
    description: "",
    dueDate: "",
    milestoneValue: "",
    paymentLinked: false,
    status: "not_started" as WonMilestoneStatus,
    ownerId: "",
    completedAt: "",
    notes: "",
  });

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<WonProjectPayment | null>(
    null,
  );
  const [paymentForm, setPaymentForm] = useState({
    title: "",
    milestoneId: "",
    invoiceNumber: "",
    invoiceDate: "",
    amount: "",
    dueDate: "",
    paymentMode: "" as WonPaymentMode | "",
    transactionReference: "",
    notes: "",
  });

  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptPaymentId, setReceiptPaymentId] = useState("");
  const [receiptForm, setReceiptForm] = useState({
    amount: "",
    receivedDate: new Date().toISOString().slice(0, 10),
    paymentMode: "bank_transfer" as WonPaymentMode,
    transactionReference: "",
    notes: "",
  });

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({
    title: "",
    category: "other" as WonDocumentCategory,
    documentDate: "",
    description: "",
    milestoneId: "",
    paymentId: "",
  });

  const sortedMilestones = useMemo(
    () => [...project.milestones].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.milestones],
  );

  function refresh() {
    router.refresh();
  }

  function saveOverview() {
    const value = Number(overview.finalAwardValue.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Invalid award value.");
      return;
    }
    startTransition(async () => {
      const result = await updateWonProjectAction({
        projectId: project.id,
        executionStatus: overview.executionStatus,
        awardDate: overview.awardDate,
        finalAwardValue: value,
        poNumber: overview.poNumber.trim() || null,
        poDate: overview.poDate || null,
        contractNumber: overview.contractNumber.trim() || null,
        contractStartDate: overview.contractStartDate || null,
        contractEndDate: overview.contractEndDate || null,
        clientDepartment: overview.clientDepartment.trim() || null,
        projectManagerId: overview.projectManagerId || null,
        pbgApplicable: overview.pbgApplicable,
        pbgNumber: overview.pbgNumber.trim() || null,
        pbgAmount: overview.pbgAmount ? Number(overview.pbgAmount) : null,
        pbgIssueDate: overview.pbgIssueDate || null,
        pbgExpiryDate: overview.pbgExpiryDate || null,
        pbgBank: overview.pbgBank.trim() || null,
        pbgStatus: overview.pbgStatus.trim() || null,
        notes: overview.notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      refresh();
    });
  }

  function saveDevelopment() {
    startTransition(async () => {
      const result = await updateWonProjectAction({
        projectId: project.id,
        jiraProjectKey: dev.jiraProjectKey.trim() || null,
        jiraUrl: dev.jiraUrl.trim() || null,
        repositoryUrl: dev.repositoryUrl.trim() || null,
        deploymentUrl: dev.deploymentUrl.trim() || null,
        stagingUrl: dev.stagingUrl.trim() || null,
        productionUrl: dev.productionUrl.trim() || null,
        developmentNotes: dev.developmentNotes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      refresh();
    });
  }

  function openMilestoneDialog(milestone?: WonProjectMilestone) {
    if (milestone) {
      setEditingMilestone(milestone);
      setMilestoneForm({
        title: milestone.title,
        description: milestone.description || "",
        dueDate: milestone.dueDate,
        milestoneValue:
          milestone.milestoneValue != null ? String(milestone.milestoneValue) : "",
        paymentLinked: milestone.paymentLinked,
        status: milestone.status,
        ownerId: milestone.ownerId || "",
        completedAt: milestone.completedAt || "",
        notes: milestone.notes || "",
      });
    } else {
      setEditingMilestone(null);
      setMilestoneForm({
        title: "",
        description: "",
        dueDate: "",
        milestoneValue: "",
        paymentLinked: false,
        status: "not_started",
        ownerId: "",
        completedAt: "",
        notes: "",
      });
    }
    setMilestoneDialogOpen(true);
  }

  function saveMilestone() {
    if (!milestoneForm.title.trim() || !milestoneForm.dueDate) {
      toast.error("Title and due date are required.");
      return;
    }
    startTransition(async () => {
      const result = await saveWonMilestoneAction({
        projectId: project.id,
        milestoneId: editingMilestone?.id,
        title: milestoneForm.title.trim(),
        description: milestoneForm.description.trim() || null,
        dueDate: milestoneForm.dueDate,
        milestoneValue: milestoneForm.milestoneValue
          ? Number(milestoneForm.milestoneValue)
          : null,
        paymentLinked: milestoneForm.paymentLinked,
        status: milestoneForm.status,
        ownerId: milestoneForm.ownerId || null,
        completedAt: milestoneForm.completedAt || null,
        notes: milestoneForm.notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setMilestoneDialogOpen(false);
      refresh();
    });
  }

  function removeMilestone(milestoneId: string) {
    if (!window.confirm("Delete this milestone?")) return;
    startTransition(async () => {
      const result = await deleteWonMilestoneAction({
        projectId: project.id,
        milestoneId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      refresh();
    });
  }

  function openPaymentDialog(payment?: WonProjectPayment) {
    if (payment) {
      setEditingPayment(payment);
      setPaymentForm({
        title: payment.title,
        milestoneId: payment.milestoneId || "",
        invoiceNumber: payment.invoiceNumber || "",
        invoiceDate: payment.invoiceDate || "",
        amount: String(payment.amount),
        dueDate: payment.dueDate,
        paymentMode: payment.paymentMode || "",
        transactionReference: payment.transactionReference || "",
        notes: payment.notes || "",
      });
    } else {
      setEditingPayment(null);
      setPaymentForm({
        title: "",
        milestoneId: "",
        invoiceNumber: "",
        invoiceDate: "",
        amount: "",
        dueDate: "",
        paymentMode: "",
        transactionReference: "",
        notes: "",
      });
    }
    setPaymentDialogOpen(true);
  }

  function savePayment() {
    if (!paymentForm.title.trim() || !paymentForm.dueDate) {
      toast.error("Title and due date are required.");
      return;
    }
    const amount = Number(paymentForm.amount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Invalid amount.");
      return;
    }
    startTransition(async () => {
      const result = await saveWonPaymentAction({
        projectId: project.id,
        paymentId: editingPayment?.id,
        title: paymentForm.title.trim(),
        milestoneId: paymentForm.milestoneId || null,
        invoiceNumber: paymentForm.invoiceNumber.trim() || null,
        invoiceDate: paymentForm.invoiceDate || null,
        amount,
        dueDate: paymentForm.dueDate,
        paymentMode: paymentForm.paymentMode || null,
        transactionReference: paymentForm.transactionReference.trim() || null,
        notes: paymentForm.notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setPaymentDialogOpen(false);
      refresh();
    });
  }

  function removePayment(paymentId: string) {
    if (!window.confirm("Delete this payment record?")) return;
    startTransition(async () => {
      const result = await deleteWonPaymentAction({
        projectId: project.id,
        paymentId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      refresh();
    });
  }

  function openReceiptDialog(payment: WonProjectPayment) {
    setReceiptPaymentId(payment.id);
    setReceiptForm({
      amount: payment.balance > 0 ? String(payment.balance) : "",
      receivedDate: new Date().toISOString().slice(0, 10),
      paymentMode: "bank_transfer",
      transactionReference: "",
      notes: "",
    });
    setReceiptDialogOpen(true);
  }

  function saveReceipt() {
    const amount = Number(receiptForm.amount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid received amount.");
      return;
    }
    startTransition(async () => {
      const result = await recordWonPaymentReceivedAction({
        projectId: project.id,
        paymentId: receiptPaymentId,
        amount,
        receivedDate: receiptForm.receivedDate,
        paymentMode: receiptForm.paymentMode,
        transactionReference: receiptForm.transactionReference.trim() || null,
        notes: receiptForm.notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setReceiptDialogOpen(false);
      refresh();
    });
  }

  function uploadDocument() {
    if (!docFile || !docForm.title.trim()) {
      toast.error("Select a file and enter a title.");
      return;
    }
    startTransition(async () => {
      const uploaded = await uploadTenderDocumentDirectToAzure({
        tenderId: project.tenderId,
        section: "deliverable",
        file: docFile,
      });
      if (!uploaded.ok) {
        toast.error(uploaded.error);
        return;
      }
      const result = await uploadWonProjectDocumentAction({
        projectId: project.id,
        tenderId: project.tenderId,
        tenderDocumentId: uploaded.documentId,
        title: docForm.title.trim(),
        category: docForm.category,
        documentDate: docForm.documentDate || null,
        description: docForm.description.trim() || null,
        milestoneId: docForm.milestoneId || null,
        paymentId: docForm.paymentId || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setDocDialogOpen(false);
      setDocFile(null);
      refresh();
    });
  }

  function removeDocument(documentId: string) {
    if (!window.confirm("Delete this document record?")) return;
    startTransition(async () => {
      const result = await deleteWonProjectDocumentAction({
        projectId: project.id,
        documentId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={portalSource(project.portal)} size="sm" />
              <ExecutionStatusBadge status={project.executionStatus} />
              <HealthStatusBadge health={project.health} />
              <span className="text-xs font-medium text-foreground-500">
                {project.projectCode}
              </span>
            </div>
            <h1 className="text-lg font-semibold text-foreground-900">
              {project.tenderTitle}
            </h1>
            <p className="text-sm text-foreground-500">
              {project.organization || "—"}
              {project.referenceNo ? ` · ${project.referenceNo}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tenders/${project.tenderId}`}>View Tender</Link>
            </Button>
            {project.jiraUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={project.jiraUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Jira
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-foreground-500">Award Value</p>
            <p className="font-semibold">
              {formatIndianCurrency(project.finalAwardValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-500">Received</p>
            <p className="font-semibold">
              {formatIndianCurrency(project.paymentsReceived)}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-500">Outstanding</p>
            <p className="font-semibold">
              {formatIndianCurrency(project.outstandingAmount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-500">Overdue</p>
            <p
              className={cn(
                "font-semibold",
                project.overdueAmount > 0 && "text-rose-700",
              )}
            >
              {formatIndianCurrency(project.overdueAmount)}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="milestones">
            Milestones ({project.milestones.length})
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments ({project.payments.length})
          </TabsTrigger>
          <TabsTrigger value="development">Development</TabsTrigger>
          <TabsTrigger value="documents">
            Documents ({project.documents.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <FieldRow label="Execution Status">
              <Select
                value={overview.executionStatus}
                onValueChange={(v) =>
                  setOverview((o) => ({
                    ...o,
                    executionStatus: v as WonExecutionStatus,
                  }))
                }
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WON_EXECUTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WON_EXECUTION_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Award Date">
              <Input
                type="date"
                value={overview.awardDate}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, awardDate: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Final Award Value">
              <Input
                value={overview.finalAwardValue}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, finalAwardValue: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="PO Number">
              <Input
                value={overview.poNumber}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, poNumber: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="PO Date">
              <Input
                type="date"
                value={overview.poDate}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, poDate: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Contract #">
              <Input
                value={overview.contractNumber}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, contractNumber: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Contract Period">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={overview.contractStartDate}
                  onChange={(e) =>
                    setOverview((o) => ({
                      ...o,
                      contractStartDate: e.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
                <Input
                  type="date"
                  value={overview.contractEndDate}
                  onChange={(e) =>
                    setOverview((o) => ({
                      ...o,
                      contractEndDate: e.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
              </div>
            </FieldRow>
            <FieldRow label="Client Dept">
              <Input
                value={overview.clientDepartment}
                onChange={(e) =>
                  setOverview((o) => ({
                    ...o,
                    clientDepartment: e.target.value,
                  }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Project Manager">
              <Select
                value={overview.projectManagerId || "__none__"}
                onValueChange={(v) =>
                  setOverview((o) => ({
                    ...o,
                    projectManagerId: v === "__none__" ? "" : v,
                  }))
                }
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <div className="rounded-md border border-border p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={overview.pbgApplicable}
                  onCheckedChange={(v) =>
                    setOverview((o) => ({ ...o, pbgApplicable: Boolean(v) }))
                  }
                  disabled={!canEdit}
                />
                PBG Applicable
              </label>
              {overview.pbgApplicable ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="PBG Number"
                    value={overview.pbgNumber}
                    onChange={(e) =>
                      setOverview((o) => ({ ...o, pbgNumber: e.target.value }))
                    }
                    disabled={!canEdit}
                  />
                  <Input
                    placeholder="PBG Amount"
                    value={overview.pbgAmount}
                    onChange={(e) =>
                      setOverview((o) => ({ ...o, pbgAmount: e.target.value }))
                    }
                    disabled={!canEdit}
                  />
                  <Input
                    type="date"
                    value={overview.pbgIssueDate}
                    onChange={(e) =>
                      setOverview((o) => ({
                        ...o,
                        pbgIssueDate: e.target.value,
                      }))
                    }
                    disabled={!canEdit}
                  />
                  <Input
                    type="date"
                    value={overview.pbgExpiryDate}
                    onChange={(e) =>
                      setOverview((o) => ({
                        ...o,
                        pbgExpiryDate: e.target.value,
                      }))
                    }
                    disabled={!canEdit}
                  />
                  <Input
                    placeholder="PBG Bank"
                    value={overview.pbgBank}
                    onChange={(e) =>
                      setOverview((o) => ({ ...o, pbgBank: e.target.value }))
                    }
                    disabled={!canEdit}
                  />
                  <Input
                    placeholder="PBG Status"
                    value={overview.pbgStatus}
                    onChange={(e) =>
                      setOverview((o) => ({ ...o, pbgStatus: e.target.value }))
                    }
                    disabled={!canEdit}
                  />
                </div>
              ) : null}
            </div>
            <FieldRow label="Notes">
              <Textarea
                rows={3}
                value={overview.notes}
                onChange={(e) =>
                  setOverview((o) => ({ ...o, notes: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            {canEdit ? (
              <Button size="sm" onClick={saveOverview} disabled={pending}>
                {pending ? "Saving…" : "Save Overview"}
              </Button>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="milestones" className="mt-4 space-y-3">
          {canEdit ? (
            <Button size="sm" onClick={() => openMilestoneDialog()}>
              <Plus className="size-4" />
              Add Milestone
            </Button>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-foreground-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Value</th>
                  {canEdit ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {sortedMilestones.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canEdit ? 6 : 5}
                      className="px-3 py-6 text-center text-foreground-500"
                    >
                      No milestones yet.
                    </td>
                  </tr>
                ) : (
                  sortedMilestones.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{m.title}</td>
                      <td className="px-3 py-2">{formatDate(m.dueDate)}</td>
                      <td className="px-3 py-2">
                        <MilestoneStatusBadge status={m.status} />
                      </td>
                      <td className="px-3 py-2">{m.ownerName || "—"}</td>
                      <td className="px-3 py-2">
                        {m.milestoneValue != null
                          ? formatIndianCurrency(m.milestoneValue)
                          : "—"}
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => openMilestoneDialog(m)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-rose-600"
                              onClick={() => removeMilestone(m.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="payments" className="mt-4 space-y-3">
          {canEdit ? (
            <Button size="sm" onClick={() => openPaymentDialog()}>
              <Plus className="size-4" />
              Add Payment
            </Button>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-foreground-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Status</th>
                  {canEdit ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {project.payments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canEdit ? 6 : 5}
                      className="px-3 py-6 text-center text-foreground-500"
                    >
                      No payment records yet.
                    </td>
                  </tr>
                ) : (
                  project.payments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.title}</div>
                        {p.milestoneTitle ? (
                          <div className="text-xs text-foreground-500">
                            {p.milestoneTitle}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{formatDate(p.dueDate)}</td>
                      <td className="px-3 py-2">
                        {formatIndianCurrency(p.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {formatIndianCurrency(p.receivedAmount)}
                        {p.balance > 0 ? (
                          <div className="text-xs text-foreground-500">
                            Bal: {formatIndianCurrency(p.balance)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <PaymentStatusBadge status={p.derivedStatus} />
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {p.balance > 0 && p.derivedStatus !== "cancelled" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => openReceiptDialog(p)}
                              >
                                Record
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => openPaymentDialog(p)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-rose-600"
                              onClick={() => removePayment(p.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="development" className="mt-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <FieldRow label="Jira Key">
              <Input
                value={dev.jiraProjectKey}
                onChange={(e) =>
                  setDev((d) => ({ ...d, jiraProjectKey: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Jira URL">
              <Input
                value={dev.jiraUrl}
                onChange={(e) =>
                  setDev((d) => ({ ...d, jiraUrl: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Repository">
              <Input
                value={dev.repositoryUrl}
                onChange={(e) =>
                  setDev((d) => ({ ...d, repositoryUrl: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Deployment URL">
              <Input
                value={dev.deploymentUrl}
                onChange={(e) =>
                  setDev((d) => ({ ...d, deploymentUrl: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Staging URL">
              <Input
                value={dev.stagingUrl}
                onChange={(e) =>
                  setDev((d) => ({ ...d, stagingUrl: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Production URL">
              <Input
                value={dev.productionUrl}
                onChange={(e) =>
                  setDev((d) => ({ ...d, productionUrl: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            <FieldRow label="Dev Notes">
              <Textarea
                rows={4}
                value={dev.developmentNotes}
                onChange={(e) =>
                  setDev((d) => ({ ...d, developmentNotes: e.target.value }))
                }
                disabled={!canEdit}
              />
            </FieldRow>
            {canEdit ? (
              <Button size="sm" onClick={saveDevelopment} disabled={pending}>
                {pending ? "Saving…" : "Save Development"}
              </Button>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-3">
          {canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                setDocForm({
                  title: "",
                  category: "other",
                  documentDate: "",
                  description: "",
                  milestoneId: "",
                  paymentId: "",
                });
                setDocFile(null);
                setDocDialogOpen(true);
              }}
            >
              <Upload className="size-4" />
              Upload Document
            </Button>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-foreground-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Uploaded</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {project.documents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-foreground-500"
                    >
                      No documents yet.
                    </td>
                  </tr>
                ) : (
                  project.documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{doc.title}</td>
                      <td className="px-3 py-2">
                        {WON_DOCUMENT_CATEGORY_LABELS[doc.category]}
                      </td>
                      <td className="px-3 py-2">
                        {formatDate(doc.documentDate)}
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground-500">
                        {doc.createdByName || "—"} ·{" "}
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="size-8" asChild>
                            <a
                              href={`/api/won-tenders/documents/${doc.id}?download=1`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="size-3.5" />
                            </a>
                          </Button>
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-rose-600"
                              onClick={() => removeDocument(doc.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={milestoneDialogOpen} onOpenChange={setMilestoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMilestone ? "Edit Milestone" : "Add Milestone"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Title *</Label>
              <Input
                value={milestoneForm.title}
                onChange={(e) =>
                  setMilestoneForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Due Date *</Label>
              <Input
                type="date"
                value={milestoneForm.dueDate}
                onChange={(e) =>
                  setMilestoneForm((f) => ({ ...f, dueDate: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={milestoneForm.status}
                onValueChange={(v) =>
                  setMilestoneForm((f) => ({
                    ...f,
                    status: v as WonMilestoneStatus,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WON_MILESTONE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WON_MILESTONE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Value (INR)</Label>
              <Input
                value={milestoneForm.milestoneValue}
                onChange={(e) =>
                  setMilestoneForm((f) => ({
                    ...f,
                    milestoneValue: e.target.value,
                  }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={milestoneForm.paymentLinked}
                onCheckedChange={(v) =>
                  setMilestoneForm((f) => ({
                    ...f,
                    paymentLinked: Boolean(v),
                  }))
                }
              />
              Payment linked
            </label>
            <div className="grid gap-2">
              <Label>Owner</Label>
              <Select
                value={milestoneForm.ownerId || "__none__"}
                onValueChange={(v) =>
                  setMilestoneForm((f) => ({
                    ...f,
                    ownerId: v === "__none__" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={milestoneForm.description}
                onChange={(e) =>
                  setMilestoneForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMilestoneDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveMilestone} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPayment ? "Edit Payment" : "Add Payment"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Title *</Label>
              <Input
                value={paymentForm.title}
                onChange={(e) =>
                  setPaymentForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Linked Milestone</Label>
              <Select
                value={paymentForm.milestoneId || "__none__"}
                onValueChange={(v) =>
                  setPaymentForm((f) => ({
                    ...f,
                    milestoneId: v === "__none__" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {sortedMilestones.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Amount *</Label>
                <Input
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Due Date *</Label>
                <Input
                  type="date"
                  value={paymentForm.dueDate}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Invoice #</Label>
                <Input
                  value={paymentForm.invoiceNumber}
                  onChange={(e) =>
                    setPaymentForm((f) => ({
                      ...f,
                      invoiceNumber: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Invoice Date</Label>
                <Input
                  type="date"
                  value={paymentForm.invoiceDate}
                  onChange={(e) =>
                    setPaymentForm((f) => ({
                      ...f,
                      invoiceDate: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={paymentForm.notes}
                onChange={(e) =>
                  setPaymentForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={savePayment} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment Received</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Amount *</Label>
              <Input
                value={receiptForm.amount}
                onChange={(e) =>
                  setReceiptForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Received Date *</Label>
              <Input
                type="date"
                value={receiptForm.receivedDate}
                onChange={(e) =>
                  setReceiptForm((f) => ({
                    ...f,
                    receivedDate: e.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Payment Mode *</Label>
              <Select
                value={receiptForm.paymentMode}
                onValueChange={(v) =>
                  setReceiptForm((f) => ({
                    ...f,
                    paymentMode: v as WonPaymentMode,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WON_PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {WON_PAYMENT_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Transaction Reference</Label>
              <Input
                value={receiptForm.transactionReference}
                onChange={(e) =>
                  setReceiptForm((f) => ({
                    ...f,
                    transactionReference: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReceiptDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveReceipt} disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>File *</Label>
              <Input
                type="file"
                accept={documentUploadAcceptAttr()}
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Title *</Label>
              <Input
                value={docForm.title}
                onChange={(e) =>
                  setDocForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={docForm.category}
                onValueChange={(v) =>
                  setDocForm((f) => ({
                    ...f,
                    category: v as WonDocumentCategory,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WON_DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {WON_DOCUMENT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Document Date</Label>
              <Input
                type="date"
                value={docForm.documentDate}
                onChange={(e) =>
                  setDocForm((f) => ({ ...f, documentDate: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={uploadDocument} disabled={pending || !docFile}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
