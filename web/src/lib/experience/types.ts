import type { NatureOfWork } from "@/lib/experience/nature-of-work";

export type ExperienceProjectStatus = "ongoing" | "completed";
export type ExperienceRecordStatus = "active" | "archived";

export type CompanyExperience = {
  id: string;
  companyId: string;
  projectName: string;
  clientName: string;
  location: string;
  natureOfWork: NatureOfWork | string;
  projectValueInr: number;
  projectStatus: ExperienceProjectStatus;
  startDate: string | null;
  endDate: string | null;
  expectedCompletionDate: string | null;
  durationMonths: number | null;
  description: string | null;
  contactPersonName: string;
  contactMobile: string;
  contactEmail: string | null;
  workOrderUrl: string | null;
  workOrderBlobName: string | null;
  workOrderFileName: string | null;
  completionCertificateUrl: string | null;
  completionCertificateBlobName: string | null;
  completionCertificateFileName: string | null;
  status: ExperienceRecordStatus;
  createdAt: string;
  updatedAt: string;
};

export type CompanyExperienceInsert = {
  projectName: string;
  clientName: string;
  location: string;
  natureOfWork: string;
  projectValueInr: number;
  projectStatus: ExperienceProjectStatus;
  startDate: string;
  endDate: string | null;
  expectedCompletionDate: string | null;
  durationMonths: number | null;
  description: string | null;
  contactPersonName: string;
  contactMobile: string;
  contactEmail: string | null;
};

export type CompanyExperienceUpdate = CompanyExperienceInsert;
