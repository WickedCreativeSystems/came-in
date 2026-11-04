// The sample bakery's server side (plan 1.5, 3.10): no account, taps go to
// sample_taps for this browser's session, counts = baseline + this session.
import type { Env } from "./env";
import { SAMPLE_POSTS, SAMPLE_SHOP, samplePostSentAt, sampleImageUrl } from "../shared/sample";
import { postName, isLiveStory, firstLine, wallOrder } from "../shared/names";
import { startOfShopDay } from "../shared/time";
import type { WallTile, WallData } from "../shared/types";
import { sampleHistory } from "../shared/sampleweek";
import { summarize, type Range, type WeekTap } from "../shared/week";
import { rangeWindow, rankTiles, weekTilesOf, type WeekData } from "./week";
import { groupByDay, sourceLines, type PostPage } from "./post";
import { sentCaption } from "../shared/names";


// Baseline header and week counts, as the sample shows them (look.md section 10).
const BASE_TODAY = 3;
const BASE_WEEK = 11;

export async function sampleSessionTaps(env: Env, session: string): Promise<{ tile_id: string | null; answer: string; created_at: string; source: string }[]> {
  const { results } = await env.DB.prepare(`SELECT tile_id, answer, created_at, source FROM sample_taps WHERE session_id = ?1`).bind(session).all<{ tile_id: string | null; answer: string; created_at: string; source: string }>();
  return results;
}

/** This browser's nicknames and hidden posts in the sample (plan 3.9, P17). */
export async function sampleTileSettings(env: Env, session: string): Promise<{ nick: Map<string, string>; hidden: Set<string> }> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM sample_settings WHERE session_id = ?1 AND (key LIKE 'nick:%' OR key LIKE 'hide:%')`).bind(session).all<{ key: string; value: string | null }>();
  const nick = new Map<string, string>();
  const hidden = new Set<string>();
  for (const r of results) {
    if (r.key.startsWith("nick:") && r.value) nick.set(r.key.slice(5), r.value);
    if (r.key.startsWith("hide:") && r.value === "1") hidden.add(r.key.slice(5));
  }
  return { nick, hidden };
}

export function sampleTiles(now: Date, extra: Map<string, number>, own: { nick: Map<string, string>; hidden: Set<string> } = { nick: new Map(), hidden: new Set() }): WallTile[] {
  const tz = SAMPLE_SHOP.timezone;
  const tiles = SAMPLE_POSTS.map((p): WallTile => {
    const sent = samplePostSentAt(p, now, tz);
    const imageUrl = sampleImageUrl(p);
    return {
      id: p.id,
      name: postName({ firstSentAt: sent.toISOString(), nickname: own.nick.get(p.id) ?? null, subject: p.subject, text: p.text, hasImage: !!imageUrl }, now, tz),
      nickname: own.nick.get(p.id) ?? null,
      subject: p.subject,
      text: p.textOnly ? firstLine(p.text) : p.text,
      firstSentAt: sent.toISOString(),
      hasImage: !!imageUrl,
      imageUrl,
      kind: p.textOnly ? "text" : p.id === "hands" ? "video" : "photo",
      isStory: !!p.story,
      isLive: isLiveStory(!!p.story, sent, now),
      services: p.services,
      links: [],
      count: p.count + (extra.get(p.id) ?? 0),
      tagged: p.tagged,
      hidden: own.hidden.has(p.id),
    } satisfies WallTile;
  });
  return wallOrder(tiles);
}

export async function sampleWall(env: Env, session: string, now = new Date()): Promise<WallData> {
  const [taps, own] = await Promise.all([sampleSessionTaps(env, session), sampleTileSettings(env, session)]);
  const extra = new Map<string, number>();
  const dayStart = startOfShopDay(now, SAMPLE_SHOP.timezone).toISOString();
  let today = 0;
  for (const t of taps) {
    if (t.answer !== "post" || !t.tile_id) continue;
    extra.set(t.tile_id, (extra.get(t.tile_id) ?? 0) + 1);
    if (t.created_at >= dayStart) today++;
  }
  const postTaps = taps.filter((t) => t.answer === "post").length;
  return {
    shop: {
      id: SAMPLE_SHOP.id,
      name: SAMPLE_SHOP.name,
      handle: SAMPLE_SHOP.handle,
      avatarUrl: null,
      timezone: SAMPLE_SHOP.timezone,
      theme: "system",
      isSample: true,
      markWinners: true,
      tapUrl: "/sample/t",
      createdAt: now.toISOString(),
    },
    tiles: sampleTiles(now, extra, own),
    countToday: BASE_TODAY + today,
    countThisWeek: BASE_WEEK + postTaps,
    hasTapped: taps.length > 0,
    sync: { status: "idle", count: SAMPLE_POSTS.length, startedAt: null },
    strips: { rateLimited: false, reconnect: false },
    // The sample is a few weeks in: the checklist half done (look.md section 10).
    checklist: { connected: true, card: false, counter: true, phone: false, thankYou: true, review: true },
    now: now.toISOString(),
  };
}

export async function recordSampleTap(env: Env, session: string, tile: string | null, answer: "post" | "walked_past" | "friend" | "google", now = new Date(), source: "card" | "counter" = "card"): Promise<{ name: string | null; count: number; countToday: number; imageUrl: string | null }> {
  await env.DB.prepare(`INSERT INTO sample_taps (session_id, tile_id, answer, created_at, source) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(session, tile, answer, now.toISOString(), source).run();
  if (!tile) return { name: null, count: 0, countToday: 0, imageUrl: null };
  const wall = await sampleWall(env, session, now);
  const t = wall.tiles.find((x) => x.id === tile);
  return { name: t?.name ?? null, count: t?.count ?? 0, countToday: wall.countToday, imageUrl: t?.imageUrl ?? null };
}

