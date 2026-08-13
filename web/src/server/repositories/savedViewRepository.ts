import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type SavedView = {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  filters: Record<string, unknown>;
  sortConfig: Record<string, unknown>;
  visibleColumns: string[];
  createdAt: string;
  updatedAt: string;
};

function mapView(row: Record<string, unknown>): SavedView {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    isDefault: Boolean(row.is_default),
    filters: (row.filters as Record<string, unknown>) || {},
    sortConfig: (row.sort_config as Record<string, unknown>) || {},
    visibleColumns: (row.visible_columns as string[]) || [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listSavedViews(userId: string): Promise<SavedView[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_saved_views")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => mapView(r as Record<string, unknown>));
}

export async function createSavedView(options: {
  userId: string;
  name: string;
  isDefault?: boolean;
  filters: Record<string, unknown>;
  sortConfig: Record<string, unknown>;
  visibleColumns: string[];
}): Promise<SavedView> {
  const supabase = getServerSupabase();
  if (options.isDefault) {
    await supabase
      .from("agenttender_saved_views")
      .update({ is_default: false })
      .eq("user_id", options.userId);
  }
  const { data, error } = await supabase
    .from("agenttender_saved_views")
    .insert({
      user_id: options.userId,
      name: options.name,
      is_default: options.isDefault ?? false,
      filters: options.filters,
      sort_config: options.sortConfig,
      visible_columns: options.visibleColumns,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapView(data as Record<string, unknown>);
}

export async function updateSavedView(
  id: string,
  userId: string,
  patch: Partial<{
    name: string;
    isDefault: boolean;
    filters: Record<string, unknown>;
    sortConfig: Record<string, unknown>;
    visibleColumns: string[];
  }>,
): Promise<SavedView> {
  const supabase = getServerSupabase();
  if (patch.isDefault) {
    await supabase
      .from("agenttender_saved_views")
      .update({ is_default: false })
      .eq("user_id", userId);
  }
  const update: Record<string, unknown> = {};
  if (patch.name != null) update.name = patch.name;
  if (patch.isDefault != null) update.is_default = patch.isDefault;
  if (patch.filters != null) update.filters = patch.filters;
  if (patch.sortConfig != null) update.sort_config = patch.sortConfig;
  if (patch.visibleColumns != null) update.visible_columns = patch.visibleColumns;

  const { data, error } = await supabase
    .from("agenttender_saved_views")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapView(data as Record<string, unknown>);
}

export async function deleteSavedView(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_saved_views")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function getUserPreferences(userId: string): Promise<{
  theme: string;
  tableDensity: string;
  sidebarCollapsed: boolean;
  defaultDateFilter: string | null;
  preferences: Record<string, unknown>;
}> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("agenttender_user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    await supabase.from("agenttender_user_preferences").insert({
      user_id: userId,
    });
    return {
      theme: "light",
      tableDensity: "comfortable",
      sidebarCollapsed: false,
      defaultDateFilter: null,
      preferences: {},
    };
  }

  return {
    theme: data.theme,
    tableDensity: data.table_density,
    sidebarCollapsed: data.sidebar_collapsed,
    defaultDateFilter: data.default_date_filter,
    preferences: (data.preferences as Record<string, unknown>) || {},
  };
}

export async function updateUserPreferences(
  userId: string,
  patch: Partial<{
    theme: string;
    tableDensity: string;
    sidebarCollapsed: boolean;
    defaultDateFilter: string | null;
    preferences: Record<string, unknown>;
  }>,
): Promise<void> {
  const supabase = getServerSupabase();
  const update: Record<string, unknown> = {};
  if (patch.theme != null) update.theme = patch.theme;
  if (patch.tableDensity != null) update.table_density = patch.tableDensity;
  if (patch.sidebarCollapsed != null) {
    update.sidebar_collapsed = patch.sidebarCollapsed;
  }
  if (patch.defaultDateFilter !== undefined) {
    update.default_date_filter = patch.defaultDateFilter;
  }
  if (patch.preferences != null) update.preferences = patch.preferences;

  const { error } = await supabase
    .from("agenttender_user_preferences")
    .upsert({ user_id: userId, ...update });
  if (error) throw new Error(error.message);
}
