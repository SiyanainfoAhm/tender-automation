import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  constrained?: boolean;
};

export function PageContainer({
  children,
  className,
  constrained = true,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        constrained && "mx-auto w-full max-w-[1600px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
