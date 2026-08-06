import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-[#E2E8F0]/80",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
