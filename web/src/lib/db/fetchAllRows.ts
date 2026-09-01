import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST / Supabase default max rows per request. */
export const SUPABASE_PAGE_SIZE = 1000;

type OrderConfig = {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
};

/**
 * Fetch every row from a Supabase query, paging past the 1,000-row API cap.
 */
export async function fetchAllSupabaseRows<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  options: {
    table: string;
    select: string;
    order?: OrderConfig;
    apply?: (
      query: ReturnType<SupabaseClient["from"]>,
    ) => ReturnType<SupabaseClient["from"]>;
    pageSize?: number;
  },
): Promise<T[]> {
  const pageSize = options.pageSize ?? SUPABASE_PAGE_SIZE;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(options.table).select(options.select);
    if (options.apply) {
      query = options.apply(query) as typeof query;
    }
    if (options.order) {
      query = query.order(options.order.column, {
        ascending: options.order.ascending ?? true,
        nullsFirst: options.order.nullsFirst ?? false,
      });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      throw new Error(error.message);
    }
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}
