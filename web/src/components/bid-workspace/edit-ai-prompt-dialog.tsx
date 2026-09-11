"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BID_AI_PROMPT_CATALOG, type BidAiPromptKey } from "@/lib/bid-ai-prompts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  getBidAiPromptAction,
  resetBidAiPromptAction,
  saveBidAiPromptAction,
} from "@/server/actions/bid-workspace";

type EditAiPromptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  promptKey: BidAiPromptKey;
  readOnly?: boolean;
  /** Optional requirement / context line under the title. */
  contextLabel?: string | null;
  dialogTitle?: string;
  /** Label for the primary AI action button. */
  useAiLabel?: string;
  /** Show optional one-off instructions (e.g. regenerate notes). */
  showExtraInstructions?: boolean;
  extraInstructionsPlaceholder?: string;
  /** When provided, shows the AI action and runs after save (or immediately if unchanged). */
  onSaveAndUseAi?: (options?: {
    template: string;
    extraInstructions?: string;
  }) => void | Promise<void>;
};

export function EditAiPromptDialog({
  open,
  onOpenChange,
  tenderId,
  promptKey,
  readOnly = false,
  contextLabel = null,
  dialogTitle = "Edit AI Prompt",
  useAiLabel = "Save & Use AI",
  showExtraInstructions = false,
  extraInstructionsPlaceholder = "Optional notes for this run only…",
  onSaveAndUseAi,
}: EditAiPromptDialogProps) {
  const meta = BID_AI_PROMPT_CATALOG[promptKey];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState("");
  const [defaultTemplate, setDefaultTemplate] = useState(meta.defaultTemplate);
  const [isCustom, setIsCustom] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setExtraInstructions("");
    void (async () => {
      const result = await getBidAiPromptAction({ tenderId, promptKey });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        onOpenChange(false);
        return;
      }
      setTemplate(result.template);
      setBaseline(result.template);
      setDefaultTemplate(result.defaultTemplate);
      setIsCustom(result.isCustom);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenderId, promptKey, onOpenChange]);

  const dirty = template !== baseline;

  async function persistTemplate(): Promise<string | null> {
    const result = await saveBidAiPromptAction({
      tenderId,
      promptKey,
      template,
    });
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setBaseline(result.template);
    setTemplate(result.template);
    setIsCustom(true);
    return result.template;
  }

  async function saveOnly() {
    if (readOnly || saving || !dirty) return;
    setSaving(true);
    try {
      const saved = await persistTemplate();
      if (!saved) return;
      toast.success("Prompt saved.");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndUseAi() {
    if (readOnly || saving || !onSaveAndUseAi) return;
    setSaving(true);
    try {
      let effective = template;
      if (dirty) {
        const saved = await persistTemplate();
        if (!saved) return;
        effective = saved;
        toast.success("Prompt saved.");
      }
      onOpenChange(false);
      await onSaveAndUseAi({
        template: effective,
        extraInstructions: extraInstructions.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (readOnly || saving) return;
    if (dirty && !window.confirm("Discard unsaved edits and reset to the default prompt?")) {
      return;
    }
    if (
      isCustom &&
      !dirty &&
      !window.confirm("Reset this prompt to the application default?")
    ) {
      return;
    }
    setSaving(true);
    try {
      const result = await resetBidAiPromptAction({ tenderId, promptKey });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTemplate(result.template);
      setBaseline(result.template);
      setDefaultTemplate(result.template);
      setIsCustom(false);
      toast.success("Default prompt restored.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            Prompt used for: {meta.label}
            {isCustom ? " · Custom override" : " · Default"}
            {contextLabel ? ` · ${contextLabel}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <p className="text-xs text-foreground-500">{meta.description}</p>
          <p className="text-[11px] text-foreground-400">
            Edit the instruction template only. Tender/RFP content and document
            references are injected securely on the server when AI runs.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-foreground-500">
              <Loader2 className="size-4 animate-spin" />
              Loading prompt…
            </div>
          ) : (
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={showExtraInstructions ? 12 : 16}
              disabled={readOnly || saving}
              className="min-h-[240px] font-mono text-xs leading-relaxed"
            />
          )}
          <p className="text-[11px] text-foreground-400">
            {template.length.toLocaleString()} / {meta.maxLength.toLocaleString()}{" "}
            characters
            {defaultTemplate && template === defaultTemplate
              ? " · Matches default"
              : ""}
          </p>
          {showExtraInstructions && !loading ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground-700">
                Optional instructions for this run
              </p>
              <Textarea
                value={extraInstructions}
                onChange={(e) => setExtraInstructions(e.target.value)}
                rows={3}
                disabled={readOnly || saving}
                placeholder={extraInstructionsPlaceholder}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly || loading || saving}
            onClick={() => void resetToDefault()}
          >
            Reset to Default
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={readOnly || loading || saving || !dirty}
              onClick={() => void saveOnly()}
            >
              {saving ? "Saving…" : "Save Prompt"}
            </Button>
            {onSaveAndUseAi && !readOnly ? (
              <Button
                type="button"
                size="sm"
                disabled={loading || saving}
                onClick={() => void saveAndUseAi()}
              >
                {saving ? "Working…" : useAiLabel}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
