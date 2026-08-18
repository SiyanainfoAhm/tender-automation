/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExperienceCard } from "@/components/documents/experience-card";
import type { CompanyExperience } from "@/lib/experience/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/server/actions/experience", () => ({
  deleteCompanyExperienceAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function sampleExperience(
  patch: Partial<CompanyExperience> = {},
): CompanyExperience {
  return {
    id: "exp-1",
    companyId: "co-1",
    projectName: "UIDAI Data Center",
    clientName: "UIDAI",
    location: "Delhi",
    natureOfWork: "Software Development",
    projectValueInr: 150000,
    projectStatus: "ongoing",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "2026-08-17",
    expectedCompletionDate: "2026-12-01",
    durationMonths: 0,
    description: "Migration work",
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

describe("ExperienceCard", () => {
  it("keeps the action button visible without overlapping metrics", () => {
    const { container } = render(
      <ExperienceCard
        experience={sampleExperience()}
        canManage
        onView={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const trigger = screen.getAllByRole("button", {
      name: "Experience actions",
    })[0];
    expect(trigger).toBeTruthy();
    expect(trigger.className).not.toMatch(/opacity-0|group-hover/);
    expect(container.querySelector(".absolute")).toBeNull();
    expect(screen.getAllByText("Ongoing").length).toBeGreaterThan(0);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("<1 month").length).toBeGreaterThan(0);
  });

  it("shows completion date for completed projects", () => {
    render(
      <ExperienceCard
        experience={sampleExperience({
          projectStatus: "completed",
          startDate: "2026-01-01",
          endDate: "2026-08-17",
        })}
        canManage
        onView={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ongoing")).toBeNull();
    expect(screen.getAllByText("2026-08-17").length).toBeGreaterThan(0);
  });

  it("opens the existing action menu", async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(
      <ExperienceCard
        experience={sampleExperience()}
        canManage
        onView={onView}
        onEdit={vi.fn()}
      />,
    );
    await user.click(
      screen.getAllByRole("button", { name: "Experience actions" })[0]!,
    );
    expect(screen.getByRole("menuitem", { name: /view/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeTruthy();
  });
});
