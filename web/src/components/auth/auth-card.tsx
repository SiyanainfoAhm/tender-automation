import { cn } from "@/lib/utils";

type AuthCardProps = {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: AuthCardProps) {
  return (
    <div
      className={cn(
        "w-full max-w-[400px] rounded-lg border border-border bg-card p-6 shadow-sm sm:p-7",
        className,
      )}
    >
      {title ? (
        <div className="mb-5 space-y-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-text-primary">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-text-muted">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="mt-5">{footer}</div> : null}
    </div>
  );
}
