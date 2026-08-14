export const DEFAULT_PROPOSAL_SECTIONS = [
  { sectionKey: "executive_summary", title: "Executive Summary" },
  { sectionKey: "scope_understanding", title: "Understanding of Scope" },
  { sectionKey: "technical_approach", title: "Technical Approach" },
  { sectionKey: "project_plan", title: "Project Plan" },
  { sectionKey: "team_cvs", title: "Team / CVs" },
  { sectionKey: "compliance", title: "Compliance Matrix" },
] as const;

export const BOQ_CATEGORIES = [
  "Services",
  "Software",
  "Hardware",
  "AMC",
  "Other",
] as const;

export const BOQ_UOMS = ["Nos", "LS", "Man-month", "Man-day", "Set", "Lot"] as const;

export const WORKSPACE_DOCUMENT_TYPES = [
  "Technical Proposal",
  "Financial BOQ",
  "EMD",
  "Tender Fee",
  "Power of Attorney",
  "Other",
] as const;

export const WORKSPACE_DOCUMENT_STATUSES = [
  "drafting",
  "pending",
  "ready",
  "approved",
] as const;

export type BoqCategory = (typeof BOQ_CATEGORIES)[number];
export type BoqUom = (typeof BOQ_UOMS)[number];
export type WorkspaceDocumentType = (typeof WORKSPACE_DOCUMENT_TYPES)[number];
export type WorkspaceDocumentStatus = (typeof WORKSPACE_DOCUMENT_STATUSES)[number];
export type ProposalSectionStatus = "draft" | "complete";
export type BidSubmissionStatus = "not_submitted" | "submitted";

export type ProposalSectionRow = {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  content: string;
  status: ProposalSectionStatus;
  updatedAt: string;
};

export type BoqItemRow = {
  id: string;
  description: string;
  category: string;
  uom: string;
  quantity: number;
  unitRate: number;
  gstPercent: number;
  notes: string | null;
  displayOrder: number;
};

export type WorkspaceDocumentRow = {
  id: string;
  documentType: WorkspaceDocumentType;
  title: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  status: WorkspaceDocumentStatus;
  isRequired: boolean;
  versionLabel: string | null;
  hasFile: boolean;
  updatedAt: string;
};

export type BidWorkspaceDTO = {
  id: string;
  tenderId: string;
  companyId: string;
  submissionStatus: BidSubmissionStatus;
  submittedAt: string | null;
  submissionReference: string | null;
  submissionNotes: string | null;
  updatedAt: string;
  sections: ProposalSectionRow[];
  boqItems: BoqItemRow[];
  documents: WorkspaceDocumentRow[];
  readiness: SubmissionReadiness;
};

export const DOCUMENT_STATUS_LABELS: Record<WorkspaceDocumentStatus, string> = {
  drafting: "Drafting",
  pending: "Pending",
  ready: "Ready",
  approved: "Approved",
};

export function isProposalComplete(content: string | null | undefined): boolean {
  return Boolean(content?.trim());
}

export function lineSubtotal(quantity: number, unitRate: number): number {
  return quantity * unitRate;
}

export function lineGst(quantity: number, unitRate: number, gstPercent: number): number {
  return lineSubtotal(quantity, unitRate) * (gstPercent / 100);
}

export function lineTotal(quantity: number, unitRate: number, gstPercent: number): number {
  return lineSubtotal(quantity, unitRate) + lineGst(quantity, unitRate, gstPercent);
}

export type ReadinessItem = {
  key: string;
  label: string;
  completed: number;
  total: number;
  href?: string;
};

export type SubmissionReadiness = {
  percent: number;
  completed: number;
  total: number;
  items: ReadinessItem[];
  incompleteRequired: number;
};

export function computeSubmissionReadiness(input: {
  proposalCompleted: number;
  proposalTotal: number;
  boqLineCount: number;
  documentsReady: number;
  documentsRequired: number;
  pqMatched: number;
  pqMandatory: number;
}): SubmissionReadiness {
  const items: ReadinessItem[] = [
    {
      key: "proposal",
      label: "Technical Proposal",
      completed: input.proposalCompleted,
      total: input.proposalTotal,
      href: "#proposal",
    },
    {
      key: "boq",
      label: "Financial BOQ",
      completed: input.boqLineCount > 0 ? 1 : 0,
      total: 1,
      href: "#boq",
    },
  ];

  if (input.documentsRequired > 0) {
    items.push({
      key: "documents",
      label: "Documents",
      completed: input.documentsReady,
      total: input.documentsRequired,
      href: "#documents",
    });
  }

  if (input.pqMandatory > 0) {
    items.push({
      key: "pqtq",
      label: "Mandatory PQ/TQ",
      completed: input.pqMatched,
      total: input.pqMandatory,
    });
  }

  const completed = items.reduce((sum, item) => sum + Math.min(item.completed, item.total), 0);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const incompleteRequired = items.reduce(
    (sum, item) => sum + Math.max(0, item.total - Math.min(item.completed, item.total)),
    0,
  );

  return { percent, completed, total, items, incompleteRequired };
}

export function nextDocumentVersion(current: string | null | undefined): string {
  const match = /^v(\d+)(?:\.(\d+))?$/i.exec((current || "").trim());
  if (!match) return "v1";
  const major = Number(match[1] || "1");
  return `v${major + 1}`;
}

export function isDocumentReadyForSubmission(
  status: WorkspaceDocumentStatus,
  hasFile: boolean,
): boolean {
  return hasFile && (status === "ready" || status === "approved");
}
