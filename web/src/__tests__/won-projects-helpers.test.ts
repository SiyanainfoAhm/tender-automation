import { describe, expect, it } from "vitest";

import {
  derivePaymentStatus,
  deriveProjectHealth,
  paymentOutstandingBalance,
} from "@/lib/won-projects";

describe("derivePaymentStatus", () => {
  const today = "2026-09-14";

  it("returns cancelled when explicitly cancelled", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 0,
        dueDate: "2026-09-01",
        explicitStatus: "cancelled",
        today,
      }),
    ).toBe("cancelled");
  });

  it("returns received when fully paid", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 1000,
        dueDate: "2026-09-01",
        today,
      }),
    ).toBe("received");
  });

  it("returns partially_received before due date", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 400,
        dueDate: "2026-09-20",
        today,
      }),
    ).toBe("partially_received");
  });

  it("returns overdue for partial payment past due date", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 400,
        dueDate: "2026-09-01",
        today,
      }),
    ).toBe("overdue");
  });

  it("returns overdue for unpaid past due date", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 0,
        dueDate: "2026-09-01",
        today,
      }),
    ).toBe("overdue");
  });

  it("returns pending for unpaid before due date", () => {
    expect(
      derivePaymentStatus({
        amount: 1000,
        receivedAmount: 0,
        dueDate: "2026-09-20",
        today,
      }),
    ).toBe("pending");
  });
});

describe("paymentOutstandingBalance", () => {
  it("returns zero for cancelled payments", () => {
    expect(
      paymentOutstandingBalance({
        amount: 1000,
        receivedAmount: 200,
        status: "cancelled",
      }),
    ).toBe(0);
  });

  it("returns remaining balance", () => {
    expect(
      paymentOutstandingBalance({
        amount: 1000,
        receivedAmount: 350,
      }),
    ).toBe(650);
  });

  it("never returns negative balance", () => {
    expect(
      paymentOutstandingBalance({
        amount: 1000,
        receivedAmount: 1200,
      }),
    ).toBe(0);
  });
});

describe("deriveProjectHealth", () => {
  const today = "2026-09-14";

  it("returns completed when execution status is completed", () => {
    expect(
      deriveProjectHealth({
        executionStatus: "completed",
        milestones: [],
        payments: [],
        today,
      }),
    ).toBe("completed");
  });

  it("returns payment_overdue when an overdue payment has balance", () => {
    expect(
      deriveProjectHealth({
        executionStatus: "in_execution",
        milestones: [],
        payments: [
          {
            amount: 1000,
            receivedAmount: 0,
            dueDate: "2026-09-01",
          },
        ],
        today,
      }),
    ).toBe("payment_overdue");
  });

  it("returns delayed when a milestone is past due and not completed", () => {
    expect(
      deriveProjectHealth({
        executionStatus: "in_execution",
        milestones: [
          {
            status: "in_progress",
            dueDate: "2026-09-01",
          },
        ],
        payments: [],
        today,
      }),
    ).toBe("delayed");
  });

  it("returns on_track when milestones and payments are healthy", () => {
    expect(
      deriveProjectHealth({
        executionStatus: "in_execution",
        milestones: [
          {
            status: "in_progress",
            dueDate: "2026-09-20",
          },
        ],
        payments: [
          {
            amount: 1000,
            receivedAmount: 1000,
            dueDate: "2026-09-01",
          },
        ],
        today,
      }),
    ).toBe("on_track");
  });
});
