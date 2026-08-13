import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  /**
   * Soft max width for very wide screens.
   * Default false — TenderFlow pages use available width.
   */
  constrained?: boolean;
};

/**
 * Canonical authenticated page padding wrapper (Architecture A).
 * AppShell wraps every (app) route with exactly one PageContainer.
 * Do NOT nest another PageContainer in route pages.
 */
export function PageContainer({
  children,
  className,
  constrained = false,
}: PageContainerProps) {
  return (
    <div
      data-tf-page=""
      className={cn(
        "box-border w-full min-w-0",
        "px-4 pb-5 pt-5",
        "sm:px-5 sm:pb-6 sm:pt-6",
        "lg:px-6 lg:pb-6 lg:pt-8",
        constrained && "mx-auto max-w-[1600px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
