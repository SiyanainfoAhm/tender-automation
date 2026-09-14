"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Building2, Check, Plus } from "lucide-react";
import { toast } from "sonner";

import { switchCompanyAction } from "@/server/actions/company-workspace";
import { companyRoleLabel } from "@/lib/company/types";
import type { UserRole } from "@/lib/validations";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type CompanySwitcherItem = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

export function CompanySwitcherMenuItems({
  companies,
}: {
  companies: CompanySwitcherItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSwitch(companyId: string, alreadyActive: boolean) {
    if (alreadyActive || pending) return;
    startTransition(async () => {
      const result = await switchCompanyAction(companyId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Switched company");
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Switch company
      </DropdownMenuLabel>
      {companies.length === 0 ? (
        <DropdownMenuItem disabled>No companies</DropdownMenuItem>
      ) : (
        companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            disabled={pending}
            onClick={() => onSwitch(company.id, company.active)}
            className="flex items-start gap-2"
          >
            {company.active ? (
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <Building2 className="mt-0.5 size-4 shrink-0 text-text-muted" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {company.name}
              </span>
              <span className="block truncate text-[11px] text-text-muted">
                {companyRoleLabel(company.role as UserRole)}
              </span>
            </span>
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => router.push("/companies/new")}>
        <Plus className="size-4" />
        Create company
      </DropdownMenuItem>
    </>
  );
}
