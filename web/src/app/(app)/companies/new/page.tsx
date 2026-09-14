import { CreateCompanyForm } from "@/components/company/create-company-form";
import { requireSession } from "@/server/auth/session";

export default async function CreateCompanyPage() {
  await requireSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Create company
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Add another company workspace to your account. You can switch between
          companies anytime from your profile menu.
        </p>
      </div>
      <CreateCompanyForm />
    </div>
  );
}
