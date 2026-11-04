// Reads and writes for shops, tiles and taps. Counts are computed from
// taps, never stored (plan 1.3).
import type { Env } from "./env";
import { startOfShopDay, startOfShopWeek } from "../shared/time";
import { postName, isLiveStory, wallOrder } from "../shared/names";
import type { WallTile } from "../shared/types";

export interface ShopRow {
  id: string;
  buffer_account_id: string;
  buffer_org_id: string;
  name: string;
  handle: string;
  avatar_key: string | null;
  card_channel_id: string | null;
  timezone: string;
  thank_you_text: string | null;
  review_url: string | null;
  mark_winners: number;
  theme: "system" | "day" | "night";
  awake_until: string | null;
  last_polled_at: string | null;
  polls_quiet: number;
  created_at: string;
  revoked_at: string | null;
  deleted_at: string | null;
  card_printed_at: string | null;
}

export interface TileRow {
  id: string;
  shop_id: string;
  nickname: string | null;
  subject: string | null;
  text_hash: string;
  first_sent_at: string;
  hidden: number;
  tagged_at: string | null;
}

export async function getShop(env: Env, id: string): Promise<ShopRow | null> {
  return env.DB.prepare(`SELECT * FROM shops WHERE id = ?1`).bind(id).first<ShopRow>();
}

export async function liveShop(env: Env, id: string): Promise<ShopRow | null> {
  const s = await getShop(env, id);
  return s && !s.deleted_at ? s : null;
}

/** Loading the wall, counter or tap page keeps a shop awake for 24 h (plan 1.6). */
export async function wake(env: Env, shopId: string, now = new Date()): Promise<void> {
  await env.DB.prepare(`UPDATE shops SET awake_until = ?2 WHERE id = ?1`).bind(shopId, new Date(now.getTime() + 24 * 3600000).toISOString()).run();
}

interface WallQueryRow {
  tile_id: string;
  nickname: string | null;
  subject: string | null;
  first_sent_at: string;
  hidden: number;
  tagged_at: string | null;
  text: string;
  thumb_post: string | null;
  kind: string;
  is_story: number;
  services: string | null;
  links: string | null;
  people: number;
}

/**
 * Tiles for the wall and the tap page: every tile with a post sent in the
 * last 60 days, newest first, with its people count from taps.
 */
