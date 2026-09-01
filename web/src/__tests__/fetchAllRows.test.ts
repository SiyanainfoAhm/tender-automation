import { describe, expect, it, vi } from "vitest";

import {
  fetchAllSupabaseRows,
  SUPABASE_PAGE_SIZE,
} from "@/lib/db/fetchAllRows";

describe("fetchAllSupabaseRows", () => {
  it("pages until a short final batch", async () => {
    const totalRows = SUPABASE_PAGE_SIZE + 250;
    const allData = Array.from({ length: totalRows }, (_, index) => ({
      id: String(index),
    }));
    const rangeCalls: Array<[number, number]> = [];

    const range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      return Promise.resolve({
        data: allData.slice(from, to + 1),
        error: null,
      });
    });
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    const supabase = { from } as unknown as Parameters<
      typeof fetchAllSupabaseRows
    >[0];

    const rows = await fetchAllSupabaseRows<{ id: string }>(supabase, {
      table: "agenttender_web_tender_list",
      select: "id",
      order: { column: "scraped_date", ascending: false },
    });

    expect(rows).toHaveLength(totalRows);
    expect(rangeCalls).toEqual([
      [0, SUPABASE_PAGE_SIZE - 1],
      [SUPABASE_PAGE_SIZE, SUPABASE_PAGE_SIZE * 2 - 1],
    ]);
  });
});
