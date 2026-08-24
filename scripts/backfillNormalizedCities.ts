/**
 * Optional one-shot backfill: rewrite agenttender_tenders.city to normalized
 * values. Safe to re-run. Does not delete tenders or change qualification.
 *
 * Usage (from repo root, with SUPABASE_URL + service role key in env):
 *   npx tsx scripts/backfillNormalizedCities.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  normalizeTenderCity,
  stripLocationDecorators,
} from "../src/location/normalizeTenderCity.js";

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and service role key required");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("agenttender_tenders")
    .select("id, city, state, location_text")
    .limit(10_000);
  if (error) throw error;

  let updated = 0;
  let cleared = 0;
  for (const row of data || []) {
    const nextCity =
      normalizeTenderCity({
        city: row.city,
        state: row.state,
        location_text: row.location_text,
      }) || null;
    const nextLocation = row.location_text
      ? stripLocationDecorators(String(row.location_text)) || row.location_text
      : row.location_text;
    if (nextCity === row.city && nextLocation === row.location_text) {
      continue;
    }
    const { error: upErr } = await supabase
      .from("agenttender_tenders")
      .update({ city: nextCity, location_text: nextLocation })
      .eq("id", row.id);
    if (upErr) {
      console.error(`Failed ${row.id}: ${upErr.message}`);
      continue;
    }
    if (nextCity) updated += 1;
    else cleared += 1;
  }
  console.log(
    `CITY_BACKFILL_DONE updated=${updated} cleared_invalid=${cleared} scanned=${data?.length ?? 0}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
