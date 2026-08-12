import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-slate-200/80 dark:bg-slate-800",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
