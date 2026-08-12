import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DashboardSectionProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function DashboardSection({
  title,
  children,
  action,
  className,
}: DashboardSectionProps) {
  return (
    <section
      className={cn(
        "flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        "dark:border-slate-700/60 dark:bg-slate-900/70 dark:shadow-none",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h3>
        {action}
      </div>
      <div className="min-h-0">{children}</div>
    </section>
  );
}
