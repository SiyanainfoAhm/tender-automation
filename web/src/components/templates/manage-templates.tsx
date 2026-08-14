"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { BidProfileTemplateDialog } from "@/components/templates/bid-profile-template-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import type { BidProfileTemplate } from "@/lib/templates/types";
import {
  deleteBidProfileTemplateAction,
  duplicateBidProfileTemplateAction,
  setDefaultBidProfileTemplateAction,
} from "@/server/actions/templates";

type ManageTemplatesProps = {
  templates: BidProfileTemplate[];
  canManage: boolean;
  companyName: string;
  companyAddress: string;
};

export function ManageTemplates({
  templates,
  canManage,
  companyName,
  companyAddress,
}: ManageTemplatesProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [selected, setSelected] = useState<BidProfileTemplate | null>(null);

  function openCreate() {
    setMode("create");
    setSelected(null);
    setDialogOpen(true);
  }

  function openEdit(template: BidProfileTemplate) {
    setMode("edit");
    setSelected(template);
    setDialogOpen(true);
  }

  function runAction(
    fn: (id: string) => Promise<{ error?: string; ok?: boolean }>,
    id: string,
    success: string,
  ) {
    startTransition(async () => {
      const result = await fn(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text-primary">
          Manage Templates
        </h2>
        {canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            Create Template
          </Button>
        ) : null}
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No bid profile templates yet."
          description="Create a reusable template to speed up bid preparation."
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                Create Template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60">
                  {[
                    "Template Name",
                    "Description",
                    "Department",
                    "Reference Number",
                    "Default",
                    "Updated",
                    "Actions",
                  ].map((header) => (
                    <th
                      key={header}
                      className="px-3 py-2.5 text-left text-xs font-semibold text-text-muted"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr
                    key={template.id}
                    className="border-b border-border last:border-0 hover:bg-surface-muted/40"
                  >
                    <td className="px-3 py-2.5 font-medium text-text-primary">
                      {template.templateName}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-text-muted">
                      {template.description || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {template.departmentName}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {template.referenceNumber || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {template.isDefault ? (
                        <Badge variant="success">Default</Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted">
                      {formatDate(template.updatedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={pending}
                              aria-label="Template actions"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => openEdit(template)}
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </DropdownMenuItem>
                            {!template.isDefault ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  runAction(
                                    setDefaultBidProfileTemplateAction,
                                    template.id,
                                    "Default template updated.",
                                  )
                                }
                              >
                                <Star className="size-3.5" />
                                Set Default
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() =>
                                runAction(
                                  duplicateBidProfileTemplateAction,
                                  template.id,
                                  "Template duplicated.",
                                )
                              }
                            >
                              <Copy className="size-3.5" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    "Delete template?\n\nThis template will no longer be available for bid preparation.",
                                  )
                                ) {
                                  return;
                                }
                                runAction(
                                  deleteBidProfileTemplateAction,
                                  template.id,
                                  "Template deleted.",
                                );
                              }}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BidProfileTemplateDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelected(null);
        }}
        mode={mode}
        template={selected}
        companyName={companyName}
        companyAddress={companyAddress}
      />
    </div>
  );
}
