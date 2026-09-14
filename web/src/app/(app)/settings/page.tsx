import { redirect } from "next/navigation";

/**
 * Settings & Preferences module removed from design (TF-63).
 * Company Profile is the approved location for company/bid preferences.
 * Display preferences remain on Profile.
 */
export default function SettingsPage() {
  redirect("/company-profile");
}
