// This week for a real shop and for the sample bakery (plan 3.7; P11).
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { wallTiles } from "./db";
import { listLocations } from "./locations";
import { startOfShopWeek, startOfShopMonth, startOfShopDay } from "../shared/time";
import { summarize, type Range, type WeekTap, type WeekTile, type WeekSummary } from "../shared/week";
import type { WallTile } from "../shared/types";

export function parseRange(v: string | undefined | null): Range {
  return v === "today" || v === "last" || v === "month" ? v : "this";
}

export function rangeWindow(range: Range, now: Date, tz: string): { from: Date; to: Date } {
  if (range === "today") return { from: startOfShopDay(now, tz), to: now };
  const week = startOfShopWeek(now, tz);
  if (range === "last") return { from: startOfShopWeek(new Date(week.getTime() - 3 * 86400000), tz), to: week };
  if (range === "month") return { from: startOfShopMonth(now, tz), to: now };
  return { from: week, to: now };
}

export interface WeekData {
  range: Range;
  summary: WeekSummary;
  tiles: (WallTile & { weekPeople: number; byLocation?: { label: string; n: number }[] })[];
}

export function weekTilesOf(tiles: WallTile[], kindDetails: Map<string, WeekTile["kindDetail"]>): WeekTile[] {
  return tiles.map((t) => ({ id: t.id, firstSentAt: t.firstSentAt, kind: t.kind, kindDetail: kindDetails.get(t.id) ?? null, isStory: t.isStory }));
}

export function rankTiles(summary: WeekSummary, tiles: WallTile[]): (WallTile & { weekPeople: number; byLocation?: { label: string; n: number }[] })[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  return summary.ranked.map((r) => ({ ...byId.get(r.tileId)!, weekPeople: r.people })).filter((t) => t.id);
}

export async function shopWeek(env: Env, shop: ShopRow, range: Range, now = new Date(), locationId: string | null = null): Promise<WeekData> {
  const { from, to } = rangeWindow(range, now, shop.timezone);
  const [tiles, taps, details] = await Promise.all([
    wallTiles(env, shop, now, { includeHidden: true, locationId }),
    env.DB.prepare(`SELECT tile_id, answer, source, location_id, created_at FROM taps WHERE shop_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND (?4 IS NULL OR location_id = ?4)`).bind(shop.id, from.toISOString(), to.toISOString(), locationId).all<{ tile_id: string | null; answer: WeekTap["answer"]; source: string; location_id: string | null; created_at: string }>(),
    env.DB.prepare(`SELECT tile_id, MAX(kind_detail) AS d FROM posts WHERE shop_id = ?1 AND kind_detail IS NOT NULL GROUP BY tile_id`).bind(shop.id).all<{ tile_id: string; d: WeekTile["kindDetail"] }>(),
  ]);
  const kinds = new Map(details.results.map((r) => [r.tile_id, r.d]));
  const summary = summarize(
    taps.results.map((t) => ({ tileId: t.tile_id, answer: t.answer, source: t.source, at: t.created_at })),
    weekTilesOf(tiles, kinds),
    shop.timezone,
    range,
  );
  const ranked = rankTiles(summary, tiles);
  // All locations, with two or more: under each ranked tile, its people by location (plan 3.7).
  const locs = await listLocations(env, shop.id);
  if (!locationId && locs.length >= 2) {
    const names = new Map(locs.map((l) => [l.id, l.name]));
    for (const t of ranked) {
      const by = new Map<string, number>();
      for (const x of taps.results) {
        if (x.answer !== "post" || x.tile_id !== t.id) continue;
        const label = x.location_id ? names.get(x.location_id) ?? "Other" : "Online";
        by.set(label, (by.get(label) ?? 0) + 1);
      }
      t.byLocation = [...by.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    }
  }
  return { range, summary, tiles: ranked };
}

/** "Downtown 7 · Eastside 4" for the Monday push: people last week by location, biggest first (online left out). */
export async function weekByLocation(env: Env, shop: ShopRow, range: Range, now = new Date()): Promise<string | null> {
  const locs = await listLocations(env, shop.id);
  if (locs.length < 2) return null;
  const { from, to } = rangeWindow(range, now, shop.timezone);
  const { results } = await env.DB.prepare(`SELECT location_id, COUNT(*) AS n FROM taps WHERE shop_id = ?1 AND answer = 'post' AND location_id IS NOT NULL AND created_at >= ?2 AND created_at < ?3 GROUP BY location_id`).bind(shop.id, from.toISOString(), to.toISOString()).all<{ location_id: string; n: number }>();
  const names = new Map(locs.map((l) => [l.id, l.name]));
  const rows = results.filter((r) => names.has(r.location_id) && r.n > 0).sort((a, b) => b.n - a.n);
  return rows.length ? rows.map((r) => `${names.get(r.location_id)} ${r.n}`).join(" · ") : null;
}
