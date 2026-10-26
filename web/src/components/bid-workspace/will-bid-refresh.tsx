"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Refreshes server-rendered data through the existing authenticated route. */
export function WillBidRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [router]);
  return null;
}
