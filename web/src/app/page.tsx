import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/tenders/indian?date=yesterday&status=may_bid");
}
