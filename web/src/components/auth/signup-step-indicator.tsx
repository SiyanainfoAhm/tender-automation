import { cn } from "@/lib/utils";

type SignupStepIndicatorProps = {
  step: 1 | 2;
};

export function SignupStepIndicator({ step }: SignupStepIndicatorProps) {
  return (
    <div className="mb-5 flex items-center gap-2">
      {[
        { n: 1 as const, label: "Account" },
        { n: 2 as const, label: "Company" },
      ].map((item, index) => {
        const active = step === item.n;
        const done = step > item.n;
        return (
          <div key={item.n} className="flex flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  active || done
                    ? "bg-primary text-white"
                    : "bg-secondary-100 text-text-muted",
                )}
              >
                {item.n}
              </div>
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  active || done ? "text-text-primary" : "text-text-muted",
                )}
              >
                Step {item.n} {item.label}
              </span>
            </div>
            {index === 0 ? (
              <div
                className={cn(
                  "h-px w-6 shrink-0 sm:w-10",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
