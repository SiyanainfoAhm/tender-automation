"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { updatePreferencesAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type PreferencesFormProps = {
  preferences: {
    theme: string;
    tableDensity: string;
    sidebarCollapsed: boolean;
    defaultDateFilter: string | null;
  };
};

export function PreferencesForm({ preferences }: PreferencesFormProps) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updatePreferencesAction(formData),
    {},
  );

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      <input type="hidden" name="theme" value="light" />

      <div className="space-y-2">
        <Label htmlFor="tableDensity">Table density</Label>
        <select
          id="tableDensity"
          name="tableDensity"
          defaultValue={preferences.tableDensity}
          disabled={pending}
          className="flex h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-sm"
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
      </div>

      <div className="flex items-center justify-between rounded-[10px] border border-border p-4">
        <div>
          <Label htmlFor="sidebarCollapsed">Collapsed sidebar</Label>
          <p className="text-xs text-text-muted">
            Start with the sidebar collapsed by default
          </p>
        </div>
        <input
          type="checkbox"
          id="sidebarCollapsed"
          name="sidebarCollapsed"
          value="true"
          defaultChecked={preferences.sidebarCollapsed}
          disabled={pending}
          className="size-4 rounded border-border"
        />
      </div>

      {state?.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-emerald-600">Preferences saved.</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving…
          </>
        ) : (
          "Save preferences"
        )}
      </Button>
    </form>
  );
}
