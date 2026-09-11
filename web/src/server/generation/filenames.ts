export function sanitizeFileNamePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "Document"
  );
}

export function buildGeneratedFileName(options: {
  requirementName: string;
  tenderReference: string;
  versionLabel: string;
}): string {
  const name = sanitizeFileNamePart(options.requirementName);
  const ref = sanitizeFileNamePart(options.tenderReference);
  const version = options.versionLabel.replace(/^v/i, "v");
  return `${name}_${ref}_${version}.docx`;
}

export function nextVersionLabel(existingCount: number): string {
  if (existingCount <= 0) return "v1.0";
  return `v1.${existingCount}`;
}
