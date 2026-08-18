/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PastExperienceDialog } from "@/components/documents/past-experience-dialog";
import type { CompanyExperience } from "@/lib/experience/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/server/actions/experience", () => ({
  createCompanyExperienceAction: async () => ({}),
  updateCompanyExperienceAction: async () => ({}),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
});

const experience: CompanyExperience = {
  id: "exp-1",
  companyId: "co-1",
  projectName: "UIDAI Data Center",
  clientName: "UIDAI",
  location: "Delhi",
  natureOfWork: "Software Development",
  projectValueInr: 150000,
  projectStatus: "ongoing",
  startDate: "2026-08-01",
  endDate: null,
  expectedCompletionDate: "2026-12-01",
  durationMonths: 0,
  description: null,
  contactPersonName: "Rajesh",
  contactMobile: "9876543210",
  contactEmail: null,
  workOrderUrl: null,
  workOrderBlobName: null,
  workOrderFileName: "wo.pdf",
  completionCertificateUrl: null,
  completionCertificateBlobName: null,
  completionCertificateFileName: null,
  status: "active",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

describe("PastExperienceDialog dates", () => {
  it("hides expected and actual completion dates for ongoing projects", () => {
    render(
      <PastExperienceDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        experience={experience}
      />,
    );
    expect(screen.getByLabelText("Start Date *")).toBeTruthy();
    expect(screen.queryByLabelText(/Expected Completion Date/i)).toBeNull();
    expect(screen.queryByLabelText(/Completion Date/i)).toBeNull();
  });

  it("shows required completion date when switched to completed", async () => {
    const user = userEvent.setup();
    render(
      <PastExperienceDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        experience={experience}
      />,
    );
    await user.click(screen.getByLabelText("Project is ongoing"));
    expect(screen.getByLabelText("Completion Date *")).toBeTruthy();
    expect(screen.queryByLabelText(/Expected Completion Date/i)).toBeNull();
  });
});
