import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import { formatConfidence, formatDate } from "@/lib/format";
import type { TenderDetailDTO } from "@/lib/tender-detail";
import { cn } from "@/lib/utils";

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function itemText(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return String(
      record.condition ||
        record.name ||
        record.criterion ||
        record.title ||
        record.description ||
        JSON.stringify(item),
    );
  }
  return String(item);
}

export function CriteriaList({
  title,
  items,
  variant,
}: {
  title: string;
  items: unknown[];
  variant: "success" | "error" | "warning" | "neutral";
}) {
  const colors = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    neutral: "border-border bg-background-50 text-foreground-800",
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground-900">
        {title}{" "}
        <span className="font-normal text-foreground-500">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-foreground-500">None</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={index}
              className={cn("rounded-md border px-3 py-2 text-sm", colors[variant])}
            >
              {itemText(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CollapsibleJson({
  title,
  data,
}: {
  title: string;
  data: unknown;
}) {
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground-900">
        {title}
      </summary>
      <pre className="max-h-[420px] overflow-auto border-t border-border p-4 font-mono text-xs text-foreground-700">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

export function TenderAnalyzerPanels({
  tender,
  compact = false,
}: {
  tender: TenderDetailDTO;
  compact?: boolean;
}) {
  const qualification = tender.qualification;
  const requirements = tender.extractedRequirements;
  const matched = requirements.filter((item) => item.group === "matched").length;
  const failed = requirements.filter((item) => item.group === "failed").length;
  const unclear = requirements.filter((item) => item.group === "unclear").length;
  const missing = requirements.filter((item) => item.group === "missing").length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground-900">
              Qualification overview
            </h2>
            <p className="mt-1 text-xs text-foreground-500">
              Stored AI result
              {qualification?.qualifiedAt
                ? ` · Last analyzed ${formatDate(qualification.qualifiedAt)}`
                : " · Not analyzed yet"}
            </p>
          </div>
          {compact ? (
            <Link
              href={`/tenders/${tender.id}/analyze`}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              Open full analysis
            </Link>
          ) : null}
        </div>

        {qualification ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-foreground-500">Status</p>
              <div className="mt-1">
                <StatusBadge status={qualification.status} size="sm" />
              </div>
            </div>
            <div>
              <p className="text-xs text-foreground-500">Confidence</p>
              <p className="mt-1 text-sm font-semibold">
                {formatConfidence(qualification.confidence)}
              </p>
            </div>
            <div>
              <p className="text-xs text-foreground-500">Required action</p>
              <p className="mt-1 text-sm font-semibold">
                {qualification.requiredAction || "—"}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-foreground-500">
            Analysis unavailable. This tender has not been qualified yet.
          </p>
        )}

        {qualification?.reason ? (
          <p className="mt-4 text-sm leading-relaxed text-foreground-700">
            {qualification.reason}
          </p>
        ) : null}
        {qualification?.chatUrl ? (
          <a
            href={qualification.chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
          >
            Qualification chat <ExternalLink className="size-3" />
          </a>
        ) : null}
      </section>

      {requirements.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
            Extracted requirements ({requirements.length})
          </h2>
          <p className="mt-1 text-xs text-foreground-500">
            {matched} matched · {failed} failed · {unclear} unclear · {missing}{" "}
            missing documents
          </p>
          <ul className="mt-4 space-y-3">
            {requirements.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-border px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground-900">
                    {item.name}
                  </p>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      item.matched === true
                        ? "bg-emerald-50 text-emerald-700"
                        : item.matched === false
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700",
                    )}
                  >
                    {item.matched === true
                      ? "Credential matched"
                      : item.matched === false
                        ? "Not matched"
                        : "Unclear"}
                  </span>
                </div>
                {item.description !== item.name ? (
                  <p className="mt-1 text-xs text-foreground-500">
                    {item.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground-900">
            Pre-screen
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-500">Status</dt>
              <dd className="font-medium">{tender.prescreenStatus || "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-500">Reason code</dt>
              <dd className="font-medium">{tender.prescreenReasonCode || "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-500">ChatGPT eligible</dt>
              <dd className="font-medium">
                {tender.chatgptEligible == null
                  ? "—"
                  : tender.chatgptEligible
                    ? "Yes"
                    : "No"}
              </dd>
            </div>
          </dl>
          {tender.prescreenReason ? (
            <p className="mt-3 text-sm text-foreground-600">
              {tender.prescreenReason}
            </p>
          ) : null}
        </section>
        <CriteriaList
          title="Conditions"
          items={jsonArray(qualification?.conditions)}
          variant="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <CriteriaList
          title="Matched"
          items={jsonArray(qualification?.matchedCriteria)}
          variant="success"
        />
        <CriteriaList
          title="Failed"
          items={jsonArray(qualification?.failedCriteria)}
          variant="error"
        />
        <CriteriaList
          title="Unclear"
          items={jsonArray(qualification?.unclearCriteria)}
          variant="warning"
        />
      </div>

      <CriteriaList
        title="Missing documents"
        items={jsonArray(qualification?.missingDocuments)}
        variant="neutral"
      />

      {!compact ? (
        <div className="space-y-3">
          <CollapsibleJson title="Tender record (safe fields)" data={{
            id: tender.id,
            title: tender.title,
            sourcePortal: tender.sourcePortal,
            sourceTenderId: tender.sourceTenderId,
            projectCategory: tender.projectCategory,
            qualificationStatus: tender.qualificationStatus,
          }} />
          {qualification ? (
            <CollapsibleJson title="Qualification record" data={qualification} />
          ) : null}
          {qualification?.rawResult ? (
            <CollapsibleJson title="Raw AI result" data={qualification.rawResult} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AnalyzeRfpExtract({ tender }: { tender: TenderDetailDTO }) {
  const qualification = tender.qualification;
  const sections = [
    {
      title: "Summary",
      body: qualification?.reason || qualification?.verdict || tender.description,
    },
    {
      title: "Key dates",
      body: [
        `Published: ${formatDate(tender.publishedDate)}`,
        `Deadline: ${formatDate(tender.closingDate)}`,
        `Opening: ${formatDate(tender.openingDate)}`,
      ].join("\n"),
    },
    {
      title: "Scope",
      body: tender.scopeText,
    },
    {
      title: "Eligibility criteria",
      body:
        jsonArray(qualification?.matchedCriteria)
          .concat(jsonArray(qualification?.failedCriteria))
          .map(itemText)
          .join("\n") || null,
    },
    {
      title: "Technical evaluation",
      body:
        jsonArray(qualification?.unclearCriteria).map(itemText).join("\n") ||
        qualification?.requiredAction,
    },
    {
      title: "Payment terms",
      body: null,
    },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground-900">
        RFP Document Analysis
      </h2>
      <p className="mt-1 text-xs text-foreground-500">
        Extracted from stored qualification and tender metadata. AI is not
        re-run when you open this page.
      </p>
      <div className="mt-4 space-y-2">
        {sections.map((section) => (
          <details
            key={section.title}
            className="rounded-md border border-border"
            open={section.title === "Summary"}
          >
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {section.title}
            </summary>
            <div className="border-t border-border px-3 py-3 text-sm whitespace-pre-wrap text-foreground-700">
              {section.body?.trim()
                ? section.body
                : "Not extracted."}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
