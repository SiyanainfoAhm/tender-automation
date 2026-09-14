/**
 * TF-59 – Upcoming Deadlines eligibility.
 * Will Bid = GO, May Bid = CONDITIONAL_GO; due date must not have passed.
 */
export function isUpcomingDeadlineStatus(
  qualificationStatus: string | null | undefined,
): boolean {
  return (
    qualificationStatus === "GO" ||
    qualificationStatus === "CONDITIONAL_GO"
  );
}

export function isUpcomingDeadlineDue(
  daysLeft: number,
  maxHorizonDays = 45,
): boolean {
  return daysLeft >= 0 && daysLeft <= maxHorizonDays;
}
