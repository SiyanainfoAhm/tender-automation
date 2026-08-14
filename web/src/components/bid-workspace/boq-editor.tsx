"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BOQ_CATEGORIES,
  BOQ_UOMS,
  lineGst,
  lineSubtotal,
  lineTotal,
} from "@/lib/bid-workspace";
import { formatIndianCurrency } from "@/lib/format";
import {
  deleteBoqItemAction,
  saveBoqItemAction,
} from "@/server/actions/bid-workspace";
import type { BoqItemRow } from "@/lib/bid-workspace";

type BoqEditorProps = {
  tenderId: string;
  items: BoqItemRow[];
  readOnly: boolean;
};

type Draft = {
  itemId?: string;
  description: string;
  category: string;
  uom: string;
  quantity: string;
  unitRate: string;
  gstPercent: string;
  notes: string;
};

const EMPTY: Draft = {
  description: "",
  category: "Services",
  uom: "Nos",
  quantity: "1",
  unitRate: "",
  gstPercent: "18",
  notes: "",
};

export function BoqEditor({ tenderId, items, readOnly }: BoqEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visible =
    filter === "All" ? items : items.filter((item) => item.category === filter);

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, item) => sum + lineSubtotal(item.quantity, item.unitRate),
      0,
    );
    const gst = items.reduce(
      (sum, item) => sum + lineGst(item.quantity, item.unitRate, item.gstPercent),
      0,
    );
    return { subtotal, gst, grand: subtotal + gst };
  }, [items]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.category, (map.get(item.category) || 0) + 1);
    }
    return map;
  }, [items]);

  function openCreate() {
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(item: BoqItemRow) {
    setDraft({
      itemId: item.id,
      description: item.description,
      category: item.category,
      uom: item.uom,
      quantity: String(item.quantity),
      unitRate: String(item.unitRate),
      gstPercent: String(item.gstPercent),
      notes: item.notes || "",
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveBoqItemAction({
        tenderId,
        itemId: draft.itemId,
        description: draft.description,
        category: draft.category,
        uom: draft.uom,
        quantity: draft.quantity,
        unitRate: draft.unitRate,
        gstPercent: draft.gstPercent,
        notes: draft.notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.itemId ? "BOQ line updated." : "BOQ line added.");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: BoqItemRow) {
    if (!window.confirm(`Delete “${item.description}”?`)) return;
    setDeletingId(item.id);
    try {
      const result = await deleteBoqItemAction({
        tenderId,
        itemId: item.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("BOQ line deleted.");
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-400">
            Bill of Quantities (BOQ)
          </h2>
          <p className="mt-1 text-sm text-foreground-600">
            {items.length} line item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={openCreate}
            disabled={readOnly}
          >
            <Plus className="size-4" />
            Add Line
          </Button>
          <Button variant="outline" size="sm" disabled title="Coming soon">
            Export
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {["All", ...BOQ_CATEGORIES].map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setFilter(category)}
            className={
              filter === category
                ? "rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white"
                : "rounded-full border border-border bg-white px-2.5 py-1 text-[11px] text-foreground-600"
            }
          >
            {category}
            {category !== "All" && categoryCounts.get(category)
              ? ` ${categoryCounts.get(category)}`
              : ""}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="text-xs text-foreground-500">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">S.No</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">UOM</th>
              <th className="py-2 pr-3 font-medium">Qty</th>
              <th className="py-2 pr-3 font-medium">Unit Rate</th>
              <th className="py-2 pr-3 font-medium">GST</th>
              <th className="py-2 pr-3 font-medium">Total</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-foreground-500">
                  No BOQ lines yet.
                </td>
              </tr>
            ) : (
              visible.map((item, index) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="py-2 pr-3 text-foreground-500">{index + 1}</td>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{item.description}</p>
                    <p className="text-[11px] text-foreground-400">{item.category}</p>
                  </td>
                  <td className="py-2 pr-3">{item.uom}</td>
                  <td className="py-2 pr-3">{item.quantity}</td>
                  <td className="py-2 pr-3">
                    {formatIndianCurrency(item.unitRate)}
                  </td>
                  <td className="py-2 pr-3">{item.gstPercent}%</td>
                  <td className="py-2 pr-3 font-semibold">
                    {formatIndianCurrency(
                      lineTotal(item.quantity, item.unitRate, item.gstPercent),
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={readOnly}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={readOnly || deletingId === item.id}
                        onClick={() => void remove(item)}
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-foreground-500">Sub Total</span>
          <span className="font-semibold">{formatIndianCurrency(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground-500">Total GST</span>
          <span className="font-semibold">{formatIndianCurrency(totals.gst)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2">
          <span className="font-semibold">Grand Total</span>
          <span className="font-semibold">{formatIndianCurrency(totals.grand)}</span>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.itemId ? "Edit line" : "Add line"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select
                  value={draft.category}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, category: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOQ_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>UOM *</Label>
                <Select
                  value={draft.uom}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, uom: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOQ_UOMS.map((uom) => (
                      <SelectItem key={uom} value={uom}>
                        {uom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.quantity}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, quantity: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Rate *</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.unitRate}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, unitRate: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>GST %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.gstPercent}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, gstPercent: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={draft.notes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
