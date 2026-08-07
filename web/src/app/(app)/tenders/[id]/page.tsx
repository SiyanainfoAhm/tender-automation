import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatConfidence,
  formatDate,
  formatEmdAmount,
  formatRelativeTime,
  formatTenderValue,
} from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { getTenderById } from "@/server/repositories/tenderRepository";

type TenderDetailPageProps = {
  params: Promise<{ id: string }>;
};

function str(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export default async function TenderDetailPage({
  params,
}: TenderDetailPageProps) {
  await requireSession();
  const { id } = await params;
  const data = await getTenderById(id);
  if (!data) notFound();

  const { tender, qualification } = data;
  const title = str(tender.title);
  const sourcePortal = tender.source_portal as TenderSource;
  const qualStatus =
    (qualification?.status as QualificationStatus | undefined) ??
    (tender.qualification_status as QualificationStatus | undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1.5">
            <Link href="/tenders">
              <ArrowLeft className="size-4" />
              Back to tenders
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={sourcePortal} />
            {qualStatus ? (
              <StatusBadge status={qualStatus} />
            ) : (
              <Badge variant="outline">Not evaluated</Badge>
            )}
            {tender.download_status ? (
              <Badge variant="outline">{str(tender.download_status)}</Badge>
            ) : null}
            {qualification?.manual_review_required ? (
              <Badge className="bg-status-verify-bg text-status-verify border-status-verify/20">
                Manual review
              </Badge>
            ) : null}
          </div>
          <h1 className="font-heading max-w-4xl text-2xl font-bold leading-tight text-text-primary">
            {title}
          </h1>
          <p className="text-sm text-text-muted">
            {str(tender.organization)}
            {tender.state ? ` · ${str(tender.state)}` : ""}
            {tender.city ? ` · ${str(tender.city)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tender.source_url ? (
            <Button variant="outline" size="sm" asChild>
              <a
                href={str(tender.source_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1.5"
              >
                Source portal
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null}
          {qualification?.chat_url ? (
            <Button variant="outline" size="sm" asChild>
              <a
                href={str(qualification.chat_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1.5"
              >
                Qualification chat
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="prescreen">Pre-screen</TabsTrigger>
          <TabsTrigger value="qualification">Qualification</TabsTrigger>
          <TabsTrigger value="criteria">Criteria</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="metadata">Raw Metadata</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-2">
            <DetailCard title="Key details">
              <DetailGrid
                rows={[
                  ["Tender ID", str(tender.source_tender_id)],
                  ["Category", str(tender.category)],
                  ["Authority", str(tender.authority)],
                  ["Department", str(tender.department)],
                  ["Location", str(tender.location_text)],
                  ["Currency", str(tender.currency ?? "INR")],
                ]}
              />
            </DetailCard>
            <DetailCard title="Dates & values">
              <DetailGrid
                rows={[
                  ["Published", formatDate(tender.published_date as string)],
                  ["Opening", formatDate(tender.opening_date as string)],
                  ["Closing", formatDate(tender.closing_date as string)],
                  ["Bid submission", formatDate(tender.bid_submission_date as string)],
                  [
                    "Tender value",
                    formatTenderValue({
                      amount: tender.tender_value as number | null,
                      text: tender.tender_value_text as string | null,
                    }).label,
                  ],
                  [
                    "EMD",
                    formatEmdAmount({
                      amount: tender.emd_amount as number | null,
                      text: tender.emd_text as string | null,
                    }).label,
                  ],
                ]}
              />
            </DetailCard>
            {tender.description ? (
              <DetailCard title="Description" className="lg:col-span-2">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                  {str(tender.description)}
                </p>
              </DetailCard>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="prescreen">
          <div className="grid gap-6 lg:grid-cols-2">
            <DetailCard title="Pre-screen status">
              <DetailGrid
                rows={[
                  ["Status", str(tender.prescreen_status)],
                  ["Reason code", str(tender.prescreen_reason_code)],
                  ["ChatGPT eligible", tender.chatgpt_eligible == null ? "—" : tender.chatgpt_eligible ? "Yes" : "No"],
                  ["Decision source", str(tender.decision_source)],
                  ["Rules version", str(tender.prescreen_rules_version)],
                  [
                    "Evaluated",
                    tender.prescreened_at
                      ? formatDate(tender.prescreened_at as string)
                      : "—",
                  ],
                ]}
              />
              {tender.prescreen_reason ? (
                <p className="mt-4 text-sm leading-relaxed text-text-secondary">
                  {str(tender.prescreen_reason)}
                </p>
              ) : null}
            </DetailCard>
            <DetailCard title="Scope handling">
              {sourcePortal === "BIDASSIST" ? (
                <div className="space-y-3 text-sm text-text-secondary">
                  <p>
                    <span className="font-medium text-text-primary">
                      Category gate:
                    </span>{" "}
                    Software and IT Solutions filter applied by crawler
                  </p>
                  <p>
                    Scope category was already restricted to Software and IT
                    Solutions during source crawling.
                  </p>
                  <p className="text-text-muted">
                    IT-relevance classification is not re-run for BidAssist
                    tenders.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-text-secondary">
                  <p>
                    Scope relevance was checked during deterministic
                    pre-screening.
                  </p>
                </div>
              )}
            </DetailCard>
          </div>
        </TabsContent>

        <TabsContent value="qualification">
          {qualification ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <DetailCard title="Decision">
                <DetailGrid
                  rows={[
                    ["Status", qualStatus ? <StatusBadge key="s" status={qualStatus} /> : "—"],
                    ["Decision label", str(qualification.decision_label)],
                    ["Verdict", str(qualification.verdict)],
                    ["Confidence", formatConfidence(qualification.confidence as number)],
                    ["Required action", str(qualification.required_action)],
                    [
                      "Qualified at",
                      formatDate(qualification.qualified_at as string),
                    ],
                  ]}
                />
              </DetailCard>
              <DetailCard title="Reasoning">
                <p className="text-sm leading-relaxed text-text-secondary">
                  {str(qualification.reason)}
                </p>
                {qualification.model_name ? (
                  <p className="mt-4 text-xs text-text-muted">
                    Model: {str(qualification.model_name)}
                    {qualification.prompt_version
                      ? ` · Prompt ${str(qualification.prompt_version)}`
                      : ""}
                  </p>
                ) : null}
              </DetailCard>
            </div>
          ) : (
            <EmptyTab message="This tender has not been qualified yet." />
          )}
        </TabsContent>

        <TabsContent value="criteria">
          {qualification ? (
            <div className="grid gap-6 lg:grid-cols-3">
              <CriteriaList
                title="Matched"
                items={jsonArray(qualification.matched_criteria)}
                variant="success"
              />
              <CriteriaList
                title="Failed"
                items={jsonArray(qualification.failed_criteria)}
                variant="error"
              />
              <CriteriaList
                title="Unclear"
                items={jsonArray(qualification.unclear_criteria)}
                variant="warning"
              />
              <CriteriaList
                title="Missing documents"
                items={jsonArray(qualification.missing_documents)}
                variant="neutral"
                className="lg:col-span-3"
              />
            </div>
          ) : (
            <EmptyTab message="No qualification criteria available." />
          )}
        </TabsContent>

        <TabsContent value="conditions">
          {qualification ? (
            <div className="space-y-6">
              <CriteriaList
                title="Conditions"
                items={jsonArray(qualification.conditions)}
                variant="warning"
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <CriteriaList
                  title="Partnership required for"
                  items={jsonArray(qualification.partnership_required_for)}
                  variant="neutral"
                />
                <CriteriaList
                  title="Partnership modes allowed"
                  items={jsonArray(qualification.partnership_mode_allowed)}
                  variant="neutral"
                />
              </div>
            </div>
          ) : (
            <EmptyTab message="No conditions recorded." />
          )}
        </TabsContent>

        <TabsContent value="evidence">
          {qualification ? (
            <CriteriaList
              title="Evidence files"
              items={jsonArray(qualification.evidence_files)}
              variant="neutral"
            />
          ) : (
            <EmptyTab message="No evidence files attached." />
          )}
        </TabsContent>

        <TabsContent value="metadata">
          <div className="space-y-4">
            <CollapsibleJson title="Tender record" data={tender} />
            {qualification ? (
              <CollapsibleJson title="Qualification record" data={qualification} />
            ) : null}
            {qualification?.raw_result ? (
              <CollapsibleJson
                title="Raw AI result"
                data={qualification.raw_result}
              />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <DetailCard title="Timeline">
            <DetailGrid
              rows={[
                ["First seen", formatDate(tender.first_seen_at as string)],
                ["Crawled", formatDate(tender.crawled_at as string)],
                ["Updated", formatDate(tender.updated_at as string)],
                [
                  "Last updated",
                  formatRelativeTime(tender.updated_at as string),
                ],
                [
                  "Qualified",
                  qualification
                    ? formatRelativeTime(qualification.qualified_at as string)
                    : "—",
                ],
              ]}
            />
          </DetailCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DetailGrid({
  rows,
}: {
  rows: [string, React.ReactNode][];
}) {
  return (
    <dl className="space-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="min-w-[140px] text-xs font-medium uppercase tracking-wide text-text-muted">
            {label}
          </dt>
          <dd className="text-sm text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CriteriaList({
  title,
  items,
  variant,
  className,
}: {
  title: string;
  items: unknown[];
  variant: "success" | "error" | "warning" | "neutral";
  className?: string;
}) {
  const colors = {
    success: "border-emerald-200 bg-emerald-50/50",
    error: "border-red-200 bg-red-50/50",
    warning: "border-amber-200 bg-amber-50/50",
    neutral: "border-border bg-surface-muted/50",
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {title}{" "}
          <span className="text-sm font-normal text-text-muted">
            ({items.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">None</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li
                key={i}
                className={`rounded-[10px] border p-3 text-sm ${colors[variant]}`}
              >
                {typeof item === "string" ? (
                  item
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
                    {JSON.stringify(item, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CollapsibleJson({
  title,
  data,
}: {
  title: string;
  data: unknown;
}) {
  const sanitized = sanitizeForDisplay(data);

  return (
    <details className="group rounded-[14px] border border-border bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-text-primary marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between">
          {title}
          <span className="text-xs text-text-muted group-open:hidden">
            Click to expand
          </span>
        </span>
      </summary>
      <Separator />
      <pre className="max-h-[480px] overflow-auto p-4 font-mono text-xs text-text-secondary">
        {JSON.stringify(sanitized, null, 2)}
      </pre>
    </details>
  );
}

function sanitizeForDisplay(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(sanitizeForDisplay);
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === "password_hash" || key === "token_hash") continue;
      out[key] = sanitizeForDisplay(value);
    }
    return out;
  }
  return data;
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border py-12 text-center">
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}
