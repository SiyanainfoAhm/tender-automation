"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ProposalSectionRow } from "@/lib/bid-workspace";
import { saveProposalSectionAction } from "@/server/actions/bid-workspace";

type ProposalEditorProps = {
  tenderId: string;
  sections: ProposalSectionRow[];
  readOnly: boolean;
};

export function ProposalEditor({
  tenderId,
  sections,
  readOnly,
}: ProposalEditorProps) {
  const router = useRouter();
  const completed = sections.filter((section) => section.status === "complete").length;
  const percent =
    sections.length === 0 ? 0 : Math.round((completed / sections.length) * 100);
  const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(section: ProposalSectionRow) {
    const content = drafts[section.id] ?? section.content;
    setSavingId(section.id);
    try {
      const result = await saveProposalSectionAction({
        tenderId,
        sectionId: section.id,
        content,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Proposal section saved.");
      router.refresh();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
            Technical Proposal
          </h2>
          <p className="mt-1 text-sm text-foreground-600">
            {completed} of {sections.length} sections completed
          </p>
        </div>
        <Button variant="outline" size="sm" disabled title="Coming soon">
          Export PDF
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {sections.map((section, index) => {
          const open = openId === section.id;
          const complete = section.status === "complete";
          return (
            <li key={section.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                onClick={() => setOpenId(open ? null : section.id)}
              >
                <span className="w-5 text-xs font-semibold text-foreground-400">
                  {index + 1}
                </span>
                <span className="flex-1 text-sm font-medium">{section.title}</span>
                {complete ? (
                  <Check className="size-4 text-emerald-600" />
                ) : null}
                <ChevronDown
                  className={cn(
                    "size-4 text-foreground-400 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open ? (
                <div className="space-y-3 border-t border-border px-3 py-3">
                  <Textarea
                    rows={8}
                    disabled={readOnly}
                    value={drafts[section.id] ?? section.content}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [section.id]: event.target.value,
                      }))
                    }
                    placeholder="Write this section. A non-empty section counts as completed."
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={readOnly || savingId === section.id}
                      onClick={() => void save(section)}
                    >
                      {savingId === section.id ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Section"
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
