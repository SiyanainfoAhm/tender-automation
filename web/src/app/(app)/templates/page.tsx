import { redirect } from "next/navigation";

/** Templates module removed from design (TF-62). */
export default function TemplatesPage() {
  redirect("/dashboard");
}
