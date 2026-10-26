"use client";
import { useRef, useState } from "react";
import { ThumbsUp, MessageSquareText } from "lucide-react";
import { feedbackStatusText, type ChatFeedbackKind, type ChatFeedbackReceipt } from "@/lib/ai/chat-feedback";

export function AskAiFeedback({ tenderId, messageId, answer, initialFeedback }: {
  tenderId: string; messageId: string; answer: string; initialFeedback?: ChatFeedbackReceipt;
}) {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [editing, setEditing] = useState(false);
  const [correction, setCorrection] = useState(answer.slice(0, 8000));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const endpoint = `/api/tenders/${tenderId}/ask-ai/feedback`;
  async function submit(kind: ChatFeedbackKind) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const payload = JSON.stringify({ message_id: messageId, feedback_type: kind,
      corrected_answer: kind === "CORRECTION" ? correction.trim() : undefined,
      correction_reason: kind === "HELPFUL" ? undefined : reason.trim() });
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload), request_id: retry.current.id }) });
      const data = await response.json();
      if (!response.ok || !data.feedback?.id) throw new Error(data.error || "Feedback could not be saved.");
      setFeedback(data.feedback); setEditing(false); retry.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Feedback could not be saved. Please retry."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`${endpoint}?message_id=${encodeURIComponent(messageId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check feedback.");
      if (data.feedback) setFeedback(data.feedback);
    } catch { setError("Unable to check feedback. Please retry."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const pending = feedback?.kind === "CORRECTION" && ["QUEUED", "VERIFYING", "INSUFFICIENT_EVIDENCE"].includes(feedback.status);
  const buttonClass = "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50";
  return <div className="mt-3 space-y-2" aria-label="Answer feedback">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={busy || feedback?.kind === "HELPFUL"} aria-pressed={feedback?.kind === "HELPFUL"} onClick={() => void submit("HELPFUL")}><ThumbsUp className="size-3.5" />Helpful</button>
      <button type="button" className={buttonClass} disabled={busy} aria-expanded={editing} onClick={() => { setEditing(v => !v); setError(""); }}><MessageSquareText className="size-3.5" />Needs improvement</button>
    </div>
    {editing ? <form className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" onSubmit={e => { e.preventDefault(); void submit("CORRECTION"); }}>
      <label className="block text-xs font-medium text-slate-700">What should change?
        <textarea required maxLength={4000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="For example: make it simpler, or explain which fact is wrong and cite the document/page." className="mt-1 min-h-16 w-full rounded-md border border-slate-300 bg-white p-2 text-xs" />
      </label>
      <label className="block text-xs font-medium text-slate-700">Edit the proposed answer
        <textarea required maxLength={8000} value={correction} disabled={busy} onChange={e => setCorrection(e.target.value)} className="mt-1 min-h-36 w-full rounded-md border border-slate-300 bg-white p-2 text-xs" />
      </label>
      <p className="text-[11px] leading-relaxed text-slate-500">Your original answer stays in history. Corrections are checked against documents before they can improve future answers for this tender.</p>
      <div className="flex flex-wrap gap-2"><button type="submit" className={buttonClass} disabled={busy || !reason.trim() || !correction.trim()}>{busy ? "Saving…" : "Save correction"}</button><button type="button" className={buttonClass} disabled={busy || !reason.trim()} onClick={() => void submit("UNHELPFUL")}>Send feedback only</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : null}
    {feedback ? <p role="status" className="text-[11px] leading-relaxed text-slate-600">{feedbackStatusText(feedback)} {pending ? <button type="button" disabled={busy} className="underline underline-offset-2" onClick={() => void checkStatus()}>Check status</button> : null}</p> : null}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </div>;
}

