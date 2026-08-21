"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTender247AccountAction,
  updateTender247AccountAction,
  type Tender247AccountListItem,
} from "@/server/actions/tender247-accounts";

type Props = {
  accounts: Tender247AccountListItem[];
  canManage: boolean;
  companyName: string;
};

export function Tender247AccountsPanel({
  accounts: initial,
  canManage,
  companyName,
}: Props) {
  const [accounts, setAccounts] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedId, setSelectedId] = useState(initial[0]?.id || "");

  function refreshFromServer(next: Tender247AccountListItem[]) {
    setAccounts(next);
    if (!next.some((a) => a.id === selectedId)) {
      setSelectedId(next[0]?.id || "");
    }
  }

  function addAccount() {
    startTransition(async () => {
      const result = await createTender247AccountAction({
        label,
        username,
        password,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message || "Account added");
      setLabel("");
      setUsername("");
      setPassword("");
      // Soft refresh list locally
      if (result.id) {
        const next = [
          ...accounts,
          {
            id: result.id,
            label: label.trim() || "Account",
            username: username.trim(),
            isActive: true,
            lastUsedAt: null,
            sortOrder: accounts.length + 1,
          },
        ];
        refreshFromServer(next);
        setSelectedId(result.id);
      }
    });
  }

  function toggleActive(id: string, isActive: boolean) {
    startTransition(async () => {
      const result = await updateTender247AccountAction({ id, isActive });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      refreshFromServer(
        accounts.map((a) => (a.id === id ? { ...a, isActive } : a)),
      );
      toast.success(result.message || "Updated");
    });
  }

  const selected = accounts.find((a) => a.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-foreground-600">
          Company: <span className="font-medium text-foreground-900">{companyName}</span>
        </p>
        <p className="mt-1 text-xs text-foreground-500">
          Multiple Tender247 logins share the same company preferences, tender
          database, GPT screening, and Azure company paths. Only browser
          session and seed Excel are account-scoped.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tender247 Account</Label>
        <select
          className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={accounts.length === 0}
        >
          {accounts.length === 0 ? (
            <option value="">No accounts yet</option>
          ) : (
            accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} ({account.username})
                {!account.isActive ? " — inactive" : ""}
              </option>
            ))
          )}
        </select>
        {selected ? (
          <div className="rounded-md border border-border bg-background-50 p-3 text-xs text-foreground-600">
            <p>
              Run pipeline:
            </p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-[11px] text-foreground-800">
              {`npm run pipeline:tender247 -- --account-id=${selected.id}`}
            </code>
            <p className="mt-2">
              Auth setup:
            </p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-[11px] text-foreground-800">
              {`npm run auth:tender247 -- --account-id=${selected.id}`}
            </code>
            {canManage ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-8 text-xs"
                disabled={pending}
                onClick={() => toggleActive(selected.id, !selected.isActive)}
              >
                {selected.isActive ? "Deactivate" : "Activate"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium text-foreground-800">Add Tender247 Account</p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="t247-label">Label</Label>
              <Input
                id="t247-label"
                value={label}
                placeholder="Main Account"
                onChange={(e) => setLabel(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t247-user">Username</Label>
              <Input
                id="t247-user"
                value={username}
                placeholder="user@company.com"
                onChange={(e) => setUsername(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t247-pass">Password</Label>
              <Input
                id="t247-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <Button
            type="button"
            className="h-9 gap-1.5 text-sm"
            disabled={pending || !label.trim() || !username.trim() || !password}
            onClick={addAccount}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add Account
          </Button>
        </div>
      ) : null}
    </div>
  );
}