export function isSampleTile(id: string | null): boolean {
  return !!id && SAMPLE_POSTS.some((p) => p.id === id);
}

export async function deleteOldSampleTaps(env: Env, now: Date = new Date()): Promise<void> {
  await env.DB.prepare(`DELETE FROM sample_taps WHERE created_at < ?1`).bind(new Date(now.getTime() - 7 * 86400000).toISOString()).run();
}

// ---- Phase 3: the sample's This week and its posts' pages (plan 3.10) ----

export const SAMPLE_CHANNELS = [
  { id: "sample-ig", name: "ryeandlantern", service: "instagram" },
  { id: "sample-fb", name: "Rye & Lantern", service: "facebook" },
  { id: "sample-g", name: "Rye & Lantern", service: "googlebusiness" },
];

async function sampleAllTaps(env: Env, session: string, now: Date): Promise<WeekTap[]> {
  const own = await sampleSessionTaps(env, session);
  return [
    ...sampleHistory(now),
    ...own.map((t) => ({ tileId: t.tile_id, answer: t.answer as WeekTap["answer"], source: t.source || "card", at: t.created_at })),
  ];
}

export async function sampleWeek(env: Env, session: string, range: Range, now = new Date()): Promise<WeekData> {
  const tz = SAMPLE_SHOP.timezone;
  const { from, to } = rangeWindow(range, now, tz);
  const wall = await sampleWall(env, session, now);
  const taps = (await sampleAllTaps(env, session, now)).filter((t) => t.at >= from.toISOString() && t.at < to.toISOString());
  const summary = summarize(taps, weekTilesOf(wall.tiles, new Map()), tz, range);
  return { range, summary, tiles: rankTiles(summary, wall.tiles) };
}

export async function samplePostPage(env: Env, session: string, tileId: string, now = new Date()): Promise<PostPage | null> {
  const tz = SAMPLE_SHOP.timezone;
  const wall = await sampleWall(env, session, now);
  const tile = wall.tiles.find((t) => t.id === tileId);
  const p = SAMPLE_POSTS.find((x) => x.id === tileId);
  if (!tile || !p) return null;
  const taps = (await sampleAllTaps(env, session, now)).filter((t) => t.tileId === tileId && t.answer === "post");
  return {
    tile,
    sent: sentCaption(new Date(tile.firstSentAt), now, tz),
    byDay: groupByDay(taps, now, tz),
    bySource: sourceLines(taps),
    noteLeft: p.tagged,
    media: p.textOnly ? "none" : p.id === "hands" ? "video" : "image",
    channels: SAMPLE_CHANNELS.map((c) => ({ ...c, needsPhoto: c.service === "instagram" && !!p.textOnly, needsBoard: false })),
  };
}
