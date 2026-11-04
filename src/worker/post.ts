// A post's page (plan 3.9; P17): its words, counts by day and by source,
// nickname, hide from the card, and its write-back status.
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { wallTiles } from "./db";
import { sentCaption, dayPhrase } from "../shared/names";
import { shopDayKey, weekdayName, shortDate, shopDaysBetween } from "../shared/time";
import type { WallTile } from "../shared/types";

export interface PostPage {
  tile: WallTile;
  sent: string;
  byDay: { label: string; n: number }[];
  bySource: { label: string; n: number }[];
  noteLeft: boolean;
  media: "image" | "video" | "none";
  channels: { id: string; name: string; service: string; needsPhoto: boolean; needsBoard: boolean }[];
}

export function dayLabel(at: Date, now: Date, tz: string): string {
  return Math.abs(shopDaysBetween(at, now, tz)) <= 6 ? weekdayName(at, tz) : shortDate(at, tz);
}

export function groupByDay(taps: { at: string }[], now: Date, tz: string): { label: string; n: number }[] {
  const days = new Map<string, { label: string; n: number }>();
  for (const t of [...taps].sort((a, b) => a.at.localeCompare(b.at))) {
    const d = new Date(t.at);
    const key = shopDayKey(d, tz);
    const row = days.get(key) ?? { label: dayLabel(d, now, tz), n: 0 };
    row.n++;
    days.set(key, row);
  }
  return [...days.values()];
}

export function sourceLines(taps: { source: string }[]): { label: string; n: number }[] {
  const n = (s: string[]) => taps.filter((t) => s.includes(t.source)).length;
  return [
    { label: "From the card", n: n(["card", "sample"]) },
    { label: "At the counter", n: n(["counter"]) },
    { label: "Online", n: n(["online"]) },
  ];
}

export async function shopPostPage(env: Env, shop: ShopRow, tileId: string, now = new Date()): Promise<PostPage | null> {
  const tiles = await wallTiles(env, shop, now, { includeHidden: true });
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile) return null;
  const [taps, row, kinds, channels] = await Promise.all([
    env.DB.prepare(`SELECT source, created_at FROM taps WHERE tile_id = ?1 AND answer = 'post'`).bind(tileId).all<{ source: string; created_at: string }>(),
    env.DB.prepare(`SELECT note_id FROM tiles WHERE id = ?1`).bind(tileId).first<{ note_id: string | null }>(),
    env.DB.prepare(`SELECT kind FROM posts WHERE tile_id = ?1`).bind(tileId).all<{ kind: string }>(),
    env.DB.prepare(`SELECT id, name, display_name, service FROM channels WHERE shop_id = ?1 AND enabled = 1 ORDER BY rowid`).bind(shop.id).all<{ id: string; name: string; display_name: string | null; service: string }>(),
  ]);
  const media = kinds.results.some((k) => k.kind === "photo") ? "image" : kinds.results.some((k) => k.kind === "video") ? "video" : "none";
  void dayPhrase;
  return {
    tile,
    sent: sentCaption(new Date(tile.firstSentAt), now, shop.timezone),
    byDay: groupByDay(taps.results.map((t) => ({ at: t.created_at })), now, shop.timezone),
    bySource: sourceLines(taps.results),
    noteLeft: !!row?.note_id,
    media,
    channels: channels.results.map((c) => ({ id: c.id, name: c.display_name || c.name, service: c.service, needsPhoto: (c.service === "instagram" || c.service === "tiktok") && media === "none", needsBoard: c.service === "pinterest" })),
  };
}
