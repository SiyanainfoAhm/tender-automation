import { resolveProjectCategory } from "@/lib/project-category";
import { categoryCapsuleClass } from "@/lib/tender-category-style";
import { cn } from "@/lib/utils";

type CategoryCapsuleProps = {
  category?: string | null;
  title?: string | null;
  description?: string | null;
  sourceCategory?: string | null;
  className?: string;
};

export function CategoryCapsule({
  category,
  title,
  description,
  sourceCategory,
  className,
}: CategoryCapsuleProps) {
  const label = resolveProjectCategory({
    projectCategory: category,
    title,
    description,
    sourceCategory,
  });

  return (
    <span
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1 truncate rounded-md px-2 py-1 text-xs font-medium",
        categoryCapsuleClass(label),
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
}
