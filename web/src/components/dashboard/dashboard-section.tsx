import type { ReactNode } from "react";

type DashboardSectionProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

export function DashboardSection({
  title,
  children,
  action,
}: DashboardSectionProps) {
  return (
    <section className="rounded-[14px] border border-border bg-surface p-5 shadow-sm lg:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
