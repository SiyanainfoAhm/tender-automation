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
        "inline-flex min-w-0 max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium leading-snug",
        categoryCapsuleClass(label),
        className,
      )}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
