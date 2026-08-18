import { describe, expect, it } from "vitest";

import {
  experienceDurationMonths,
  formatDurationMonths,
} from "@/lib/experience/duration";
import { companyExperienceSchema } from "@/lib/experience/schema";
import type { CompanyExperience } from "@/lib/experience/types";

function sampleExperience(
  patch: Partial<CompanyExperience> = {},
): CompanyExperience {
  return {
    id: "exp-1",
    companyId: "co-1",
    projectName: "Portal Build",
    clientName: "UIDAI",
    location: "Delhi",
    natureOfWork: "Software Development",
    projectValueInr: 150000,
    projectStatus: "ongoing",
    startDate: "2026-08-17",
    endDate: null,
    expectedCompletionDate: "2026-12-01",
    durationMonths: 0,
    description: null,
    contactPersonName: "Rajesh",
    contactMobile: "9876543210",
    contactEmail: null,
    workOrderUrl: null,
    workOrderBlobName: null,
    workOrderFileName: null,
    completionCertificateUrl: null,
    completionCertificateBlobName: null,
    completionCertificateFileName: null,
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...patch,
  };
}

describe("formatDurationMonths", () => {
  it("shows <1 month instead of 0 months", () => {
    expect(formatDurationMonths(0)).toBe("<1 month");
    expect(formatDurationMonths(1)).toBe("1 month");
    expect(formatDurationMonths(2)).toBe("2 months");
    expect(formatDurationMonths(12)).toBe("12 months");
  });
});

describe("experienceDurationMonths", () => {
  it("calculates ongoing duration to today, not expected completion", () => {
    const months = experienceDurationMonths(
      sampleExperience({ startDate: "2026-06-17" }),
      new Date("2026-08-17T12:00:00Z"),
    );
    expect(months).toBe(2);
  });

  it("calculates completed duration only to completion date", () => {
    const months = experienceDurationMonths(
      sampleExperience({
        projectStatus: "completed",
        startDate: "2026-01-17",
        endDate: "2026-04-17",
        expectedCompletionDate: "2026-12-01",
      }),
      new Date("2026-08-17T12:00:00Z"),
    );
    expect(months).toBe(3);
  });
});

describe("companyExperienceSchema dates", () => {
  const base = {
    projectName: "Portal Build",
    clientName: "UIDAI",
    location: "Delhi",
    natureOfWork: "Software Development" as const,
    contractValue: "150000",
    startDate: "2026-08-01",
    description: "",
    contactPersonName: "Rajesh",
    contactMobile: "9876543210",
    contactEmail: "",
  };

  it("allows ongoing projects with only a start date", () => {
    const parsed = companyExperienceSchema.safeParse({
      ...base,
      projectStatus: "ongoing",
      completionDate: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a completion date on or after start for completed projects", () => {
    expect(
      companyExperienceSchema.safeParse({
        ...base,
        projectStatus: "completed",
        completionDate: "",
      }).success,
    ).toBe(false);

    const tooEarly = companyExperienceSchema.safeParse({
      ...base,
      projectStatus: "completed",
      completionDate: "2026-07-01",
    });
    expect(tooEarly.success).toBe(false);
    if (!tooEarly.success) {
      expect(tooEarly.error.issues[0]?.message).toBe(
        "Completion date cannot be before the start date",
      );
    }

    expect(
      companyExperienceSchema.safeParse({
        ...base,
        projectStatus: "completed",
        completionDate: "2026-08-17",
      }).success,
    ).toBe(true);
  });
});
