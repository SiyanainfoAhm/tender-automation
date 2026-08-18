"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  experienceDurationMonths,
  formatDurationMonths,
} from "@/lib/experience/duration";
import type { CompanyExperience } from "@/lib/experience/types";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import { deleteCompanyExperienceAction } from "@/server/actions/experience";
import { cn } from "@/lib/utils";

function ExperienceActionsMenu({
  pending,
  canManage,
  onView,
  onEdit,
  onDelete,
}: {
  pending: boolean;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Experience actions"
          disabled={pending}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-white text-text-muted transition-colors",
            "hover:bg-surface-secondary hover:text-text-primary",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 w-40">
        <DropdownMenuItem onSelect={onView}>
          <Eye className="size-4" />
          View
        </DropdownMenuItem>
        {canManage ? (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-status-nogo"
              onSelect={onDelete}
              disabled={pending}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ExperienceCardProps = {
  experience: CompanyExperience;
  canManage: boolean;
  onView: (item: CompanyExperience) => void;
  onEdit: (item: CompanyExperience) => void;
};

function Metric({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-sm font-semibold text-foreground-800">{value}</p>
      <p className="text-xs text-foreground-400">{label}</p>
    </div>
  );
}

export function ExperienceCard({
  experience,
  canManage,
  onView,
  onEdit,
}: ExperienceCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const duration = formatDurationMonths(experienceDurationMonths(experience));
  const isOngoing = experience.projectStatus === "ongoing";
  const statusValue = isOngoing
    ? "Ongoing"
    : formatDate(experience.endDate, "yyyy-MM-dd");
  const statusLabel = isOngoing ? "Status" : "Completed";

  function handleDelete() {
    if (
      !window.confirm(
        `Delete “${experience.projectName}”? Supporting documents will be removed from storage.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteCompanyExperienceAction(experience.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Experience deleted.");
      router.refresh();
    });
  }

  const actionMenu = (
    <ExperienceActionsMenu
      pending={pending}
      canManage={canManage}
      onView={() => onView(experience)}
      onEdit={() => onEdit(experience)}
      onDelete={handleDelete}
    />
  );

  const desktopMetrics = (
    <>
      <Metric
        className="w-[5.5rem] text-right"
        value={formatIndianCurrency(experience.projectValueInr)}
        label="Project Value"
      />
      <Metric className="w-[5.5rem] text-right" value={duration} label="Duration" />
      <Metric className="w-[6.75rem] text-right" value={statusValue} label={statusLabel} />
    </>
  );

  return (
    <Card className="transition-all hover:border-primary-300/40">
      <CardContent className="p-5 sm:p-5 sm:pt-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground-900">
                    {experience.projectName}
                  </h3>
                  {experience.natureOfWork ? (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                      {experience.natureOfWork}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-foreground-600">{experience.clientName}</p>
              </div>
              <div className="shrink-0 sm:hidden">{actionMenu}</div>
            </div>
            {experience.description ? (
              <p className="mt-2 line-clamp-2 text-xs text-foreground-400">
                {experience.description}
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-3 gap-3 sm:hidden">
              <Metric
                value={formatIndianCurrency(experience.projectValueInr)}
                label="Project Value"
              />
              <Metric value={duration} label="Duration" />
              <Metric value={statusValue} label={statusLabel} />
            </div>
          </div>

          <div className="hidden shrink-0 items-start gap-3 sm:flex">
            {desktopMetrics}
            {actionMenu}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
