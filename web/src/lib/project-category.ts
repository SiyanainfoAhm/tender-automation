/**
 * TenderFlow project category — type of IT project, never raw title/scope.
 */

export const PROJECT_CATEGORIES = [
  "Website / Web Portal",
  "Mobile App",
  "Web + Mobile App",
  "ERP / CRM / HRMS",
  "Cloud System / SaaS",
  "Custom Software",
  "API / System Integration",
  "AI / Automation",
  "GIS / Mapping",
  "Cybersecurity",
  "IT Infrastructure",
  "Support / AMC / Maintenance",
  "Manpower / Resource Hiring",
  "Software License / Subscription",
  "Other",
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

const WEB_RE =
  /website|web\s*site|web\s*portal|web-portal|e-?portal|\bportals?\b|web\s*application|web\s*app|\bcms\b|web\s*development|web\s*design|website\s*re-?design|\bdashboard\b/i;
const MOBILE_RE = /android|\bios\b|mobile\s*app(?:lication)?s?/i;
const MANPOWER_RE =
  /\bhiring of professionals?\b|\bmanpower\b|resource augmentation|resource hiring|developer hiring|procurement of resources\b/i;
const LICENSE_RE =
  /\blicen[cs]e renew|\bsubscription\b|software licen[cs]e|database licen[cs]e|\blicen[cs]es?\b/i;
const CYBER_RE =
  /cyber\s*security|cybersecurity|\bvapt\b|penetration\s*test|\bpentest\b|\bsoc\b|security\s*audit|red\s*team|anti-?phish|anti-?pharm|darknet|threat\s*intelligence|vulnerability(?:\s+and)?\s+penetration|\bedr\b|endpoint\s*detection/i;
const GIS_RE = /\bgis\b|geospatial|geo-spatial|\bmapping\b/i;
const AI_RE =
  /(?:^|[^a-z])ai(?:[^a-z]|$)|chat\s*bots?|machine\s*learning|\bml\b|generative\s*ai|\brpa\b|robotic\s*process|process\s*automation|workflow\s*automation/i;
const ERP_RE = /\berp\b|\bcrm\b|\bhrms\b|payroll|enterprise\s*management/i;
const CLOUD_RE =
  /\bsaas\b|cloud\s*platform|cloud-native|cloud\s*native|hosted\s*application|cloud-based|cloud\s*based|cloud\s*computing/i;
const INTEGRATION_RE =
  /system\s*integration|api\s*integration|third[-\s]party\s*integration|api\s*development/i;
const SUPPORT_RE =
  /\bamc\b|\bcmc\b|amccmc|annual\s*maintenance|application\s*support|support\s*services|maintenance\s*services|software\s*support|facility\s*management|\bfms\b|technical\s*(?:function\s*)?support/i;
const INFRA_RE =
  /data\s*cent(?:er|re)|network(?:ing)?|\blan\b|\bwan\b|ethernet|connectivity|hardware\s*infra|\bservers?\b|structured\s*cabling|internet\s*sharing|air\s*fib(?:re|er)/i;
const WEBSITE_RE =
  /website|web\s*portal|e-?portal|\bportals?\b|web\s*application|web\s*app|\bcms\b|web\s*development|web\s*design/i;
const CUSTOM_RE =
  /custom\s*software|custom\s*application|software\s*redevelopment|bespoke\s*software|software\s*development|application\s*development/i;

export function isProjectCategory(value: string | null | undefined): value is ProjectCategory {
  return Boolean(value && (PROJECT_CATEGORIES as readonly string[]).includes(value));
}

export function classifyProjectCategory(input: {
  title?: string | null;
  description?: string | null;
  sourceCategory?: string | null;
}): ProjectCategory {
  const text = [input.title, input.description, input.sourceCategory]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Other";

  if (WEB_RE.test(text) && MOBILE_RE.test(text)) return "Web + Mobile App";
  if (MANPOWER_RE.test(text)) return "Manpower / Resource Hiring";
  if (LICENSE_RE.test(text)) return "Software License / Subscription";
  if (CYBER_RE.test(text)) return "Cybersecurity";
  if (GIS_RE.test(text)) return "GIS / Mapping";
  if (AI_RE.test(text)) return "AI / Automation";
  if (ERP_RE.test(text)) return "ERP / CRM / HRMS";
  if (CLOUD_RE.test(text)) return "Cloud System / SaaS";
  if (INTEGRATION_RE.test(text)) return "API / System Integration";
  if (SUPPORT_RE.test(text)) return "Support / AMC / Maintenance";
  if (INFRA_RE.test(text)) return "IT Infrastructure";
  if (WEBSITE_RE.test(text)) return "Website / Web Portal";
  if (MOBILE_RE.test(text)) return "Mobile App";
  if (CUSTOM_RE.test(text)) return "Custom Software";
  return "Other";
}

export function resolveProjectCategory(options: {
  projectCategory?: string | null;
  title?: string | null;
  description?: string | null;
  sourceCategory?: string | null;
}): ProjectCategory {
  if (isProjectCategory(options.projectCategory)) {
    return options.projectCategory;
  }
  return classifyProjectCategory({
    title: options.title,
    description: options.description,
    sourceCategory: options.sourceCategory,
  });
}
