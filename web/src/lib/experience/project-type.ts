export const PROJECT_TYPE_OPTIONS = [
  "Private",
  "Central Government",
  "State Government",
  "PSU",
  "Autonomous Body",
  "Public–Private Partnership (PPP)",
  "Co-operative Society",
  "NGO / Non-Profit Organisation",
  "Local Body / Municipal Body",
  "Educational Institution",
  "Other",
] as const;

export type ProjectType = (typeof PROJECT_TYPE_OPTIONS)[number];

export function isProjectType(value: string): value is ProjectType {
  return (PROJECT_TYPE_OPTIONS as readonly string[]).includes(value);
}
