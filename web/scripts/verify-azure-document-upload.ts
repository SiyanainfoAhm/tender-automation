/**
 * Verifies Tender Automation Azure env naming for Edge Functions.
 * Does not upload (Azure SAS secrets must stay in Edge Function env).
 *
 * Usage: npx tsx scripts/verify-azure-document-upload.ts
 */
import fs from "node:fs";
import path from "node:path";
import { buildCompanyDocumentBlobName } from "../src/lib/storage/blobPath";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

function main() {
  loadEnvFile(path.resolve(import.meta.dirname, "../../supabase/.env.local"));

  const required = [
    "TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_NAME",
    "TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME",
    "TENDER_AUTOMATION_AZURE_STORAGE_SAS_TOKEN",
  ] as const;

  const missing = required.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error(
      "Missing Edge Function secrets in supabase/.env.local:\n" +
        missing.map((k) => `  - ${k}`).join("\n"),
    );
    console.error(
      "\nDo not put these in the Next.js web app. Use:\n" +
        "  supabase secrets set TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_NAME=...\n",
    );
    process.exit(2);
  }

  const accountName =
    process.env.TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_NAME!.trim();
  const containerName =
    process.env.TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME!.trim();

  const exampleBlob = buildCompanyDocumentBlobName({
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Siyana Info Solutions Pvt. Ltd.",
    documentId: "26b4f7fa-xxxx",
    documentName: "ISO 27001 Certificate",
    category: "Certificate",
    fileName: "ISO-27001-Certificate.pdf",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        accountName,
        containerName,
        exampleBlobName: exampleBlob,
        note: "SAS token present (not printed). Upload via Edge Function.",
      },
      null,
      2,
    ),
  );
}

main();
