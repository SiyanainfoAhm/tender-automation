export const NATURE_OF_WORK_OPTIONS = [
  "Software Development",
  "Web Application",
  "Website Development",
  "Mobile Application",
  "ERP / HRMS",
  "AI / Automation",
  "Cloud Services",
  "IT Infrastructure",
  "Cybersecurity",
  "System Integration",
  "GIS",
  "Data Center / Infrastructure",
  "Other",
] as const;

export type NatureOfWork = (typeof NATURE_OF_WORK_OPTIONS)[number];

export function isNatureOfWork(value: string): value is NatureOfWork {
  return (NATURE_OF_WORK_OPTIONS as readonly string[]).includes(value);
}
