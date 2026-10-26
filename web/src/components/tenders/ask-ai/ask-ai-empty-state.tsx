"use client";

import type { AskAiQuickAction } from "@/components/tenders/ask-ai/types";

/**
 * Blank V2 chat surface. The client is a transport/display layer only:
 * prompts go to the existing authenticated Ask AI route and answers come from V2.
 * Preserve both exports for existing callers, without rendering canned prompts.
 */
export function AskAiQuickActions({
  disabled: _disabled,
  onSelect: _onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: AskAiQuickAction) => void;
}) {
  return null;
}

export function AskAiEmptyState({
  disabled: _disabled,
  onSelect: _onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: AskAiQuickAction) => void;
}) {
  return <div data-testid="ask-ai-empty-state" aria-label="Empty chat" />;
}
