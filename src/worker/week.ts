// This week for a real shop and for the sample bakery (plan 3.7; P11).
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { wallTiles } from "./db";
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
  tiles: (WallTile & { weekPeople: number })[];
}

export function weekTilesOf(tiles: WallTile[], kindDetails: Map<string, WeekTile["kindDetail"]>): WeekTile[] {
  return tiles.map((t) => ({ id: t.id, firstSentAt: t.firstSentAt, kind: t.kind, kindDetail: kindDetails.get(t.id) ?? null, isStory: t.isStory }));
}

export function rankTiles(summary: WeekSummary, tiles: WallTile[]): (WallTile & { weekPeople: number })[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  return summary.ranked.map((r) => ({ ...byId.get(r.tileId)!, weekPeople: r.people })).filter((t) => t.id);
}

export async function shopWeek(env: Env, shop: ShopRow, range: Range, now = new Date()): Promise<WeekData> {
  const { from, to } = rangeWindow(range, now, shop.timezone);
  const [tiles, taps, details] = await Promise.all([
    wallTiles(env, shop, now, { includeHidden: true }),
    env.DB.prepare(`SELECT tile_id, answer, source, created_at FROM taps WHERE shop_id = ?1 AND created_at >= ?2 AND created_at < ?3`).bind(shop.id, from.toISOString(), to.toISOString()).all<{ tile_id: string | null; answer: WeekTap["answer"]; source: string; created_at: string }>(),
    env.DB.prepare(`SELECT tile_id, MAX(kind_detail) AS d FROM posts WHERE shop_id = ?1 AND kind_detail IS NOT NULL GROUP BY tile_id`).bind(shop.id).all<{ tile_id: string; d: WeekTile["kindDetail"] }>(),
  ]);
  const kinds = new Map(details.results.map((r) => [r.tile_id, r.d]));
  const summary = summarize(
    taps.results.map((t) => ({ tileId: t.tile_id, answer: t.answer, source: t.source, at: t.created_at })),
    weekTilesOf(tiles, kinds),
    shop.timezone,
    range,
  );
  return { range, summary, tiles: rankTiles(summary, tiles) };
}
