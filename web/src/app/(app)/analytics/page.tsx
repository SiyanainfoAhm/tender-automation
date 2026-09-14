import { redirect } from "next/navigation";

/** Reports module removed from design (TF-61). */
export default function AnalyticsPage() {
  redirect("/dashboard");
}
