/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ResendInviteDialog } from "@/components/users/resend-invite-dialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const resendMock = vi.fn();

vi.mock("@/server/actions/team", () => ({
  resendTenderFlowInviteAction: (...args: unknown[]) => resendMock(...args),
}));

function renderDialog() {
  return render(
    <TooltipProvider>
      <ResendInviteDialog userId="user-1" fullName="Rajesh" />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  resendMock.mockReset();
});

describe("ResendInviteDialog", () => {
  it("does not reset the password until the admin confirms", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Resend invitation" }));
    expect(screen.getByText("Resend invitation?")).toBeTruthy();
    expect(resendMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("calls resend once after confirmation and shows loading", async () => {
    const user = userEvent.setup();
    let resolveAction: ((value: { ok: boolean; inviteSent: boolean }) => void)
      | undefined;
    resendMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );

    renderDialog();
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));
    await user.click(screen.getByRole("button", { name: "Resend Invite" }));

    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith("user-1");
    expect(screen.getByText("Sending...")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sending/ })).toHaveProperty(
      "disabled",
      true,
    );

    resolveAction?.({ ok: true, inviteSent: true });
  });
});
