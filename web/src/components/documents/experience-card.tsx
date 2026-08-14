"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

type ExperienceCardProps = {
  experience: CompanyExperience;
  canManage: boolean;
  onView: (item: CompanyExperience) => void;
  onEdit: (item: CompanyExperience) => void;
};

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

  return (
    <Card className="transition-all hover:border-primary-300/40">
      <CardContent className="relative p-5 pt-5 sm:p-5 sm:pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 pr-8">
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
            <p className="text-sm text-foreground-600">
              {experience.clientName}
            </p>
            {experience.description ? (
              <p className="mt-2 line-clamp-2 text-xs text-foreground-400">
                {experience.description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-4 text-right">
            <div>
              <p className="text-sm font-semibold text-foreground-800">
                {formatIndianCurrency(experience.projectValueInr)}
              </p>
              <p className="text-xs text-foreground-400">Project Value</p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground-700">
                {duration}
              </p>
              <p className="text-xs text-foreground-400">Duration</p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground-700">
                {isOngoing
                  ? "Ongoing"
                  : formatDate(experience.endDate, "yyyy-MM-dd")}
              </p>
              <p className="text-xs text-foreground-400">
                {isOngoing ? "In Progress" : "Completed"}
              </p>
            </div>
          </div>
        </div>

        <div className="absolute right-3 top-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-foreground-400 hover:text-foreground-700"
                aria-label="Experience actions"
                disabled={pending}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => onView(experience)}>
                <Eye className="size-4" />
                View
              </DropdownMenuItem>
              {canManage ? (
                <DropdownMenuItem onSelect={() => onEdit(experience)}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-status-nogo"
                    onSelect={handleDelete}
                    disabled={pending}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