export async function wallTiles(env: Env, shop: ShopRow, now = new Date(), opts: { includeHidden?: boolean; limit?: number } = {}): Promise<WallTile[]> {
  const since = new Date(now.getTime() - 60 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT t.id AS tile_id, t.nickname, t.subject, t.first_sent_at, t.hidden, t.tagged_at,
            (SELECT p.text FROM posts p WHERE p.tile_id = t.id ORDER BY length(p.text) DESC LIMIT 1) AS text,
            (SELECT p.id FROM posts p WHERE p.tile_id = t.id AND p.thumb_status = 'ok' ORDER BY p.sent_at LIMIT 1) AS thumb_post,
            (SELECT p.kind FROM posts p WHERE p.tile_id = t.id ORDER BY CASE p.kind WHEN 'photo' THEN 0 WHEN 'video' THEN 1 WHEN 'link' THEN 2 ELSE 3 END LIMIT 1) AS kind,
            (SELECT MAX(p.is_story) FROM posts p WHERE p.tile_id = t.id) AS is_story,
            (SELECT json_group_array(DISTINCT c.service) FROM posts p JOIN channels c ON c.id = p.channel_id WHERE p.tile_id = t.id AND c.enabled = 1) AS services,
            (SELECT json_group_array(json_object('service', c.service, 'url', p.external_link)) FROM posts p JOIN channels c ON c.id = p.channel_id WHERE p.tile_id = t.id AND c.enabled = 1 AND p.external_link IS NOT NULL) AS links,
            (SELECT COUNT(*) FROM taps x WHERE x.tile_id = t.id AND x.answer = 'post') AS people
       FROM tiles t
      WHERE t.shop_id = ?1 AND t.first_sent_at >= ?2 ${opts.includeHidden ? "" : "AND t.hidden = 0"}
        AND EXISTS (SELECT 1 FROM posts p JOIN channels c ON c.id = p.channel_id WHERE p.tile_id = t.id AND c.enabled = 1)
      ORDER BY t.first_sent_at DESC
      ${opts.limit ? `LIMIT ${Number(opts.limit)}` : ""}`,
  ).bind(shop.id, since).all<WallQueryRow>();
  return wallOrder(results.map((r) => toWallTile(r, shop, now)));
}

function toWallTile(r: WallQueryRow, shop: ShopRow, now: Date): WallTile {
  const sent = new Date(r.first_sent_at);
  const services = (JSON.parse(r.services ?? "[]") as (string | null)[]).filter((s): s is string => !!s);
  const links = (JSON.parse(r.links ?? "[]") as { service: string; url: string }[]).filter((l) => l.url);
  const hasImage = !!r.thumb_post;
  return {
    id: r.tile_id,
    name: postName({ firstSentAt: r.first_sent_at, nickname: r.nickname, subject: r.subject, text: r.text, hasImage }, now, shop.timezone),
    nickname: r.nickname,
    subject: r.subject,
    text: r.text ?? "",
    firstSentAt: r.first_sent_at,
    hasImage,
    imageUrl: hasImage ? `/i/${shop.id}/${encodeURIComponent(r.thumb_post!)}` : null,
    kind: (r.kind as WallTile["kind"]) ?? "text",
    isStory: !!r.is_story,
    isLive: isLiveStory(!!r.is_story, sent, now),
    services,
    links,
    count: r.people ?? 0,
    tagged: !!r.tagged_at,
    hidden: !!r.hidden,
  };
}

/** The tap page's grid: today's live story first, then the newest 12 tiles not hidden (plan 3.5). */
export function tapGrid(tiles: WallTile[]): { story: WallTile | null; tiles: WallTile[] } {
  const visible = tiles.filter((t) => !t.hidden);
  const story = visible.find((t) => t.isLive) ?? null;
  return { story, tiles: visible.filter((t) => t !== story).slice(0, 12) };
}

export async function tileById(env: Env, shopId: string, tileId: string): Promise<TileRow | null> {
  return env.DB.prepare(`SELECT * FROM tiles WHERE id = ?1 AND shop_id = ?2`).bind(tileId, shopId).first<TileRow>();
}

/** A tile a tap may count: the shop's, not hidden, on an enabled channel, inside the 60 days (plan 3.5, 3.6). */
export async function tileOnGrid(env: Env, shopId: string, tileId: string, now = new Date()): Promise<TileRow | null> {
  const since = new Date(now.getTime() - 60 * 86400000).toISOString();
  return env.DB.prepare(
    `SELECT t.* FROM tiles t WHERE t.id = ?1 AND t.shop_id = ?2 AND t.hidden = 0 AND t.first_sent_at >= ?3
       AND EXISTS (SELECT 1 FROM posts p JOIN channels c ON c.id = p.channel_id WHERE p.tile_id = t.id AND c.enabled = 1)`,
  ).bind(tileId, shopId, since).first<TileRow>();
}

export async function tileText(env: Env, tileId: string): Promise<{ text: string; hasImage: boolean; thumbPost: string | null }> {
  const r = await env.DB.prepare(
    `SELECT (SELECT text FROM posts WHERE tile_id = ?1 ORDER BY length(text) DESC LIMIT 1) AS text,
            (SELECT id FROM posts WHERE tile_id = ?1 AND thumb_status = 'ok' ORDER BY sent_at LIMIT 1) AS thumb`,
  ).bind(tileId).first<{ text: string | null; thumb: string | null }>();
  return { text: r?.text ?? "", hasImage: !!r?.thumb, thumbPost: r?.thumb ?? null };
}

/** People who came in because of a post today and this week, shop time. */
export async function postCounts(env: Env, shop: ShopRow, now = new Date()): Promise<{ today: number; week: number; any: boolean }> {
  const dayStart = startOfShopDay(now, shop.timezone).toISOString();
  const weekStart = startOfShopWeek(now, shop.timezone).toISOString();
  const r = await env.DB.prepare(
    `SELECT SUM(CASE WHEN created_at >= ?2 AND answer = 'post' THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN created_at >= ?3 AND answer = 'post' THEN 1 ELSE 0 END) AS week,
            COUNT(*) AS anyTaps
       FROM taps WHERE shop_id = ?1`,
  ).bind(shop.id, dayStart, weekStart).first<{ today: number | null; week: number | null; anyTaps: number }>();
  return { today: r?.today ?? 0, week: r?.week ?? 0, any: (r?.anyTaps ?? 0) > 0 };
}

export async function tileCount(env: Env, tileId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE tile_id = ?1 AND answer = 'post'`).bind(tileId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Has this device already had its counted tap at this shop today? (plan 1.3, counting rule) */
export async function tappedToday(env: Env, shop: ShopRow, device: string, now = new Date()): Promise<boolean> {
  const dayStart = startOfShopDay(now, shop.timezone).toISOString();
  const r = await env.DB.prepare(`SELECT 1 AS x FROM taps WHERE shop_id = ?1 AND device_hash = ?2 AND created_at >= ?3 LIMIT 1`).bind(shop.id, device, dayStart).first();
  return !!r;
}
