export type BidProfileTemplate = {
  id: string;
  companyId: string;
  templateName: string;
  description: string | null;
  isDefault: boolean;
  companyName: string;
  referenceNumber: string | null;
  tenderAcceptanceUndertakingDate: string | null;
  minimumLocalContent: number | null;
  localValueAdditionLocation: string | null;
  authorizedPersonName: string;
  authorizedPersonPosition: string | null;
  signatoryName: string;
  signatoryDesignation: string | null;
  departmentName: string;
  departmentAddress: string | null;
  companyAddress: string | null;
  companySignStampUrl: string | null;
  companySignStampFileName: string | null;
  companySignatoryUrl: string | null;
  companyLogoUrl: string | null;
  companyLogoBlobName: string | null;
  companySignatoryBlobName: string | null;
  status: "active" | "archived";
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BidProfileTemplateInsert = {
  templateName: string;
  description?: string | null;
  isDefault?: boolean;
  companyName: string;
  referenceNumber?: string | null;
  tenderAcceptanceUndertakingDate?: string | null;
  minimumLocalContent?: number | null;
  localValueAdditionLocation?: string | null;
  authorizedPersonName: string;
  authorizedPersonPosition?: string | null;
  signatoryName: string;
  signatoryDesignation?: string | null;
  departmentName: string;
  departmentAddress?: string | null;
  companyAddress?: string | null;
  companySignatoryUrl?: string | null;
  companySignatoryBlobName?: string | null;
};

export type BidProfileTemplateUpdate = Partial<BidProfileTemplateInsert>;

export type BidPreparationTender = {
  id: string;
  sourceTenderId: string;
  folderId: string | null;
  title: string;
  organization: string | null;
  authority: string | null;
  tenderValue: number | null;
  tenderValueText: string | null;
  closingDate: string | null;
  sourcePortal: string;
  qualificationStatus: string | null;
  sourceUrl: string | null;
};

export type CompanyTemplatePrefill = {
  companyName: string;
  companyAddress: string;
};
