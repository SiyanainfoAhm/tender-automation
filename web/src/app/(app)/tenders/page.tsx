import { redirect } from "next/navigation";

type TendersIndexProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Default Tenders entry → Indian list (Global is a sibling nav child). */
export default async function TendersIndexPage({
  searchParams,
}: TendersIndexProps) {
  const raw = searchParams ? await searchParams : {};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "region") continue;
    const text = Array.isArray(value) ? value[0] : value;
    if (text) params.set(key, text);
  }
  const qs = params.toString();
  redirect(qs ? `/tenders/indian?${qs}` : "/tenders/indian");
}
