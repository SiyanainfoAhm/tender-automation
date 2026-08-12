import Link from "next/link";
import { Bookmark, Star, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/server/auth/session";
import {
  deleteViewAction,
  setDefaultViewAction,
} from "@/server/actions/auth";
import { listSavedViews } from "@/server/repositories/savedViewRepository";
import { formatRelativeTime } from "@/lib/format";

export default async function SavedViewsPage() {
  const session = await requireSession();
  const views = await listSavedViews(session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-slate-50">
          Saved views
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your saved tender filter configurations.
        </p>
      </div>

      {views.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No saved views yet"
          description="Save filter configurations from the Tenders page to access them quickly."
          action={
            <Button asChild className="h-10 px-4">
              <Link href="/tenders">Browse tenders</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((view) => (
            <Card key={view.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{view.name}</CardTitle>
                  {view.isDefault ? (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="size-3" />
                      Default
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Updated {formatRelativeTime(view.updatedAt)}
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/tenders?${buildQueryFromFilters(view.filters)}`}
                  >
                    Apply view
                  </Link>
                </Button>
                {!view.isDefault ? (
                  <form action={setDefaultViewAction.bind(null, view.id)}>
                    <Button variant="secondary" size="sm" type="submit">
                      Set default
                    </Button>
                  </form>
                ) : null}
                <form action={deleteViewAction.bind(null, view.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function buildQueryFromFilters(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && value !== "" && value !== "ALL") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}
