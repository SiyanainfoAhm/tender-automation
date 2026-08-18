"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import {
  addAndSelectOption,
  findScopeMatch,
  mergeScopeOptions,
  removeSelectedScope,
} from "@/lib/company/scope-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ScopeChipFieldProps = {
  label: string;
  hiddenName: string;
  canEdit: boolean;
  pending?: boolean;
  defaultSuggestions: readonly string[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  customPlaceholder: string;
  emptyLabel: string;
};

const suggestionChipClass =
  "inline-flex items-center rounded-full border border-border bg-white px-3 py-1 text-xs text-text-secondary hover:bg-surface-secondary hover:border-primary/40 hover:text-primary";

const selectedChipClass =
  "inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700";

export function ScopeChipField({
  label,
  hiddenName,
  canEdit,
  pending = false,
  defaultSuggestions,
  selected,
  onSelectedChange,
  customPlaceholder,
  emptyLabel,
}: ScopeChipFieldProps) {
  const [options, setOptions] = useState(() =>
    mergeScopeOptions(defaultSuggestions, selected),
  );
  const [customValue, setCustomValue] = useState("");

  const availableSuggestions = useMemo(
    () => options.filter((option) => !findScopeMatch(option, selected)),
    [options, selected],
  );

  function addValue(raw: string) {
    const result = addAndSelectOption(raw, options, selected);
    setOptions(result.options);
    onSelectedChange(result.selected);
    setCustomValue("");
  }

  function onCustomKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addValue(customValue);
  }

  return (
    <section className="space-y-2" aria-label={label}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
        {label}
      </p>
      <input type="hidden" name={hiddenName} value={selected.join("\n")} />

      {canEdit && availableSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {availableSuggestions.map((option) => (
            <button
              key={option}
              type="button"
              disabled={pending}
              onClick={() => addValue(option)}
              className={suggestionChipClass}
            >
              + {option}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {selected.map((value) => (
          <span key={value} className={selectedChipClass}>
            {value}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${value}`}
                disabled={pending}
                onClick={() =>
                  onSelectedChange(removeSelectedScope(value, selected))
                }
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {selected.length === 0 ? (
          <span className="text-xs text-text-muted">{emptyLabel}</span>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex gap-2">
          <Input
            placeholder={customPlaceholder}
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={onCustomKeyDown}
            disabled={pending}
            maxLength={80}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => addValue(customValue)}
            disabled={pending}
          >
            Add
          </Button>
        </div>
      ) : null}
    </section>
  );
}
