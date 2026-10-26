"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Building2, Loader2, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";

import { checklistWorkCategory, WORK_CATEGORIES } from "@/lib/will-bid";
import { changeChecklistWorkCategoryAction, type ChecklistWorkCategory } from "@/server/actions/checklist-work-category";
import type { ChecklistItemRow } from "@/server/repositories/bidChecklistRepository";

const ICONS = {
  company: Building2,
  ai: Sparkles,
  manual: UserRound,
} as const;

export function ChecklistCategoryManager({
  tenderId,
  items,
}: {
  tenderId: string;
  items: ChecklistItemRow[];
}) {
  const [rows, setRows] = useState(items);
  const [savingId, setSavingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    return WORK_CATEGORIES.reduce<Record<string, number>>((acc, category) => {
      acc[category.key] = rows.filter((item) => checklistWorkCategory(item) === category.key).length;
      return acc;
    }, {});
  }, [rows]);

  async function move(item: ChecklistItemRow, category: ChecklistWorkCategory) {
    const current = checklistWorkCategory(item);
    if (current === category || savingId) return;

    setSavingId(item.id);
    const previous = rows;
    setRows((existing) =>
      existing.map((row) =>
        row.id === item.id
          ? {
              ...row,
              processingType:
                category === "company"
                  ? "COMPANY_DOC"
                  : category === "ai"
                    ? "AI_DRAFT"
                    : "MANUAL_ENTRY",
              generationAllowed: category === "ai",
            }
          : row,
      ),
    );

    try {
      const result = await changeChecklistWorkCategoryAction({
        tenderId,
        itemId: item.id,
        category,
      });
      if (!result.ok) {
        setRows(previous);
        toast.error(result.error);
        return;
      }
      const label = WORK_CATEGORIES.find((entry) => entry.key === category)?.label || category;
      toast.success(`Moved to ${label}.`);
    } catch (error) {
      setRows(previous);
      toast.error(error instanceof Error ? error.message : "Unable to move requirement.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {WORK_CATEGORIES.map((category) => {
          const Icon = ICONS[category.key];
          return (
            <div key={category.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{category.label}</p>
                  <p className="text-xs text-slate-500">{counts[category.key] || 0} requirements</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Organize checklist</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Move requirements between Company Docs, AI Draft, and Manual. Linked files and completion status are preserved.
            </p>
          </div>
          <ArrowLeftRight className="size-4 text-slate-400" />
        </div>

        <div className="divide-y divide-slate-100">
          {rows.map((item) => {
            const current = checklistWorkCategory(item) as ChecklistWorkCategory;
            const busy = savingId === item.id;
            return (
              <div key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{item.requirementName}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                    {item.description || item.sourceText || "No additional details."}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span>{item.isCompleted ? "Completed" : "Pending"}</span>
                    {item.documents.length > 0 ? <span>· {item.documents.length} linked document{item.documents.length === 1 ? "" : "s"}</span> : null}
                  </div>
                </div>

                <div className="relative">
                  <select
                    value={current}
                    disabled={busy}
                    onChange={(event) => void move(item, event.target.value as ChecklistWorkCategory)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-700 outline-none hover:border-slate-300 focus:border-emerald-400 disabled:opacity-60"
                    aria-label={`Move ${item.requirementName}`}
                  >
                    {WORK_CATEGORIES.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                  {busy ? (
                    <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
