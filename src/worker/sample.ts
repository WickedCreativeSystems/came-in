// The sample bakery's server side (plan 1.5, 3.10): no account, taps go to
// sample_taps for this browser's session, counts = baseline + this session.
import type { Env } from "./env";
import { SAMPLE_POSTS, SAMPLE_SHOP, samplePostSentAt, sampleImageUrl } from "../shared/sample";
import { postName, isLiveStory, firstLine, wallOrder } from "../shared/names";
import { startOfShopDay } from "../shared/time";
import type { WallTile, WallData } from "../shared/types";

// Baseline header and week counts, as the sample shows them (look.md section 10).
const BASE_TODAY = 3;
const BASE_WEEK = 11;

export async function sampleSessionTaps(env: Env, session: string): Promise<{ tile_id: string | null; answer: string; created_at: string }[]> {
  const { results } = await env.DB.prepare(`SELECT tile_id, answer, created_at FROM sample_taps WHERE session_id = ?1`).bind(session).all<{ tile_id: string | null; answer: string; created_at: string }>();
  return results;
}

export function sampleTiles(now: Date, extra: Map<string, number>): WallTile[] {
  const tz = SAMPLE_SHOP.timezone;
  const tiles = SAMPLE_POSTS.map((p): WallTile => {
    const sent = samplePostSentAt(p, now, tz);
    const imageUrl = sampleImageUrl(p);
    return {
      id: p.id,
      name: postName({ firstSentAt: sent.toISOString(), subject: p.subject, text: p.text, hasImage: !!imageUrl }, now, tz),
      nickname: null,
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
      hidden: false,
    } satisfies WallTile;
  });
  return wallOrder(tiles);
}

export async function sampleWall(env: Env, session: string, now = new Date()): Promise<WallData> {
  const taps = await sampleSessionTaps(env, session);
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
    tiles: sampleTiles(now, extra),
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

export async function recordSampleTap(env: Env, session: string, tile: string | null, answer: "post" | "walked_past" | "friend" | "google", now = new Date()): Promise<{ name: string | null; count: number; countToday: number; imageUrl: string | null }> {
  await env.DB.prepare(`INSERT INTO sample_taps (session_id, tile_id, answer, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(session, tile, answer, now.toISOString()).run();
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
