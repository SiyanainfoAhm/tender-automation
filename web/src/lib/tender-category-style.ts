/**
 * Pastel capsule colors for normalized project categories.
 */
import type { ProjectCategory } from "@/lib/project-category";
import { isProjectCategory } from "@/lib/project-category";

const PROJECT_CATEGORY_STYLES: Record<ProjectCategory, string> = {
  "Website / Web Portal": "bg-sky-100 text-sky-800",
  "Mobile App": "bg-violet-100 text-violet-800",
  "Web + Mobile App": "bg-indigo-100 text-indigo-800",
  "ERP / CRM / HRMS": "bg-orange-100 text-orange-800",
  "Cloud System / SaaS": "bg-teal-100 text-teal-800",
  "Custom Software": "bg-sky-100 text-sky-800",
  "API / System Integration": "bg-violet-100 text-violet-800",
  "AI / Automation": "bg-purple-100 text-purple-800",
  "GIS / Mapping": "bg-emerald-100 text-emerald-800",
  Cybersecurity: "bg-rose-100 text-rose-800",
  "IT Infrastructure": "bg-orange-100 text-orange-800",
  "Support / AMC / Maintenance": "bg-amber-100 text-amber-800",
  "Manpower / Resource Hiring": "bg-teal-100 text-teal-800",
  "Software License / Subscription": "bg-amber-100 text-amber-800",
  Other: "bg-background-200 text-foreground-600",
};

export function categoryCapsuleClass(label: string | null | undefined): string {
  if (isProjectCategory(label)) {
    return PROJECT_CATEGORY_STYLES[label];
  }
  return "bg-background-200 text-foreground-600";
}
