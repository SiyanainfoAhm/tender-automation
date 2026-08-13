import { TenderFlowBrand } from "@/components/brand/tenderflow-brand";

type AuthPageShellProps = {
  children: React.ReactNode;
};

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6">
        <TenderFlowBrand href="/" />
      </div>
      {children}
    </div>
  );
}
